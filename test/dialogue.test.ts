import assert from 'node:assert/strict';
import test from 'node:test';
import { createDialogueProvider } from '../server/dialogue.ts';
import { newGame, recordConversation, travel } from '../server/engine.ts';
import { gameSchema } from '../shared/validation.ts';

type CapturedRequest = {
  previous_response_id?: string;
  instructions: string;
  input: { role: string; content: string }[];
};

test('the model adapter reads a structured response and falls back on provider failure', async () => {
  const config = { apiKey: 'test-key', model: 'test-model' };
  const reply = { dialogue: 'Follow the lanterns.', action: 'NONE' };
  const successful: typeof fetch = async (_url, request) => {
    const body = JSON.parse(String(request?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.store, true);
    assert.deepEqual(body.context_management, [{ type: 'compaction', compact_threshold: 8000 }]);
    assert.equal(body.text.format.type, 'json_schema');
    return Response.json({ id: 'resp_test', status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] },
    ] });
  };
  const turn = await createDialogueProvider(config, successful)(newGame(), 'Where do I go?');
  assert.deepEqual(turn.reply, reply);
  assert.deepEqual(turn.continuation, { responseId: 'resp_test', model: 'test-model', messageCount: 2 });

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

test('NPCs have independent chains and stored compaction output continues through the response ID', async () => {
  const requests: CapturedRequest[] = [];
  const fetchModel: typeof fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({ id: `resp_${requests.length}`, status: 'completed', output: [
      { type: 'reasoning', encrypted_content: 'opaque' },
      { type: 'compaction', encrypted_content: 'also-opaque' },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ dialogue: 'Welcome.', action: 'NONE' }) }] },
    ] });
  };
  const provider = createDialogueProvider({ apiKey: 'test', model: 'test-model' }, fetchModel);
  let game = newGame();
  let turn = await provider(game, 'My name is Ivo.');
  game = recordConversation(game, 'My name is Ivo.', turn.reply, turn.continuation);
  game = recordConversation(travel(game, 'village'), 'What happened?', undefined);
  turn = await provider(game, 'What should I do?');
  game = recordConversation(game, 'What should I do?', turn.reply, turn.continuation);
  game = travel(game, 'ruins');
  turn = await provider(game, 'How do I fight?');
  game = recordConversation(game, 'How do I fight?', turn.reply, turn.continuation);
  game = travel(game, 'forest');
  turn = await provider(game, 'Do you remember my name?');
  game = recordConversation(game, 'Do you remember my name?', turn.reply, turn.continuation);

  assert.equal(requests[0].previous_response_id, undefined);
  assert.equal(requests[1].previous_response_id, undefined);
  assert.equal(requests[2].previous_response_id, undefined);
  assert.equal(requests[3].previous_response_id, 'resp_1');
  assert.deepEqual(requests[3].input, [{ role: 'user', content: 'Do you remember my name?' }]);
  assert.equal(JSON.stringify(requests[1]).includes('Ivo'), false);
  assert.equal(JSON.stringify(requests[2]).includes('Ivo'), false);
  assert.ok(requests[2].instructions.includes('ruins-entered'));
  assert.equal(game.conversations.elder?.responseId, 'resp_2');
  assert.equal(game.conversations.guide?.responseId, 'resp_3');
  assert.equal(game.conversations.warden?.responseId, 'resp_4');
});

test('transcripts exceed the old limit and fallback or missing response IDs rebuild all retained dialogue', async () => {
  let game = newGame();
  for (let i = 0; i < 20; i++) game = recordConversation(game, `Detail ${i}`, { dialogue: `Reply ${i}` });
  assert.equal(game.memory.warden.length, 40);
  assert.equal(gameSchema.safeParse(game).success, true);
  game.conversations.warden = { responseId: 'resp_expired', model: 'test-model', messageCount: 40 };
  const requests: CapturedRequest[] = [];
  const provider = createDialogueProvider({ apiKey: 'test', model: 'test-model' }, async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    if (requests.length === 1) return Response.json({ error: { code: 'previous_response_not_found', param: 'previous_response_id' } }, { status: 404 });
    return Response.json({ id: 'resp_rebuilt', status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"I remember.","action":"NONE"}' }] },
    ] });
  });
  let turn = await provider(game, 'Remember Detail 0?');
  assert.equal(requests[0].previous_response_id, 'resp_expired');
  assert.equal(requests[1].previous_response_id, undefined);
  assert.equal(requests[1].input.length, 41);
  assert.equal(requests[1].input[0].content, 'Detail 0');
  game = recordConversation(game, 'Remember Detail 0?', turn.reply, turn.continuation);
  const unavailable = createDialogueProvider({ apiKey: 'test', model: 'test-model' }, async () => new Response(null, { status: 503 }));
  turn = await unavailable(game, 'Where do I go?');
  game = recordConversation(game, 'Where do I go?', turn.reply, turn.continuation);
  assert.equal(game.conversations.warden, null);
  requests.length = 1; // The next call succeeds and must replay the fallback exchange too.
  await provider(game, 'Continue.');
  assert.equal(requests[1].input.length, 45);
  assert.equal(requests[1].input.at(-3)?.content, 'Where do I go?');
});

test('model changes replay the local transcript and engine corrections invalidate the remote chain', async () => {
  let game = recordConversation(newGame(), 'Hello.', { dialogue: 'Welcome.' });
  game.conversations.warden = { responseId: 'resp_old_model', model: 'old-model', messageCount: 2 };
  const provider = createDialogueProvider({ apiKey: 'test', model: 'new-model' }, async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.input.length, 3);
    return Response.json({ id: 'resp_new_model', status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"Take the relic.","action":"CLAIM_RELIC"}' }] },
    ] });
  });
  const turn = await provider(game, 'Give me the relic.');
  game = recordConversation(game, 'Give me the relic.', turn.reply, turn.continuation);
  assert.equal(game.conversations.warden, null);
  assert.match(game.memory.warden.at(-1)!.text, /stays sealed/);
  assert.deepEqual(game.events, []);
});

test('legacy saves gain empty cursors and impossible transcript offsets are rejected', () => {
  const { conversations, ...legacy } = newGame();
  assert.deepEqual(gameSchema.parse(legacy).conversations, conversations);
  const invalid = newGame();
  invalid.conversations.warden = { responseId: 'resp_bad', model: 'test', messageCount: 100 };
  assert.equal(gameSchema.safeParse(invalid).success, false);
});
