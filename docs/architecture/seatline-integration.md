# Sharh and Seatline Integration

Version: 0.1  
Established: 2026-10-13  
Status: Contract pinned; A probes and B production client/path implemented ([B evidence](../evidence/2026-10-14-b-seatline.md)). Source facts below use the audited revision. Deterministic CI evidence and owner-machine live gates are tracked in the [foundation decision](../decisions/a-foundations.md).

| | |
| --- | --- |
| Seatline revision inspected | [`ba712f70eb4acd43b45b326bb4907feb9ded9c2f`](https://github.com/davletovb/seatline/tree/ba712f70eb4acd43b45b326bb4907feb9ded9c2f) (main, 2026-10-11), companion protocol 1 |
| Client reference | Lineleaf [`extension/lib/native-seatline.mjs`](https://github.com/davletovb/Lineleaf/blob/c6403c5524a217bd1bae01f9a0a22e4b4b51b044/extension/lib/native-seatline.mjs) at `c6403c5` |
| Live provider runs | None. No latency, quota or output-quality result for any provider is claimed here. |

The audited revision is pinned in [`config/seatline-contract.json`](../../config/seatline-contract.json). It retains Lineleaf’s common contract fields; Sharh-specific generation defaults live in `reading_policy` instead of Lineleaf’s `writing_policy`. The manifest key derives development ID `npmhefooiolfpmhicinblelaideeejcm`. Re-check this document on every pin change. Facts below that are specific to a revision say so.

## Ownership

| Component | Responsibilities |
| --- | --- |
| Sharh extension | Readers, document model, prompts, output validation, views, library, job pacing, the choice of sign-in policy, all wording the reader sees |
| Seatline companion (shared with the owner's other apps) | Provider execution, app grants, readiness cache, session ledger, scheduling, cancellation, cleanup |
| Provider CLIs | Model execution, sign-in, the provider's own limits |

Sharh follows the same constraints as Lineleaf:

- No reading-specific logic in Seatline.
- No second companion, no local HTTP listener and no app worker processes.
- Inspect the merged companion API before coding against it.
- A missing generic capability becomes a Seatline issue, not a workaround in Sharh.

## Transport

- **Connection:**
  - The extension calls `chrome.runtime.connectNative("com.seatline.host")`.
  - Chrome starts `seatline-companion` with the extension's origin (`chrome-extension://<id>/`) as its argument.
  - The companion finds the one app grant that lists that origin, connects to the per-user broker (starting it if needed), authenticates with the grant's token and relays frames.
  - The extension never handles the token.
- **Frames:**
  - Native Messaging framing (a 4-byte length, then UTF-8 JSON).
  - Seatline refuses any frame over 1 MiB (1,048,576 bytes) in either direction.
- **Handshake:** the first frame from the companion is `{"type":"ready","version":1}`.
- **Requests:**
  - A request is `{"id", "provider", "method", "params", "scheduling"?}`.
  - An `id` is 1 to 128 characters from `A–Z a–z 0–9 . _ : -`, unique among the connection's live requests. A duplicate closes the connection.
- **Responses:**
  - A response is `{"id", "event": {…}}`.
  - Event types are `launched`, `started`, `activity`, `delta`, `session`, `session_lost`, `usage`, `source`, `status`, `completed`, `stopped` and `failed`, plus `queued` and `admitted` when the request sets `scheduling.events`.
  - `completed`, `stopped` and `failed` are terminal. A `failed` event carries `code`, `reason` (from a fixed list) and `retryable`.
- **Cancel:** `{"id": <new id>, "method": "cancel", "target": <request id>}`. The target ends as `stopped`, and the cancel id itself is never answered.
- **Methods:** `status`, `readiness`, `prepare`, `send`, `send_ready`, `send_ready_with_policy`, `forget` and `cleanup`, plus `cancel`. Sharh generates only through `send_ready_with_policy`.

### Lifetime and back-pressure

- **One connection:**
  - Chrome keeps an extension service worker alive while it holds a Native Messaging port (Chrome 105 and later, per Chrome's service worker lifecycle documentation).
  - Sharh holds one connection in the service worker for all of its pages: side panel, PDF reader, passage toolbar. This matches Seatline's one-client-per-app guidance.
- **Idle close:** the worker closes the port after 60 seconds with no request in flight and no job running, so an idle browser leaves no companion process. The next request reconnects.
- **Back-pressure:**
  - The companion holds at most 64 frames on their way to Chrome and ends the connection if that buffer fills.
  - The worker's message handler therefore only appends and forwards. Parsing happens in the page that shows the run.
- **Lost connection:**
  - If the port disconnects mid-turn, every request in flight on it is lost.
  - A frame that provably never left is sent once more on a new connection, as Lineleaf does.
  - Whether to re-run a turn that had already started is decided by Sharh's job layer, not the transport ([failure handling](#failure-handling)).

## Setup and authorization

1. **Install the companion:** install Seatline (`seatline-companion install`).
2. **Install the CLIs:** install and sign in to the CLIs to be used: Claude Code, Codex, Antigravity (`agy`) for Gemini, and Grok.
3. **Authorize Sharh:**

   ```sh
   seatline-companion authorize sharh claude,codex,gemini,grok chrome-extension://<extension id>/ --cache-title=Sharh
   ```

   - **App identifier:** `sharh`. Seatline app identifiers are 1 to 64 lowercase letters, digits, `-` or `_`, starting with a letter or digit. `--cache-title` only sets the capitalization of the cache folder on macOS and Windows.
   - **Extension ID:**
     - A `key` in `manifest.json` fixes the extension ID, as Lineleaf does, so development builds share one ID and one command on every machine.
     - A Chrome Web Store build has its own ID, which must be added to the grant.
   - **Reauthorizing:**
     - Reauthorizing replaces the whole grant, so every provider and origin must be listed each time.
     - It also rotates credentials, which ends live connections; the extension reconnects by itself.
   - **No provider-default tools:** Sharh never needs `--allow-provider-default`. Its turns use `tools: "none"`, or `native_web_search` for Situate, and neither is gated.
4. **Settings screen:** Settings → Seatline shows this command with the real extension ID and a copy button, along with the current state of each provider.

**Browsers.** `seatline-companion install` registers `com.seatline.host` for Google Chrome only, in these locations:

- Windows: `HKCU\Software\Google\Chrome\NativeMessagingHosts`;
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
- Linux: `~/.config/google-chrome/NativeMessagingHosts`.

Other Chromium browsers read their own locations. Running Sharh in Edge, Brave or Arc therefore needs Seatline's installer to register there too, which is a Seatline change.

### Diagnostics

Settings → Seatline → **Check** always asks for fresh readiness and reports one state per provider:

| State | Detected by | What the reader is told |
| --- | --- | --- |
| Companion missing | Chrome cannot find the native host | Install Seatline, and register it for this browser if it is not Chrome |
| Sharh not authorized | Chrome refuses the host for this origin, or the host exits before `ready` | Run the authorize command shown |
| Companion too old | `readiness` or `send_ready_with_policy` answered with `INVALID_REQUEST` or `READINESS_UNSUPPORTED` | Update Seatline (`install` from a new build). There is no fallback to plain `send`. |
| Provider not authorized | `APP_NOT_AUTHORIZED` | Add the provider to the grant |
| CLI missing | Status `availability: "not_found"`, or `EXECUTABLE_NOT_FOUND` | Install that CLI |
| Signed out | Status `authentication: "unauthenticated"`, `LOGIN_REQUIRED` or `AUTH_REJECTED` | Sign in to that CLI |
| Sign-in not accepted | A sign-in class outside the policy, or `SIGN_IN_POLICY_DENIED` | Explain the policy, and offer the Gemini cloud opt-in where relevant |
| Isolation unavailable | `capabilities.tool_isolation` is not `true`, or `TOOL_ISOLATION_UNAVAILABLE` | The CLI's own configuration exposes tools Seatline cannot switch off; fix that configuration |

## Readiness and sign-in policy

- **Preparation:**
  - `prepare` with `{"mode":"cached","max_age_ms":30000}` runs when the side panel opens on a document, when the passage toolbar appears, when the model picker opens, and before a job starts.
  - It runs at most once every 10 seconds per provider and never reports a failure, because nobody asked.
  - It sends no prompt and keeps no process warm. It moves the sign-in probe out of the send.
- **Before a turn:**
  1. `readiness` (cached, at most 30 seconds old) confirms the provider is available and authenticated, its sign-in class is accepted, `tool_isolation` is `true`, and any requested effort or speed is supported.
  2. Sharh then sends with `send_ready_with_policy`, using `freshness` set to cached, `check_sign_in: false` in the turn, and the policy below. Seatline re-validates readiness and enforces the policy at launch, so a sign-in that changes between the check and the send cannot start a turn.
- **Policy** (`allowed_sign_in`):

  | Provider | Accepted | Note |
  | --- | --- | --- |
  | `claude` | `["subscription"]` | Claude Code reports `subscription` for a claude.ai sign-in |
  | `codex` | `["subscription"]` | Codex reports `subscription` for a ChatGPT sign-in |
  | `grok` | `["subscription"]` | Grok reports `subscription` for an authenticated sign-in that is not an API or deployment key |
  | `gemini` | `["cloud"]`, only after the reader enables *Allow the Antigravity cloud route* (off by default) | Antigravity reports `cloud`, which Seatline cannot certify as a subscription route |

  API-key and unknown sign-ins are refused on this path. Keys will have their own explicit path.
- **Refusals:**
  - `READINESS_CHANGED`, `READINESS_EXPIRED` and `READINESS_UNVERIFIED` mean nothing launched. Sharh retries once after a fresh readiness check.
  - `SIGN_IN_POLICY_DENIED` is final.

## Turn mapping

A Seatline turn has exactly these fields, and unknown fields are refused:

- `system`, `messages`, `model`;
- `reasoning_effort` and `service_tier`, both optional;
- `tools`, `session`, `continuation`, `cleanup_group`, `check_sign_in`.

| Sharh request | `system` | `messages` | `tools` | `session` and `continuation` | Priority |
| --- | --- | --- | --- | --- | --- |
| Passage action | Rules | Context and selection, then the task | `none` | `ephemeral` | interactive |
| Lens run | Rules | Numbered scope, then the task | `none` | `ephemeral` | interactive |
| Deep read (Claude, Codex) | Rules on the first turn, then `null` | First turn: scope and the Structure task. Later turns: the next task only. | `none` | `persistent`; `continuation` is the session token after the first turn | interactive |
| Ask (Claude, Codex) | Rules on the first turn, then `null` | First turn: scope and question. Later turns: the question only. | `none` | `persistent`; as above | interactive |
| Ask (Gemini, Grok) | Rules | The earlier exchange (the first user message holds the scope), then the question | `none` | `ephemeral` | interactive |
| Book pass (chapter digest) | Rules | Chapter, then the digest task | `none` | `ephemeral` | background |
| Situate | Rules | Scope summary, then the task | `native_web_search` | `ephemeral` | interactive |
| Repair | Rules | The faulty output and the contract | `none` | `ephemeral` | interactive |

Priority sets the request's `scheduling` field: interactive is `{"interactive":true,"events":true}` and background is `{"events":true}`.

- **`model`:** the target's model ID, or `null` for the provider's default. IDs must start with a letter or digit and use only letters, digits and `. _ - : / @`, at most 128 bytes.
- **`reasoning_effort`:** sent only when `status.capabilities.reasoning_effort` is `true` and the level suits the provider. Claude accepts `low` to `max` and has no `none`. Codex accepts `none` to `max`, though the model may reject a level. Otherwise the field is omitted. Seatline treats a level as a request, not a guarantee: Claude's CLI does not report which level ran.
- **`service_tier`:** omitted unless the reader set a Codex speed, which also requires `status.capabilities.service_tier` to be `true`.
- **`cleanup_group`:** `doc-<16 hex>` for analysis of a document and `chat-<id>` for chats. Groups are at most 64 characters from `A–Z a–z 0–9 _ -`.
- **`check_sign_in`:** `false` (see above).

**How Seatline writes the prompt.**

- For Claude and Codex, `system` goes first in the prompt under *"Follow these instructions from the application for the whole conversation:"*.
- Antigravity receives it through an agent file, and Grok through its own introduction.
- Earlier messages are rendered as quoted JSON lines under *"Continue this conversation…"*.
- Each CLI puts its own system prompt in front of all of this. Claude Code's is about 2,100 tokens, per Seatline's I-10 measurement.

Sharh's rules must therefore work as instructions inside the user turn. In Seatline's I-10 run, Claude followed four kinds of application instruction (language, capitals, a closing word and a JSON object) in all 24 trials. That supports prompt-level format control but does not prove it for long JSON Lines output. Sharh's evaluation measures JSON Lines compliance per provider.

## Capability matrix

At the inspected revision:

| Provider | CLI | Streaming | Persistent sessions | Web search | Effort | Speed tier | Sign-in classes reported | Suggested models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claude` | Claude Code | Yes | Yes | Yes | `low`–`max` | No | `subscription`, `api_key`, `cloud` | `sonnet`, `opus`, `haiku` (latest of each family), or a full ID |
| `codex` | Codex CLI | Yes | Yes | Yes | `none`–`max` | `standard`, `fast` | `subscription`, `api_key` | None listed; the default or a typed ID |
| `gemini` | Antigravity (`agy`) | Yes | No | Yes | No | No | `cloud` | From `agy models` |
| `grok` | Grok CLI | No; the answer arrives at the end | No | No | No | No | `subscription`, `api_key` | From `grok models` |

- **Sessions:**
  - Gemini and Grok report `continuation: true` in `status.capabilities`, yet the companion refuses persistent turns for them with `PERSISTENT_SESSION_UNSUPPORTED`. Their adapters do not support persistent sessions, and Seatline's own tests expect that refusal.
  - Sharh therefore treats sessions as Claude- and Codex-only and re-checks this on every Seatline pin ([open items](#open-items)).
- **Tool isolation:** `tool_isolation` can change while the companion runs; Codex, for example, reports it unsupported when its configuration exposes tools Seatline cannot switch off. Sharh checks it on every readiness.

## Scheduling and pacing

Defaults at the inspected revision:

| Limit | Value |
| --- | --- |
| Generations running per app | 2 (the owner may raise this to 8 in `scheduling.json`) |
| Generations running per provider, across all apps | 2 (the owner may raise this to 8) |
| Running in total | 8, of which 6 may be generations |
| Queued per app / in total | 8 / 64 |
| Queue wait before `QUEUE_TIMEOUT` | 30 s by default; a request may ask for less, not more |
| Turn length | 15 minutes (`TURN_DEADLINE_EXCEEDED`) |
| Connections | 32 |
| Stored sessions | 2,000 per app, 10,000 in total |
| Request frame | 1 MiB |
| Sources per web-search turn | 20 |

Interactive requests get a bounded preference in the queue, but no priority preempts a running turn. Sharh's rules follow from that.

1. **One background turn at a time.**
   - Background work (book passes) keeps at most one generation running, so one of the two slots stays free for the reader.
   - This is the only way to keep passage actions quick during a job.
   - A setting allows more background turns for owners who raised the limit. Sharh cannot read `scheduling.json`.
2. **No queue flooding.** Background work never queues ahead: the next chapter is submitted when the previous one finishes.
3. **Interactive requests go at once.** They are sent with `{"interactive":true,"events":true}`, and `queued` events show as *waiting for a free slot (n ahead)*.
4. **Busy handling.**
   - On `QUEUE_FULL` or `QUEUE_TIMEOUT`, background work retries after 10, 30 and then 60 seconds.
   - An interactive request shows *busy* with a retry button.
5. **Shared slots.** The per-provider limit is shared with the owner's other Seatline apps (Lineleaf, Conclave, TabBeam), so Sharh never assumes its slots are free.
6. **Forget and cleanup wait for idle.** A queued `forget` or `cleanup` holds back new generations for that app and provider until running ones finish, so Sharh sends them only when it has nothing running on that provider.

## Sessions, forget and cleanup

- **Tokens:** a `session` event carries a broker token, not the provider's own handle. The token is scoped to Sharh and that provider, and Sharh stores it with the chat or deep read.
- **Continuing:** a continued turn uses `session: "persistent"` and `continuation: <token>`, with `system` set to `null` and only the new task in `messages`.
- **Lost sessions:**
  - `session_lost` and `UNKNOWN_SESSION` start a new session that resends the scope.
  - The reader is told the model's memory of the conversation was reset; the chat history stays visible in Sharh.
- **Deletion:**
  - Deleting a chat, a deep read or a document sends `forget` with its session tokens (at most 256 per request) and `cleanup` for its group.
  - Both wait until the provider is idle ([rule 6](#scheduling-and-pacing)).
- **Housekeeping:** sessions unused for 30 days are forgotten, which keeps Sharh far below the 2,000-session cap. `SESSION_LIMIT_REACHED` triggers the same housekeeping, then one retry.

## Sizes, streaming and output caps

- **Request size:**
  - Sharh serializes each request and measures its UTF-8 bytes before sending.
  - Above 1,000,000 bytes (the 1 MiB frame minus a margin), it offers to narrow the scope or switch to a book job.
  - Cyrillic and Arabic take two bytes per character, so the same page count weighs more than in English.
- **Streaming:**
  - The companion splits text into `delta` pieces of at most 16 KiB.
  - The worker forwards them unchanged, and the page's line parser renders each complete JSON Lines record as soon as its newline arrives.
- **Output caps** (proposed):
  - Quick: 32 KiB;
  - Analysis: 256 KiB;
  - Synthesis: 512 KiB.
  - Exceeding a cap cancels the turn, keeps what arrived and marks the run truncated.
- **Usage:**
  - `usage` events report input and output token totals.
  - Sharh shows them per run as plan usage, not money.

## Failure handling

The table describes consumer behavior across B/D/G/H. B maps and surfaces all failures; it retries only readiness refusals and background queue-full/timeouts. Job replay/failover and session reconstruction/housekeeping remain with their later tracker items.

`failed` events carry a `retryable` flag. Sharh uses that flag as the primary signal and the `reason` for wording.

| Reason | Sharh behavior |
| --- | --- |
| `EXECUTABLE_NOT_FOUND` | Mark the provider unavailable and show the install hint |
| `LOGIN_REQUIRED`, `AUTH_REJECTED` | Show the sign-in hint and check again |
| `APP_NOT_AUTHORIZED` | Show the authorize command (the provider is missing from the grant) |
| `SIGN_IN_POLICY_DENIED` | Explain the policy; final |
| `TOOL_ISOLATION_UNAVAILABLE` | Refuse the run and explain the CLI configuration issue |
| `PROVIDER_RATE_LIMITED` | [Failover](model-paths.md#failover) or wait, by setting |
| `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROCESS_EXITED`, `MALFORMED_PROVIDER_OUTPUT`, `PROVIDER_FAILED` | Retry once if `retryable`, then fail over or report |
| `QUEUE_FULL`, `QUEUE_TIMEOUT` | Back off (background) or show busy (interactive) |
| `TURN_DEADLINE_EXCEEDED` | Suggest a smaller scope or lower effort |
| `MODEL_NOT_SUPPORTED` | Ask for another model |
| `REASONING_EFFORT_UNSUPPORTED`, `SERVICE_TIER_UNSUPPORTED` | Drop the option for that provider and say so |
| `PERSISTENT_SESSION_UNSUPPORTED` | Switch the chat to resending the scope |
| `UNKNOWN_SESSION` | Start a new session with the scope |
| `READINESS_CHANGED`, `READINESS_EXPIRED`, `READINESS_UNVERIFIED` | Retry once after fresh readiness |
| `READINESS_UNSUPPORTED`, `INVALID_REQUEST` on a protected method | Update required; no fallback |
| `SESSION_LIMIT_REACHED` | Forget old sessions, then retry once |
| Port disconnect | Reconnect, then re-run an interrupted analysis turn once. Analysis turns have no side effects, but a turn that had started may already have used plan usage, so the reader is told. |

## Client

Sharh's client starts from Lineleaf's `NativeSeatline`, which already provides:

- one connection;
- request IDs;
- cancel by target;
- a one-time resend of frames that provably never left;
- a ready timeout;
- strict frame validation.

That client is built for short proofreading answers. It buffers the whole answer, caps output at 128 KiB and 4,096 events per request, and treats `session` events as contract violations. Sharh's version changes this:

- Stream `delta` text to a callback as well as counting bytes.
- Apply caps per request kind instead of a fixed size and event count.
- Accept `session` and `session_lost` only on requests that asked for a persistent session; elsewhere they remain violations.
- Pass `source`, `usage`, `queued` and `admitted` events to callbacks.
- Send `scheduling` hints.

It keeps Lineleaf's rules unchanged:

- it never replays a request that was sent;
- it requires the protected method, with no fallback;
- it forgets capabilities on disconnect, so a companion update is noticed.

`config/seatline-contract.json` uses Lineleaf's structure so the two can be compared mechanically. It records:

- the repository, the pinned and minimum revisions, and the protocol;
- the native host, the development extension ID and the app identifier;
- the providers, the frame format, the methods and the events;
- the limits;
- Sharh's turn policy.

## Testing

- **Unit:** the client against a scripted port, covering frames, cancellation, disconnects, caps, sessions and malformed events.
- **Integration** (CI, Linux):
  - Build `seatline-companion` at the pinned revision and run it with stand-in provider executables (Seatline's fake providers).
  - Authorize a test origin and drive Sharh's client through the real broker.
  - This mirrors how Seatline's benchmark and Lineleaf's shared-companion checks work.
- **Extension:**
  - Load the unpacked extension in Chromium under Playwright.
  - Replay recorded model outputs through the fake path to test readers, views and validation.
- **Live**, on the owner's machine: each lens with each provider on the evaluation corpus, recording latency and validation metrics.

The source audit is not a live result. Deterministic probe evidence is recorded separately under `docs/evidence/`; live owner-machine checks remain required.

## Expected latency

Seatline's live Claude baseline (I-04, 2026-10-09) ran in one cloud sandbox with Claude Code 2.1.295 and a one-word answer. A warm send took about 1.9 s from submit to first text and 2.4 s to completion. Claude's own start-up took about 0.6 s, and a sign-in probe about 0.2 s, which `prepare` moves out of the send. A later change (I-05) removed the roughly half-second wait for Claude's exit on turns that keep no session.

These figures describe tiny answers. Sharh's turns are dominated by reading a long scope and generating long output, and both must be measured. There are no live figures for Codex, Gemini or Grok.

## Terms of use and distribution

Anthropic's [Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance), checked on 2026-10-13, says:

- Anthropic does not permit third-party developers to route requests through Free, Pro or Max plan credentials on behalf of their users.
- That does not prevent an end user from signing in to the unmodified Claude Code binary with their own subscription.
- Running Claude Code inside a product requires Anthropic's Commercial Terms.
- Advertised Pro and Max limits assume ordinary, individual use.

How a published extension that drives the reader's own Claude Code through Seatline is treated is not clear-cut. Before publishing Sharh with the Claude route, confirm with Anthropic or route Claude through the API path. For personal use it is the owner's own Claude Code, within the owner's plan limits; whole-book jobs will draw on them noticeably. This is a reading of the published terms, not legal advice. The other providers' terms were not reviewed.

## Open items

1. **Browser registration.** The native host is registered for Google Chrome only. Registering it for other Chromium browsers belongs in Seatline's installer.
2. **Session capability.** Gemini and Grok report `continuation: true` but refuse persistent turns. Ask Seatline to report persistent-session support explicitly, or confirm what `continuation` means.
3. **Effective limits.** An app cannot read the owner's `scheduling.json`, so Sharh cannot know whether more than two slots exist. Adding the effective app and provider limits to `status` would be a generic change useful to every app.
4. **Live measurement.** Latency, JSON Lines compliance and usage per provider on the evaluation corpus.
5. **Distribution terms.** See above.

## References

- [Seatline companion README](https://github.com/davletovb/seatline/blob/ba712f70eb4acd43b45b326bb4907feb9ded9c2f/companion/README.md)
- [Seatline readiness and preparation](https://github.com/davletovb/seatline/blob/ba712f70eb4acd43b45b326bb4907feb9ded9c2f/docs/readiness-and-preparation.md)
- [Seatline shared hub and scheduling](https://github.com/davletovb/seatline/blob/ba712f70eb4acd43b45b326bb4907feb9ded9c2f/docs/shared-hub-and-scheduling.md)
- [Seatline live Claude baseline (I-04)](https://github.com/davletovb/seatline/blob/ba712f70eb4acd43b45b326bb4907feb9ded9c2f/docs/performance-baselines/2026-10-09-claude-live-summary.md) and [system prompt measurement (I-10)](https://github.com/davletovb/seatline/blob/ba712f70eb4acd43b45b326bb4907feb9ded9c2f/docs/performance-baselines/2026-10-11-claude-system-prompt-summary.md)
- [Lineleaf Seatline integration](https://github.com/davletovb/Lineleaf/blob/c6403c5524a217bd1bae01f9a0a22e4b4b51b044/docs/architecture/seatline-integration.md)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) and [extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
