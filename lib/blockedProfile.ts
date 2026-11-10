// lib/blockedProfile.ts
// Block hone par samne wale ki pehchan (naam + avatar) chhupane ke constants.

export const BLOCKED_LABEL = 'undefined';
export const BLOCKED_COLOR = '#DBDBDB';

/** Kya ye naam + color masked (blocked) profile ka hai? */
export function isMaskedIdentity(
  name?: string | null,
  color?: string | null
): boolean {
  return name === BLOCKED_LABEL && color === BLOCKED_COLOR;
}
