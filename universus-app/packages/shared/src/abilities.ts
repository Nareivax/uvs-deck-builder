import { FilterError } from './errors.ts';

/**
 * Ability types stored (lowercase) in cards.ability_types.
 * Keep in sync with db/data/ability_types.csv in the database repo.
 */
export const ABILITY_TYPES = ['blitz', 'enhance', 'form', 'response'] as const;
export type AbilityType = (typeof ABILITY_TYPES)[number];

/** Accepts ["Blitz", "response"] or ["blitz,response"]; returns unique lowercase types. */
export function parseAbilityTypes(values: string[]): AbilityType[] {
  const out: AbilityType[] = [];
  for (const value of values) {
    for (const piece of value.split(',')) {
      const t = piece.trim().toLowerCase();
      if (t === '') continue;
      if (!(ABILITY_TYPES as readonly string[]).includes(t)) {
        throw new FilterError(`Unknown ability type "${piece.trim()}" (use ${ABILITY_TYPES.join(', ')})`);
      }
      if (!out.includes(t as AbilityType)) out.push(t as AbilityType);
    }
  }
  return out;
}
