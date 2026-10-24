import { FilterError } from './errors.ts';

export const ZONES = ['high', 'mid', 'low'] as const;
export type Zone = (typeof ZONES)[number];

/** Accepts ["High", "mid"] or ["high,mid"]; returns unique lowercase zones. */
export function parseZones(values: string[], param: string): Zone[] {
  const out: Zone[] = [];
  for (const value of values) {
    for (const piece of value.split(',')) {
      const z = piece.trim().toLowerCase();
      if (z === '') continue;
      if (!(ZONES as readonly string[]).includes(z)) {
        throw new FilterError(`Unknown ${param} "${piece.trim()}" (use ${ZONES.join(', ')})`);
      }
      if (!out.includes(z as Zone)) out.push(z as Zone);
    }
  }
  return out;
}