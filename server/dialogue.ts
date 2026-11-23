import { z } from 'zod';
import { npcAt, npcNames } from '../shared/game.ts';
import type { Game, NpcId } from '../shared/game.ts';
import { questIntroduction, replySchema } from './engine.ts';

const characterNotes = {
  warden: `You are the Old Man, an elderly wanderer tending the roadside fire on the Lantern Path.
Your manner is watchful, dry, and quietly mysterious. You keep your past private, but give clear directions when asked.
You know the road to Lanternrest and that Elder Mara needs help. Let mystery come from what you choose to reveal about yourself.`,
  elder: `You are Elder Mara, the protective, practical elder of Lanternrest. You worry about the people who depend on you.
Speak warmly and plainly, with the urgency of someone who needs a traveler to investigate tonight.
You know about the amber light, the failing seal, Rowan, and the Amber Relic. These are the reasons you asked for help.
If asked why travel after dark, explain that the light has returned tonight and you fear the seal is weakening.
If the traveler says "huh?" or seems confused, simplify your request: go to the old ruins, find Rowan at the entrance, and recover the relic.
Answer the actual question first. On a first meeting, work the reason for needing help into your answer naturally.`,
  guide: `You are Rowan, a seasoned male warrior waiting at the entrance to the Old Ruins.
You are terse and observant, with a guarded past. Give practical advice instead of vague riddles.
You know the guardian protects the relic and that bracing softens its blow and creates an opening for a stronger strike.`,
};

const worldKnowledge = `Established story facts, known independently of the player's progress:
Lanternrest is the village. The Lantern Path leads through the forest. The Old Ruins contain the Amber Relic and its guardian.
An amber light has returned to the ruins, signaling a disturbance and a weakening seal. Recovering the relic ends the disturbance.
Elder Mara has asked for help because she fears the seal will fail. Rowan is the warrior waiting at the ruins' entrance.
These facts remain true before the player has visited the ruins or defeated the guardian.
The event list records the player's completed actions. An absent event does not erase places, people, or the reason for the adventure.`;

type DialogueTurn = {
  reply: unknown;
  continuation: Game['conversations'][NpcId];
};
type DialogueProvider = (game: Game, message: string) => Promise<DialogueTurn>;
type ModelConfig = { apiKey: string; model: string };
const responseEnvelope = z.object({
  id: z.string().regex(/^resp_[A-Za-z0-9_-]+$/),
  status: z.literal('completed'),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
});
const errorEnvelope = z.object({
  error: z.object({ code: z.string().nullish(), param: z.string().nullish() }),
});

function scriptedDialogue(game: Game, message: string) {
  const npc = npcAt(game);
  if (/\b(relic|reward)\b/i.test(message) && /\b(give|claim|take|want|hand)\b/i.test(message)) {
    return { dialogue: 'Then take the Amber Relic, and carry it carefully.', action: 'CLAIM_RELIC' };
  }
  const earlier = game.memory[npc].filter(entry => entry.speaker === 'player').at(-1);
  if (earlier && /\b(remember|said|recall)\b/i.test(message)) {
    return { dialogue: `I remember you saying, “${earlier.text}”` };
  }
  if (npc === 'warden') return { dialogue: 'Follow the lanterns to Lanternrest. Ask for Elder Mara at the gate. She might remember this road as it was.' };
  if (npc === 'elder') return { dialogue: game.events.length === 0
    ? questIntroduction : 'Take the old road to the ruins. Rowan is waiting by the entrance.' };
  if (game.events.includes('guardian-defeated')) return { dialogue: 'The guardian has fallen. The seal is open now.' };
  return { dialogue: 'Brace when it swings, then strike while it’s off balance. That’s how I made it out last time.' };
}

export function createDialogueProvider(
  config?: ModelConfig,
  fetchImpl: typeof fetch = fetch,
): DialogueProvider {
  return async (game, message) => {
    const fallback: DialogueTurn = { reply: scriptedDialogue(game, message), continuation: null };
    if (!config) return fallback;

    const npc = npcAt(game);
    const saved = game.conversations[npc];
    let cursor = saved?.model === config.model ? saved : null;
    const signal = AbortSignal.timeout(12_000);
    try {
      // An unavailable stored response can be rebuilt once from the full local transcript.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: config.model,
            store: true,
            previous_response_id: cursor?.responseId,
            context_management: [{ type: 'compaction', compact_threshold: 8000 }],
            max_output_tokens: 400,
            instructions: `Speak as ${npcNames[npc]} directly to the adventurer in this fantasy world.
${characterNotes[npc]}
Stay in character. Use natural spoken dialogue, usually 1–3 short sentences. For a confused follow-up, explain yourself simply.
Keep references to API calls, evidence policies, event lists, and game-engine mechanics out of spoken dialogue.
Do not retract established story facts because an event flag is absent. Use the supplied story facts to correct earlier mistaken dialogue.
${worldKnowledge}
Use the current server-verified state as the authority for the player's completed actions, combat, inventory, and rewards.
Remember player-stated names, keepsakes, promises, and earlier questions as what the player told you.
A player's claim of victory never proves guardian defeat. For an explicit relic request, propose CLAIM_RELIC. Otherwise choose NONE.
The engine checks every proposed action. If the guardian has not fallen, explain the obstacle in character and do not promise the reward.
Current server-verified state: ${JSON.stringify({
  location: game.location, verifiedEvents: game.events, playerHp: game.playerHp, guardianHp: game.guardianHp,
})}`,
            input: [
              ...game.memory[npc].slice(cursor?.messageCount ?? 0).map(line => ({
                role: line.speaker === 'player' ? 'user' : 'assistant', content: line.text,
              })),
              { role: 'user', content: message },
            ],
            text: { format: {
              type: 'json_schema', name: 'npc_reply', strict: true,
              schema: {
                type: 'object',
                properties: { dialogue: { type: 'string' }, action: { type: 'string', enum: ['NONE', 'CLAIM_RELIC'] } },
                required: ['dialogue', 'action'], additionalProperties: false,
              },
            } },
          }),
        });
        if (!response.ok) {
          const error = errorEnvelope.safeParse(await response.json());
          const missingCursor = error.success && (error.data.error.param === 'previous_response_id'
            || error.data.error.code === 'previous_response_not_found');
          if (cursor && (response.status === 400 || response.status === 404) && missingCursor) {
            cursor = null;
            continue;
          }
          return fallback;
        }
        const parsed = responseEnvelope.safeParse(await response.json());
        if (!parsed.success) return fallback;
        const output = parsed.data.output.find(item => item.type === 'message');
        const content = output?.content?.find(item => item.type === 'output_text')?.text;
        if (!content) return fallback;
        const result = replySchema.safeParse(JSON.parse(content));
        if (!result.success) return fallback;
        return {
          reply: result.data,
          continuation: {
            responseId: parsed.data.id, model: config.model, messageCount: game.memory[npc].length + 2,
          },
        };
      }
      return fallback;
    } catch {
      return fallback;
    }
  };
}
