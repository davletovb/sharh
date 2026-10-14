# Model Paths

Version: 0.1  
Established: 2026-10-13  
Status: Seatline path implemented in B ([evidence](../evidence/2026-10-14-b-seatline.md)); higher-level picker/failover features remain scheduled. Seatline is the first path ([Seatline integration](seatline-integration.md)). The API-key path comes in Phase 4.

## Terms

| Term | Meaning |
| --- | --- |
| Path | A route to models. `seatline` now; `api` later. |
| Provider | A model vendor or tool reachable on a path. On Seatline: `claude`, `codex`, `gemini`, `grok`. |
| Model | A provider's model identifier, e.g. Claude Code's `opus`. Empty means the provider's default. |
| Target | Path, provider, model and effort together: what a run uses. |
| Task tier | A class of work with its own default target: Quick, Analysis, Book pass, Synthesis. |

## The path interface

Every path implements the same small interface. Nothing above it (lenses, validation, views, jobs) knows which path ran a turn.

```js
// paths/seatline.js now; paths/api.js later.
export const path = {
  id: 'seatline',
  label: 'Seatline',

  // What the path can reach right now. `fresh` bypasses cached readiness.
  async discover({fresh = false} = {}) { /* -> ProviderInfo[] */ },

  // Optional warm-up before a likely run. Sends no prompt.
  async prepare(target) {},

  // One turn. Streams events to onEvent and resolves on a terminal event.
  async run(target, request, {signal, onEvent}) { /* -> RunResult */ },

  // Ends sessions the path keeps (chats, deep reads) and retries cleanup.
  async forget(target, sessionHandles) {},
  async cleanup(target, group) {},
};
```

### ProviderInfo

| Field | Meaning |
| --- | --- |
| `path`, `provider`, `label` | Identity |
| `available` | Installed and runnable |
| `signedIn` | Authenticated, as far as the path can tell |
| `signIn` | `subscription`, `api_key`, `cloud`, `unknown` or `null` (as reported) |
| `accepted` | Whether Sharh's policy accepts that sign-in on this path |
| `models` | Suggested models (`id`, `label`); may be empty, in which case the picker offers the provider default and a free model ID |
| `capabilities` | See below |

### Capabilities

| Flag | Meaning |
| --- | --- |
| `streaming` | Text arrives as it is generated. Without it, views fill at the end. |
| `sessions` | The path can keep a conversation, so later turns need not resend the scope |
| `webSearch` | The provider can search the web in a turn (Situate) |
| `effort` | Effort levels the target accepts, e.g. `['low','medium','high','xhigh','max']`; empty if none |
| `serviceTier` | Speed tiers the target accepts; empty if none |
| `toolIsolation` | The path can guarantee a turn with no tools. Required for every analysis turn. |
| `schemaOutput` | The provider can enforce a response schema (API path) |
| `promptCaching` | Sharh can mark a cacheable prefix (API path) |
| `maxRequestBytes` | Largest request the path accepts |
| `reportsUsage` | Token counts are reported per turn |

### Request

```js
{
  kind: 'analysis' | 'chat' | 'search' | 'repair',
  rules: '…',               // layer 1, see analysis-pipeline.md
  document: '…' | null,     // layer 2; null on a continued session
  task: '…',                // layer 3
  history: [{role, text}],  // chat on paths without sessions
  session: {mode: 'none' | 'start' | 'continue', handle},
  priority: 'interactive' | 'background',
  tier: 'quick' | 'analysis' | 'synthesis', // optional output-cap class; absent uses kind's default
  cleanupGroup: 'doc-…' | 'chat-…',
  limits: {maxOutputBytes},
}
```

### Events and result

- **Events passed to `onEvent`:**
  - `queued` (with `ahead`), `admitted`, `started`, `delta` (text), `source` (a web source), `usage` (input and output tokens);
  - `session` (a handle to keep) and `session_lost`.
- **Result:** `text`, `sources`, `usage`, the `session` handle if any, and the `target` actually used. `truncated: true` means an output cap stopped the turn; the retained text is a whole-character UTF-8 prefix. The optional tier sets the maximum cap: Quick/repair 32 KiB, Analysis/chat/search 256 KiB, Synthesis 512 KiB; `limits.maxOutputBytes` may lower it.
- **Failure:**
  - One error type, with a path-neutral `code`:
    - `NOT_INSTALLED`, `NOT_AUTHORIZED`, `SIGNED_OUT`, `POLICY_DENIED`;
    - `RATE_LIMITED`, `BUSY`, `TOO_LARGE`, `TIMEOUT`;
    - `MODEL_UNSUPPORTED`, `OPTION_UNSUPPORTED`, `ISOLATION_UNAVAILABLE`;
    - `UPDATE_REQUIRED`, `DISCONNECTED`, `CANCELLED`, `PROVIDER_FAILED`.
  - It also carries the `retryable` flag, the path's own reason for diagnostics, and a hint for the reader.

