import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { commandSchema } from '../shared/validation.ts';
import type { GameView } from '../shared/game.ts';
import { createDialogueProvider } from './dialogue.ts';
import { applyMove, newGame, recordConversation, startsQuestHere, travel } from './engine.ts';
import { openSave } from './save.ts';

const requestSchema = z.object({ revision: z.uuid(), command: commandSchema });
const bodyLimit = 4096;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.byteLength;
    if (size <= bodyLimit) chunks.push(chunk);
  }
  if (size > bodyLimit) throw new Error('Request body too large');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createGameApi({
  filename,
  model,
  dialogue = createDialogueProvider(model),
}: {
  filename: string;
  model?: { apiKey: string; model: string };
  dialogue?: ReturnType<typeof createDialogueProvider>;
}) {
  const saves = openSave(filename);
  let game = newGame();
  let revision = randomUUID();
  let pending = false;

  function view(): GameView {
    return { game, revision, hasSave: saves.hasSave(), dialogueMode: model ? 'openai' : 'scripted' };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/api/game') {
      json(res, 200, view());
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/game/command') {
      json(res, 404, { error: 'Unknown game endpoint.' });
      return;
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(res, 403, { error: 'The game only accepts commands from its own page.' });
      return;
    }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
      json(res, 415, { error: 'Send the command as JSON.' });
      return;
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: 'The command could not be read.' });
      return;
    }
    const request = requestSchema.safeParse(body);
    if (!request.success) {
      json(res, 400, { error: 'That command is invalid.' });
      return;
    }
    if (pending || request.data.revision !== revision) {
      json(res, 409, { ...view(), error: 'The game has another update. Try your command again.' });
      return;
    }

    pending = true;
    const { command } = request.data;
    try {
      if (command.type === 'save') {
        saves.save(game);
        game = { ...game, narration: 'Game saved.' };
      } else if (command.type === 'load') {
        const saved = saves.load();
        if (!saved) {
          json(res, 404, { error: 'There is no saved game yet.' });
          return;
        }
        game = { ...saved, narration: 'Game loaded.' };
      } else if (command.type === 'talk') {
        const reply = startsQuestHere(game) ? undefined : await dialogue(game, command.message);
        game = recordConversation(game, command.message, reply);
      } else if (command.type === 'travel') {
        game = travel(game, command.destination);
      } else {
        game = applyMove(game, command.type);
      }
      revision = randomUUID();
      json(res, 200, view());
    } catch {
      json(res, 500, { error: command.type === 'load'
        ? 'The save could not be loaded. Your current game is intact.'
        : 'The game could not complete that command.' });
    } finally {
      pending = false;
    }
  }

  return { handle, close: saves.close };
}
