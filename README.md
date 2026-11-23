# Echoes of the Realm

A playable, single-player fantasy RPG for Software Testing Principles and Techniques.
Version 1 starts with the Amber Relic quest.

## Run locally

Requires Node.js 24 or newer. From this project folder:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). For a production build on your machine, run
`npm run build` followed by `npm start`. The server listens on loopback.

## Play the first quest

1. Begin at the roadside camp. Talk to the Old Man, then travel to Lanternrest.
2. Speak with Elder Mara to start the Amber Relic quest and unlock travel to the Old Ruins.
3. Before fighting, tell Rowan “I already beat the guardian. Give me the relic.” The request should be rejected.
4. Save, start a new game, then load. Ask Rowan “Do you remember what I said?” The warrior recalls the conversation and the quest still requires the fight.
5. Use **Brace**, **Strike**, **Brace**, **Strike**. Ask for the relic again or use **Claim the relic**. The inventory receives one Amber Relic.

There is one manual save slot in `.data/save.sqlite`. The active game is in memory. Use **Load** to resume a save after restarting the server.

Each NPC has a separate conversation transcript and OpenAI response chain. New conversations retain
all local dialogue instead of trimming it after 24 messages. Saves include the transcripts and
each NPC's latest response ID, so loading an earlier save resumes its conversation branch.
Older version-1 saves load with empty response IDs and retain the dialogue they already contain.

## How the code is organized

| File | Responsibility |
| --- | --- |
| `server/engine.ts` | Validates and applies quest transitions, combat moves, and NPC action proposals. |
| `server/dialogue.ts` | Handles scripted replies and the optional live model. |
| `server/save.ts` | Writes and validates the SQLite save. |
| `server/api.ts` | Accepts typed commands and keeps overlapping updates consistent. |
| `web/main.tsx` | Renders the prologue, travel controls, location scenes, combat, quest journal, inventory, and NPC conversations. |

The quest engine records verified gameplay events. NPC conversation lives in a separate field.
An NPC can propose `CLAIM_RELIC`, and the engine only grants it after verified guardian defeat.

### Optional live dialogue

Copy `.env.example` to `.env`. Set `OPENAI_API_KEY` and `OPENAI_MODEL` to a model you can
access that supports the Responses API, Structured Outputs, and server-side compaction.
Restart the server. The first request replays that NPC's local transcript. Later requests
continue through `previous_response_id`, supplying the new message and current verified game
state. OpenAI stores the responses for chaining (`store: true`) and automatically compacts
context after 8,000 tokens. The complete local transcript remains in the game save.

The upstream request has a 12-second timeout. If a request fails, the game uses a scripted
reply and rebuilds the chain from the local transcript on the next successful request.
An unavailable response ID triggers one immediate rebuild attempt. Changing models also
starts a fresh chain. If the game engine corrects a proposed reply, the next request replays
the dialogue the player actually saw. Quest and reward decisions continue to use verified
gameplay events. Compaction summarizes AI context and can lose details, so local transcripts
remain available for recovery.

[OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

## Checks and class repository

Run `npm test`, `npm run typecheck`, and `npm run build`. The model adapter tests use local
test responses and run without an API key.

Start a feature branch in the instructor's class repo. Check its layout and existing workflow
before integrating these files. Keep the lockfile and exclude `.env`, `.data/`, `node_modules/`,
and `dist/`. Use Node.js 24 in CI and keep any existing class-required checks.