## Choosing models

### Task tiers

| Tier | Used for | Default target (Seatline) |
| --- | --- | --- |
| Quick | Passage actions, Terms, Questions, repair turns | Claude `haiku`, low effort |
| Analysis | Chapter lenses, Ask, Deep read, Situate | Claude `opus`, high effort |
| Book pass | Chapter digests in whole-book jobs | Claude `sonnet`, medium effort |
| Synthesis | Book-level lenses, literature review, meta-synthesis, compare | Claude `opus`, high effort |

The defaults are proposals, to be revisited after live measurement and real usage-limit experience. Every tier can point at any target the reader has.

### The model picker

- **Grouping:** targets are grouped by path, then provider.
- **Status:** each provider shows its sign-in state and short badges for missing capabilities, such as *no streaming*, *no sessions* or *no web search*.
- **Effort and speed:** these controls appear only for targets that accept them. Claude takes `low` to `max` but not `none`. Codex takes `none` to `max`, though its model may reject some levels, and also takes a speed tier.
- **Model field:** where a provider suggests no models (Codex at the inspected Seatline revision), the picker offers *Provider default* and a model ID field. IDs are checked for form, not for entitlement.
- **Scope:** the header chip shows the target of the current tier and can change it for one run.

## Failover

- **When:** a failure that means the seat cannot serve right now, such as a usage limit (`RATE_LIMITED`) or an unavailable provider. Policy denials, invalid requests and isolation failures never trigger failover.
- **Order:** one list per tier, set by the reader. The default is Claude, then Codex, then Gemini (only if the cloud route is allowed), then Grok.
- **Mode:**
  - *Ask* is the default for foreground runs.
  - *Automatic* is available for background jobs.
- **Granularity:**
  - Failover happens between turns, never inside one.
  - A book job continues with its next chapter on the next seat.
  - A synthesis runs on one target from start to end.
- **Labels:** every run and digest records the target that produced it, and mixed-target results say so.

## Second reader

- **Targets:** two targets on different providers, Claude and Codex by default. Two models of the same provider are allowed but labelled *weaker independence*.
- **Independence:** separate sessions, the same prompts and the same scope. Neither reader sees the other's output.
- **Running:** both run at once when two slots are free, otherwise one after the other.
- **Alignment and agreement:** see the [analysis pipeline](analysis-pipeline.md#second-reader-alignment).

## Situate (web search)

- **Requirements:** a target with `webSearch`. The request kind is `search`; on Seatline it maps to `tools: "native_web_search"`.
- **Sources:**
  - Sources come only from the path's source events. On Seatline that is at most 20 per turn, each with a title, address and snippet.
  - Links in the answer that match no source are flagged.
- **Opt-in:** search queries derive from the text, so the lens runs only when the reader starts it.

## Paths

### Seatline (Phase 1)

The reader's own installed and signed-in CLIs (Claude Code, Codex, Gemini through Antigravity, Grok), reached through the shared Seatline companion over Chrome Native Messaging.

- **Strengths:**
  - It uses subscriptions the reader already has.
  - Several providers sit behind one connection.
  - A guaranteed no-tools mode suits untrusted text.
- **Limits:**
  - Two turns at a time per app by default.
  - A 1 MiB request frame.
  - No schema enforcement.
  - Sessions on Claude and Codex only at the inspected revision.

Everything specific is in [Seatline integration](seatline-integration.md).

### API keys (Phase 4)

- **Providers:**
  - the Anthropic Messages API;
  - OpenAI-compatible chat endpoints such as OpenAI and OpenRouter;
  - local servers such as Ollama and LM Studio.
- **Keys:**
  - entered in settings and kept in `chrome.storage.local`, never in `sync`;
  - shown masked, with optional encryption at rest under a passphrase (WebCrypto).
  - Requests leave from the extension's service worker, with host permissions only for the configured endpoints.
- **What it adds:**
  - schema-constrained output where the provider offers it, as an extra guard on the same JSON Lines contract;
  - explicit prompt caching, with the rules and the document as the cached prefix;
  - more parallel turns;
  - cost estimates;
  - nothing to install, which makes it the path for anyone without Seatline.
- **Verification:** provider features change. Check each provider's current documentation when this path is built; nothing about third-party APIs is pinned here.

### Adding a path

1. Implement the interface. Report capabilities honestly; an unknown capability is reported as absent.
2. Map every failure to the error codes above, keeping the path's own reason for diagnostics.
3. Pass the path conformance tests. These are a scripted transport covering streaming, cancellation, sessions, oversize requests, malformed output and disconnects.
4. Document the path under `docs/architecture/`.
