import {
  FilterError,
  parseAbilityTypes,
  parseKeywordFilter,
  parseStatFilter,
  parseSymbolFilter,
  parseZones,
} from '@universus/shared';
import type { CardSearchParams } from './cardQuery.ts';

export type RawQuery = Record<string, string | string[] | undefined>;

function many(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function one(v: string | string[] | undefined): string | undefined {
  const first = many(v)[0]?.trim();
  return first ? first : undefined;
}

function intParam(v: string | string[] | undefined, name: string, def: number, min: number, max: number): number {
  const text = one(v);
  if (text === undefined) return def;
  if (!/^\d+$/.test(text)) throw new FilterError(`${name} must be a whole number`);
  const n = Number(text);
  if (n < min || n > max) throw new FilterError(`${name} must be between ${min} and ${max}`);
  return n;
}

/** Turns the query string of GET /cards into validated search parameters. */
export function parseCardSearch(query: RawQuery): CardSearchParams {
  const q = one(query.q);
  if (q !== undefined && q.length > 200) throw new FilterError('q is too long (200 characters max)');

  const nonBlank = (v: string | string[] | undefined) => many(v).filter((s) => s.trim() !== '');
  const keywordParams = nonBlank(query.keyword);
  if (keywordParams.length > 20) throw new FilterError('At most 20 keyword filters are allowed');
  const keywordAnyParams = nonBlank(query.keyword_any);
  if (keywordAnyParams.length > 50) throw new FilterError('At most 50 keyword_any filters are allowed');
  const symbolParams = nonBlank(query.symbol);
  const symbolAnyParams = nonBlank(query.symbol_any);
  if (symbolParams.length > 30 || symbolAnyParams.length > 30) {
    throw new FilterError('At most 30 symbol filters are allowed');
  }

  const statParams = many(query.stat).filter((s) => s.trim() !== '');
  if (statParams.length > 20) throw new FilterError('At most 20 stat filters are allowed');

  const match = one(query.ability_match) ?? 'all';
  if (match !== 'all' && match !== 'any') throw new FilterError('ability_match must be "all" or "any"');

  return {
    q,
    types: many(query.type).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20),
    sets: many(query.set).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20),
    format: one(query.format),
    keywords: keywordParams.map(parseKeywordFilter),
    keywordsAny: keywordAnyParams.map(parseKeywordFilter),
    symbols: symbolParams.map(parseSymbolFilter),
    symbolsAny: symbolAnyParams.map(parseSymbolFilter),
    stats: statParams.map(parseStatFilter),
    abilities: parseAbilityTypes(many(query.ability)),
    abilityMatch: match,
    page: intParam(query.page, 'page', 1, 1, 10000),
    pageSize: intParam(query.page_size, 'page_size', 50, 1, 200),
    blockZones: parseZones(many(query.block_zone), 'block_zone'),
    attackZones: parseZones(many(query.attack_zone), 'attack_zone'),
  };
}
