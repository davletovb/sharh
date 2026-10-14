import {OutputMetrics} from './output-metrics.mjs';
import {draftTurn, PROMPT_VERSION, standInOutput} from './draft-prompts.mjs';
export async function runOutputProbe({client, items, providers, extract, contract, fixture = false, allowGeminiCloud = false, model = null}) {
  const runs = [];
  for (const item of items) {
    let scope, extractionFailure;
    try { scope = await extract(item); } catch (error) { extractionFailure = error.message; }
    for (const provider of providers) for (const lens of ['structure', 'logic']) {
      const metrics = new OutputMetrics({lens, blocks: scope?.blocks ?? [], canary: item.canary});
      const run = {item: item.id, provider, lens, promptVersion: PROMPT_VERSION, outcome: 'completed'};
      try {
        if (extractionFailure) throw new Error('EXTRACTION_FAILED: ' + extractionFailure);
        if (fixture) {
          const output = standInOutput(lens, scope);
          // Split through arbitrary Unicode/record boundaries, as native delta events can.
          for (let i = 0; i < output.length; i += 23) metrics.push(output.slice(i, i + 23));
        } else {
          if (provider === 'gemini' && !allowGeminiCloud) throw new Error('GEMINI_CLOUD_OPT_IN_REQUIRED');
          let status;
          await client.request(provider, 'readiness', {mode: 'fresh'}, e => { if (e.type === 'status') status = e.status; });
          if (status?.availability !== 'available' || status.authentication !== 'authenticated') throw new Error('PROVIDER_NOT_READY');
          if (status.capabilities?.tool_isolation !== true) throw new Error('TOOL_ISOLATION_UNAVAILABLE');
          const policy = contract.reading_policy.allowed_sign_in[provider];
          if (!policy?.includes(status.sign_in)) throw new Error('SIGN_IN_POLICY_DENIED');
          const turn = draftTurn(lens, scope); turn.model = model;
          let outputBytes = 0;
          await client.request(provider, 'send_ready_with_policy', {turn, freshness: {mode:'cached', max_age_ms:30000}, allowed_sign_in:policy}, event => {
            if (event.type === 'delta') {
              outputBytes += new TextEncoder().encode(event.text).byteLength;
              if (outputBytes > 262144) throw new Error('OUTPUT_CAP_EXCEEDED');
              metrics.push(event.text);
            }
            if (event.type === 'usage') run.usage = event.usage;
          });
        }
      } catch (error) { run.outcome = 'failed'; run.failure = error.reason || error.message; }
      run.metrics = metrics.finish(); runs.push(run);
    }
  }
  return {version:1, kind:fixture ? 'scripted-output' : 'seatline-native', seatlineRevision:contract.revision, model, liveProviderClaim:!fixture, runs};
}
export function reportPasses(report) {
  return report.runs.length > 0 && report.runs.every(({outcome, metrics:m}) => outcome === 'completed' && m.completed && m.parseRate >= .95 && m.references > 0 && m.referenceValidity >= .98 && !m.canaryObserved && !m.danglingIdentifiers && !m.duplicateIdentifiers && !m.parentCycle && (m.quotationVerification === null || m.quotationVerification === 1) && (m.headingCoverage === null || m.headingCoverage >= .9));
}
