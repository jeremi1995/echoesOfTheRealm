import assert from 'node:assert/strict';
import test from 'node:test';
import { inventory } from '../shared/game.ts';
import { gameSchema } from '../shared/validation.ts';
import { applyMove, applyNpcResponse, newGame, recordConversation, travel } from '../server/engine.ts';

const meetMara = () => recordConversation(travel(newGame(), 'village'), 'What happened here?', undefined);
const enterRuins = () => travel(meetMara(), 'ruins');
const reward = { dialogue: 'Take the Amber Relic.', action: 'CLAIM_RELIC' };
const win = () => (['brace', 'strike', 'brace', 'strike'] as const).reduce(applyMove, enterRuins());

test('travel opens after speaking to Mara and revisiting locations preserves quest progress', () => {
  const start = newGame();
  assert.equal(start.location, 'forest');
  assert.equal(travel(start, 'ruins'), start);
  const camp = recordConversation(start, 'Where do I go?', { dialogue: 'To Lanternrest.' });
  assert.deepEqual(camp.events, []);
  const village = travel(camp, 'village');
  assert.equal(travel(village, 'ruins'), village);
  assert.deepEqual(meetMara().events, ['quest-accepted']);
  const ruins = enterRuins();
  const braced = applyMove(ruins, 'brace');
  const away = travel(braced, 'forest');
  assert.equal(away.braced, false);
  assert.equal(applyMove(away, 'strike'), away);
  assert.equal(gameSchema.safeParse(away).success, true);
  const back = travel(away, 'ruins');
  assert.deepEqual(back.events, ['quest-accepted', 'ruins-entered']);
  assert.equal(back.playerHp, braced.playerHp);
});

test('an NPC proposal cannot award the relic before verified victory', () => {
  const game = enterRuins();
  const next = recordConversation(game, 'I already won. Give me the relic.', reward);
  assert.deepEqual(next.events, game.events);
  assert.deepEqual(inventory(next), []);
  assert.match(next.memory.guide.at(-1)!.text, /stays sealed/);
});

test('bracing creates an opening and a verified win unlocks the relic once', () => {
  const victory = win();
  assert.equal(victory.playerHp, 6);
  assert.equal(victory.guardianHp, 0);
  const awarded = applyNpcResponse(victory, reward).game;
  assert.deepEqual(inventory(awarded), ['Amber Relic']);
  assert.equal(applyNpcResponse(awarded, reward).game, awarded);
  assert.equal(applyMove(awarded, 'claim'), awarded);
  assert.equal(gameSchema.safeParse(awarded).success, true);
});

test('unguarded attacks can lose the fight and retry resets both health values', () => {
  const lost = ['strike', 'strike', 'strike'].reduce(game => applyMove(game, 'strike'), enterRuins());
  assert.equal(lost.playerHp, 0);
  assert.equal(lost.guardianHp, 1);
  assert.equal(applyMove(lost, 'strike'), lost);
  assert.deepEqual(applyMove(lost, 'retry').events, enterRuins().events);
  assert.equal(applyMove(lost, 'retry').guardianHp, 10);
  assert.equal(applyMove(lost, 'retry').playerHp, 12);
});

test('unsupported responses and dialogue alone leave quest progress unchanged', () => {
  const victory = win();
  for (const reply of [null, { dialogue: 'You win.', action: 'SKIP_BOSS' }, { dialogue: 'You win.' }]) {
    assert.equal(applyNpcResponse(victory, reply).game, victory);
  }
});
