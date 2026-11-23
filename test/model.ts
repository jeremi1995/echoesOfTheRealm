import { createDialogueProvider } from '../server/dialogue.ts';

// Gameplay fixtures assume an approving checker. Guardrail tests exercise rejection separately.
export function createTestDialogueProvider(
  config?: Parameters<typeof createDialogueProvider>[0],
  fetchImpl?: typeof fetch,
) {
  if (!fetchImpl) return createDialogueProvider(config);
  return createDialogueProvider(config, async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (body.text?.format?.name === 'npc_guardrail_verdict') {
      return Response.json({ id: 'resp_guardrail', status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"allowed":true,"violatedRules":[]}' }] },
      ] });
    }
    return fetchImpl(url, options);
  });
}
