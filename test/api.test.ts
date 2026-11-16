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

async function launch(filename: string) {
  const api = createGameApi({ filename });
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
    assert.match(view.game.memory.guide.at(-1)!.text, /I beat the guardian/);
    view = await second.send(view.revision, { type: 'claim' });
    assert.deepEqual(view.game.events, ['quest-accepted', 'ruins-entered']);
  } finally {
    await second.close();
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
