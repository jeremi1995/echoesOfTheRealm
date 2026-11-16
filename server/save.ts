import { DatabaseSync } from 'node:sqlite';
import { gameSchema } from '../shared/validation.ts';
import type { Game } from '../shared/game.ts';

export function openSave(filename: string) {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS save_slot (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
  const read = db.prepare('SELECT data FROM save_slot WHERE id = 1');
  const write = db.prepare('INSERT INTO save_slot (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data');
  return {
    hasSave: () => Boolean(read.get()),
    save(game: Game) {
      write.run(JSON.stringify({ version: 1, game }));
    },
    load(): Game | undefined {
      const row = read.get();
      if (!row) return undefined;
      const saved: unknown = JSON.parse(String(row.data));
      if (typeof saved !== 'object' || saved === null || !('version' in saved) || saved.version !== 1 || !('game' in saved)) {
        throw new Error('Unrecognized save format');
      }
      return gameSchema.parse(saved.game);
    },
    close: () => db.close(),
  };
}
