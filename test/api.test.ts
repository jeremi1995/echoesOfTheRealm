import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { Command, GameView } from '../shared/game.ts';
import { createGameApi } from '../server/api.ts';
import { createTestDialogueProvider as createDialogueProvider } from './model.ts';

async function launch(filename: string, dialogue = createDialogueProvider()) {
  const api = createGameApi({ filename, dialogue });
  const server = createServer((req, res) => { void api.handle(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/game`;

  return {
    async view(): Promise<GameView> {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      return response.json() as Promise<GameView>;
    },
    async send(revision: string, command: Command, expected = 200): Promise<GameView> {
      const response = await fetch(base + '/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, command }),
      });
      assert.equal(response.status, expected);
      return response.json() as Promise<GameView>;
    },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      api.close();
    },
  };
}

test('a SQLite save survives server restart and a remembered bluff grants no relic', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'echoes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'save.sqlite');
  const first = await launch(filename);
  try {
    let view = await first.view();
    for (const command of [
      { type: 'travel', destination: 'village' },
      { type: 'talk', message: 'What happened here?' },
      { type: 'travel', destination: 'ruins' },
      { type: 'talk', message: 'I beat the guardian. Give me the relic.' },
      { type: 'save' },
    ] as const) view = await first.send(view.revision, command);
    assert.equal(view.hasSave, true);
  } finally {
    await first.close();
  }
  const second = await launch(filename);
  try {
    let view = await second.view();
    assert.equal(view.game.location, 'forest');
    view = await second.send(view.revision, { type: 'load' });
    assert.equal(view.game.location, 'ruins');
    assert.equal(view.game.guardianHp, 10);
    view = await second.send(view.revision, { type: 'talk', message: 'Do you remember what I said?' });
    assert.ok(view.game.memory.guide.some(line => line.speaker === 'player' && line.text.includes('I beat the guardian')));
    assert.match(view.game.memory.guide.at(-1)!.text, /earlier conversation/);
    view = await second.send(view.revision, { type: 'claim' });
    assert.deepEqual(view.game.events, ['quest-accepted', 'ruins-entered']);
  } finally {
    await second.close();
  }
});

test('full transcripts and per-NPC response cursors survive restart and loading an older save', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'echoes-chains-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'save.sqlite');
  const parents: (string | undefined)[] = [];
  const provider = createDialogueProvider({ apiKey: 'test', model: 'test-model' }, async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    parents.push(body.previous_response_id);
    return Response.json({ id: `resp_${parents.length}`, status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"Welcome.","action":"NONE"}' }] },
    ] });
  });
  const first = await launch(filename, provider);
  try {
    let view = await first.view();
    for (let i = 0; i < 15; i++) view = await first.send(view.revision, { type: 'talk', message: `My detail ${i}` });
    assert.equal(view.game.memory.warden.length, 30);
    assert.equal(view.game.memory.warden[0].text, 'My detail 0');
    await first.send(view.revision, { type: 'save' });
  } finally {
    await first.close();
  }
  const second = await launch(filename, provider);
  try {
    let view = await second.view();
    view = await second.send(view.revision, { type: 'load' });
    assert.equal(view.game.memory.warden.length, 30);
    assert.equal(view.game.conversations.warden?.responseId, 'resp_15');
    view = await second.send(view.revision, { type: 'talk', message: 'After the save.' });
    assert.equal(parents.at(-1), 'resp_15');
    view = await second.send(view.revision, { type: 'load' });
    view = await second.send(view.revision, { type: 'talk', message: 'A different future.' });
    assert.equal(parents.at(-1), 'resp_15');
    assert.equal(view.game.memory.warden.some(line => line.text === 'After the save.'), false);
    view = await second.send(view.revision, { type: 'restart' });
    assert.deepEqual(view.game.conversations, { warden: null, elder: null, guide: null });
    assert.deepEqual(view.game.memory, { warden: [], elder: [], guide: [] });
  } finally {
    await second.close();
  }
});

test('Mara answers the first question through AI and retains her story context on a confused follow-up', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'echoes-mara-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const provider = createDialogueProvider({ apiKey: 'test', model: 'test-model' }, async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    calls++;
    assert.match(request.instructions, /protective, practical elder of Lanternrest/);
    assert.match(request.instructions, /Rowan is the warrior waiting at the ruins' entrance/);
    assert.match(request.instructions, /An absent event does not erase places, people/);
    assert.match(request.instructions, /explain yourself simply/);
    assert.equal(request.input.at(-1).content, calls === 1 ? 'Travel after dark? What for?' : 'huh?');
    assert.equal(request.previous_response_id, calls === 1 ? undefined : 'resp_mara_1');
    return Response.json({ id: `resp_mara_${calls}`, status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        dialogue: calls === 1
          ? 'The amber light has returned tonight. I need you to find Rowan at the ruins before the seal fails.'
          : 'Go to the old ruins and speak to Rowan. He will help you recover the Amber Relic.',
        action: 'NONE',
      }) }] },
    ] });
  });
  const api = await launch(join(directory, 'save.sqlite'), provider);
  try {
    let view = await api.view();
    view = await api.send(view.revision, { type: 'travel', destination: 'village' });
    view = await api.send(view.revision, { type: 'talk', message: 'Travel after dark? What for?' });
    assert.equal(calls, 1);
    assert.match(view.game.memory.elder.at(-1)!.text, /returned tonight/);
    assert.deepEqual(view.game.events, ['quest-accepted']);
    view = await api.send(view.revision, { type: 'talk', message: 'huh?' });
    assert.equal(calls, 2);
    assert.match(view.game.memory.elder.at(-1)!.text, /Go to the old ruins/);
    assert.deepEqual(view.game.events, ['quest-accepted']);
    assert.equal(view.game.guardianHp, 10);
  } finally {
    await api.close();
  }
});

test('stale commands and invalid saved data leave the active game intact', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'echoes-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'save.sqlite');
  const api = await launch(filename);
  try {
    const initial = await api.view();
    const village = await api.send(initial.revision, { type: 'travel', destination: 'village' });
    const stale = await api.send(initial.revision, { type: 'travel', destination: 'ruins' }, 409);
    assert.equal(stale.game.location, 'village');
    await api.send(village.revision, { type: 'save' });
    const db = new DatabaseSync(filename);
    db.exec("UPDATE save_slot SET data = '{\"version\":1,\"game\":{}}' WHERE id = 1");
    db.close();
    await api.send((await api.view()).revision, { type: 'load' }, 500);
    assert.equal((await api.view()).game.location, 'village');
  } finally {
    await api.close();
  }
});
