import type { Game } from './validation.ts';
export type { Command, Game } from './validation.ts';

export const locations = ['forest', 'village', 'ruins'] as const;
export type Location = typeof locations[number];

export const world = {
  forest: { name: 'The Lantern Path', npc: 'warden' },
  village: { name: 'Lanternrest', npc: 'elder' },
  ruins: { name: 'The Old Ruins', npc: 'guide' },
} as const;

export const npcNames = { warden: 'The Old Man', elder: 'Elder Mara', guide: 'Rowan' };
export const playerMaxHp = 12;
export const guardianMaxHp = 10;

export type NpcId = keyof typeof npcNames;
export type GameView = {
  game: Game;
  revision: string;
  hasSave: boolean;
  dialogueMode: 'scripted' | 'openai';
};

export function npcAt(game: Game): NpcId {
  return world[game.location].npc;
}

export function inventory(game: Game): string[] {
  return game.events.includes('relic-claimed') ? ['Amber Relic'] : [];
}

export function questPhase(game: Game) {
  return game.events.length;
}

export function canTravel(game: Game, destination: Location) {
  return game.playerHp > 0 && (destination !== 'ruins' || questPhase(game) > 0);
}
