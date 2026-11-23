import { z } from 'zod';
import { guardianMaxHp, locations, playerMaxHp } from './game.ts';

const eventOrder = ['quest-accepted', 'ruins-entered', 'guardian-defeated', 'relic-claimed'] as const;
const line = z.object({
  speaker: z.enum(['player', 'npc']),
  text: z.string().trim().min(1).max(500),
});

const conversation = z.object({
  responseId: z.string().regex(/^resp_[A-Za-z0-9_-]+$/),
  model: z.string().min(1).max(200),
  messageCount: z.number().int().nonnegative(),
});

export const gameSchema = z.object({
  location: z.enum(locations),
  playerHp: z.number().int().min(0).max(playerMaxHp),
  guardianHp: z.number().int().min(0).max(guardianMaxHp),
  braced: z.boolean(),
  events: z.array(z.enum(eventOrder)).max(eventOrder.length),
  memory: z.object({
    warden: z.array(line).default([]),
    elder: z.array(line),
    guide: z.array(line),
  }),
  conversations: z.object({
    warden: conversation.nullable(),
    elder: conversation.nullable(),
    guide: conversation.nullable(),
  }).default({ warden: null, elder: null, guide: null }),
  narration: z.string().max(500),
}).refine(game => {
  const step = game.events.length;
  return game.events.every((event, index) => event === eventOrder[index])
    && (game.location !== 'ruins' || step >= 2)
    && (step >= 3 ? game.guardianHp === 0 : game.guardianHp > 0)
    && (step >= 2 || (game.guardianHp === guardianMaxHp && game.playerHp === playerMaxHp))
    && (game.playerHp > 0 || (step === 2 && game.location === 'ruins'))
    && (!game.braced || (step === 2 && game.location === 'ruins' && game.playerHp > 0))
    && Object.entries(game.conversations).every(([npc, cursor]) =>
      cursor === null || cursor.messageCount <= game.memory[npc as keyof typeof game.memory].length);
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
