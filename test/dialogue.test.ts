import assert from 'node:assert/strict';
import test from 'node:test';
import { createDialogueProvider } from '../server/dialogue.ts';
import { newGame } from '../server/engine.ts';

test('the model adapter reads a structured response and falls back on provider failure', async () => {
  const config = { apiKey: 'test-key', model: 'test-model' };
  const reply = { dialogue: 'Follow the lanterns.', action: 'NONE' };
  const successful: typeof fetch = async (_url, request) => {
    const body = JSON.parse(String(request?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    return Response.json({ status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] },
    ] });
  };
  assert.deepEqual(await createDialogueProvider(config, successful)(newGame(), 'Where do I go?'), reply);

  const unavailable: typeof fetch = async () => new Response(null, { status: 503 });
  const refused: typeof fetch = async () => Response.json({
    status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }],
  });
  for (const provider of [unavailable, refused]) {
    assert.deepEqual(
      await createDialogueProvider(config, provider)(newGame(), 'Give me the relic.'),
      await createDialogueProvider()(newGame(), 'Give me the relic.'),
    );
  }
});
