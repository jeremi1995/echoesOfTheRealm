import { z } from 'zod';
import { guardianMaxHp, locations, playerMaxHp } from './game.ts';

const eventOrder = ['quest-accepted', 'ruins-entered', 'guardian-defeated', 'relic-claimed'] as const;
const line = z.object({
  speaker: z.enum(['player', 'npc']),
  text: z.string().trim().min(1).max(500),
});

export const gameSchema = z.object({
  location: z.enum(locations),
  playerHp: z.number().int().min(0).max(playerMaxHp),
  guardianHp: z.number().int().min(0).max(guardianMaxHp),
  braced: z.boolean(),
  events: z.array(z.enum(eventOrder)).max(eventOrder.length),
  memory: z.object({
    warden: z.array(line).max(24).default([]),
    elder: z.array(line).max(24),
    guide: z.array(line).max(24),
  }),
  narration: z.string().max(500),
}).refine(game => {
  const step = game.events.length;
  return game.events.every((event, index) => event === eventOrder[index])
    && (game.location !== 'ruins' || step >= 2)
    && (step >= 3 ? game.guardianHp === 0 : game.guardianHp > 0)
    && (step >= 2 || (game.guardianHp === guardianMaxHp && game.playerHp === playerMaxHp))
    && (game.playerHp > 0 || (step === 2 && game.location === 'ruins'))
    && (!game.braced || (step === 2 && game.location === 'ruins' && game.playerHp > 0));
});
export type Game = z.infer<typeof gameSchema>;

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('travel'), destination: z.enum(locations) }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('brace') }),
  z.object({ type: z.literal('claim') }),
  z.object({ type: z.literal('retry') }),
  z.object({ type: z.literal('save') }),
  z.object({ type: z.literal('load') }),
  z.object({ type: z.literal('restart') }),
  z.object({ type: z.literal('talk'), message: z.string().trim().min(1).max(240) }),
]);
export type Command = z.infer<typeof commandSchema>;
