import { z } from 'zod';
import { canTravel, guardianMaxHp, npcAt, playerMaxHp, questPhase } from '../shared/game.ts';
import type { Command, Game, Location } from '../shared/game.ts';

export const replySchema = z.strictObject({
  dialogue: z.string().trim().min(1).max(500),
  action: z.enum(['CLAIM_RELIC', 'NONE']).optional(),
});

export function newGame(): Game {
  return {
    location: 'forest', playerHp: playerMaxHp, guardianHp: guardianMaxHp, braced: false,
    events: [], memory: { warden: [], elder: [], guide: [] },
    narration: 'You reach the lantern road just before nightfall. An old man tends a roadside fire, his face half hidden beneath a hood.',
  };
}

function say(game: Game, narration: string): Game {
  return { ...game, narration };
}

export function travel(game: Game, destination: Location): Game {
  if (destination === game.location || !canTravel(game, destination)) return game;

  const enteringRuins = destination === 'ruins' && questPhase(game) === 1;
  const arrivals = {
    forest: 'The old man looks up from the fire as you return.',
    village: 'Warm light spills from the windows of Lanternrest.',
    ruins: 'Rowan waits under the broken arch, one gloved hand resting on his sword.',
  };
  return {
    ...game, location: destination, braced: false,
    events: enteringRuins ? [...game.events, 'ruins-entered'] : game.events,
    narration: enteringRuins ? 'The old guardian wakes as you approach the sealed relic.' : arrivals[destination],
  };
}

function takeTurn(game: Game, move: 'strike' | 'brace'): Game {
  if (game.location !== 'ruins' || questPhase(game) !== 2 || game.playerHp === 0) return game;
  if (move === 'brace' && game.braced) return say(game, 'You are already braced. Strike to use your opening.');

  const damage = move === 'brace' ? 0 : game.braced ? 5 : 3;
  const guardianHp = Math.max(0, game.guardianHp - damage);
  if (guardianHp === 0) {
    return {
      ...game, guardianHp, braced: false, events: [...game.events, 'guardian-defeated'],
      narration: 'The guardian falls. The seal around the Amber Relic fades.',
    };
  }

  const counter = move === 'brace' ? 1 : 4;
  const playerHp = Math.max(0, game.playerHp - counter);
  let narration = `You deal ${damage} damage. The guardian counters for ${counter}.`;
  if (move === 'brace') narration = 'You take 1 damage and find an opening. Your next strike deals 5.';
  if (playerHp === 0) narration = 'The guardian defeats you. Retry the encounter to recover.';
  return { ...game, guardianHp, playerHp, braced: move === 'brace' && playerHp > 0, narration };
}

function claimRelic(game: Game): Game {
  if (game.location !== 'ruins' || questPhase(game) !== 3 || game.guardianHp !== 0 || game.playerHp === 0) return game;
  return {
    ...game, events: [...game.events, 'relic-claimed'],
    narration: 'You recover the Amber Relic. The disturbance ends.',
  };
}

export function applyNpcResponse(game: Game, response: unknown): { game: Game; dialogue: string } {
  const reply = replySchema.safeParse(response);
  if (!reply.success) return { game, dialogue: 'Give me a moment to think.' };
  if (reply.data.action !== 'CLAIM_RELIC') return { game, dialogue: reply.data.dialogue };
  if (questPhase(game) === 4) return { game, dialogue: 'The Amber Relic is already yours.' };

  const next = claimRelic(game);
  if (next === game) return { game, dialogue: 'The relic stays sealed until the guardian is defeated.' };
  return { game: next, dialogue: reply.data.dialogue };
}

export function startsQuestHere(game: Game) {
  return npcAt(game) === 'elder' && questPhase(game) === 0;
}

export function recordConversation(game: Game, message: string, proposedReply: unknown): Game {
  const npc = npcAt(game);
  const result = startsQuestHere(game)
    ? {
        game: { ...game, events: ['quest-accepted'] as Game['events'], narration: 'Quest begun: The Amber Relic.' },
        dialogue: 'An amber light has returned to the old ruins. Find Rowan there and recover the Amber Relic before the seal fails.',
      }
    : applyNpcResponse(game, proposedReply);
  return {
    ...result.game,
    memory: {
      ...game.memory,
      [npc]: [
        ...game.memory[npc],
        { speaker: 'player', text: message },
        { speaker: 'npc', text: result.dialogue },
      ].slice(-24),
    },
  };
}

export function applyMove(game: Game, move: Exclude<Command['type'], 'talk' | 'travel' | 'save' | 'load'>): Game {
  switch (move) {
    case 'strike':
    case 'brace': return takeTurn(game, move);
    case 'claim': return claimRelic(game);
    case 'retry':
      return game.playerHp === 0
        ? { ...game, playerHp: playerMaxHp, guardianHp: guardianMaxHp, braced: false, narration: 'You return to the entrance of the ruins and take up your weapon.' }
        : game;
    case 'restart': return newGame();
  }
}
