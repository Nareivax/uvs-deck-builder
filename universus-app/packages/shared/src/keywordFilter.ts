import { FilterError } from './errors.ts';

/**
 * Keyword filter syntax, one filter per `keyword` query parameter:
 *
 *   powerful               has Powerful (any rating)
 *   powerful:2             rating exactly 2 (shorthand for eq)
 *   powerful:gte:2         rating >= 2   (ops: eq, gt, gte, lt, lte)
 *   combo:detail:kick      detail text equals "kick" (case-insensitive)
 *   combo:detail_contains:ki   detail text contains "ki"
 *   breaker:requirement:kyo   keyword applies under a requirement (character, trait or state);
 *                         a list like "Benimaru/Goro/Kyo" matches any one of its names
 *   char. trait:detail:brawler   a character trait
 *
 * Repeat the parameter to require several keywords (AND). The same keyword may be
 * repeated, e.g. two Char. Trait filters for a character with two traits.
 */
export type NumberOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
export type DetailOp = 'eq' | 'contains';

export interface KeywordFilter {
  name: string;
  value?: { op: NumberOp; n: number };
  detail?: { op: DetailOp; text: string };
  /** One name; matches when it is any one of the alternatives in the card's requirement. */
  requirement?: string;
}

const NUMBER_OPS: readonly string[] = ['eq', 'gt', 'gte', 'lt', 'lte'];

function parseNumber(text: string, input: string): number {
  if (!/^-?\d+$/.test(text)) {
    throw new FilterError(`Keyword filter "${input}": "${text}" is not a whole number`);
  }
  const n = Number(text);
  if (Math.abs(n) > 1000) {
    throw new FilterError(`Keyword filter "${input}": rating ${n} is out of range`);
  }
  return n;
}

export function parseKeywordFilter(input: string): KeywordFilter {
  const parts = input.split(':').map((p) => p.trim());
  const name = parts[0] ?? '';
  if (name === '') throw new FilterError(`Keyword filter "${input}" has no keyword name`);
  if (name.length > 60) throw new FilterError('Keyword name is too long');

  if (parts.length === 1) return { name };

  const second = parts[1].toLowerCase();

  if (second === 'detail' || second === 'detail_contains') {
    const text = parts.slice(2).join(':').trim();
    if (text === '') throw new FilterError(`Keyword filter "${input}" has an empty detail`);
    if (text.length > 100) throw new FilterError('Keyword detail is too long');
    return { name, detail: { op: second === 'detail' ? 'eq' : 'contains', text } };
  }

  if (second === 'requirement') {
    const text = parts.slice(2).join(':').trim();
    if (text === '') throw new FilterError(`Keyword filter "${input}" has an empty requirement`);
    if (text.length > 100) throw new FilterError('Keyword requirement is too long');
    return { name, requirement: text };
  }

  if (NUMBER_OPS.includes(second)) {
    if (parts.length !== 3) {
      throw new FilterError(`Keyword filter "${input}" should look like name:${second}:number`);
    }
    return { name, value: { op: second as NumberOp, n: parseNumber(parts[2], input) } };
  }

  if (parts.length === 2) {
    return { name, value: { op: 'eq', n: parseNumber(parts[1], input) } };
  }

  throw new FilterError(
    `Keyword filter "${input}": unknown operator "${second}" (use eq, gt, gte, lt, lte, detail, detail_contains or requirement)`,
  );
}
