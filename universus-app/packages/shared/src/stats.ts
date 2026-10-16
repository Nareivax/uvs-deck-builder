import { FilterError } from './errors.ts';
import { NUMBER_OPS, parseNumber } from './keywordFilter.ts';
import type { NumberOp } from './keywordFilter.ts';

/**
 * The numeric card stats that can be filtered. To offer another stat: add it here, add its
 * column to STAT_COLUMNS in apps/api/src/cardQuery.ts, and the filter box in the web app
 * appears by itself (it is built from /meta).
 */
export const STATS = [
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'control', label: 'Control' },
  { key: 'block_modifier', label: 'Block modifier' },
  { key: 'attack_speed', label: 'Speed' },
  { key: 'attack_damage', label: 'Damage' },
  { key: 'hand_size', label: 'Hand size' },
  { key: 'vitality', label: 'Vitality' },
] as const;

export type StatKey = (typeof STATS)[number]['key'];

export interface StatFilter {
  stat: StatKey;
  op: NumberOp;
  n: number;
}

const STAT_KEYS: readonly string[] = STATS.map((s) => s.key);

/**
 * One `stat` query parameter, repeated for several (AND):
 *   difficulty:3          exactly 3
 *   difficulty:lte:3      3 or less   (ops: eq, gt, gte, lt, lte)
 *   control:gte:4
 * A card that has no value for the stat (a character has no difficulty) never matches.
 */
export function parseStatFilter(input: string): StatFilter {
  const parts = input.split(':').map((p) => p.trim());
  const stat = (parts[0] ?? '').toLowerCase().replace(/[ -]/g, '_');
  if (!STAT_KEYS.includes(stat)) {
    throw new FilterError(`Unknown stat "${parts[0]}" (use ${STAT_KEYS.join(', ')})`);
  }
  if (parts.length === 2) {
    return { stat: stat as StatKey, op: 'eq', n: parseNumber(parts[1], input) };
  }
  if (parts.length === 3) {
    const op = parts[1].toLowerCase();
    if (!NUMBER_OPS.includes(op)) {
      throw new FilterError(`Stat filter "${input}": unknown operator "${parts[1]}" (use eq, gt, gte, lt, lte)`);
    }
    return { stat: stat as StatKey, op: op as NumberOp, n: parseNumber(parts[2], input) };
  }
  throw new FilterError(`Stat filter "${input}" should look like difficulty:lte:3`);
}
