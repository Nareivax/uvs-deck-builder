import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardSearch, escapeLike, buildNameSuggest } from './cardQuery.ts';
import type { CardSearchParams } from './cardQuery.ts';
import { parseCardSearch } from './parseQuery.ts';
import { FilterError } from '@universus/shared';

const base: CardSearchParams = {
  types: [],
  sets: [],
  keywords: [],
  keywordsAny: [],
  keywordsNot: [],
  stats: [],
  symbols: [],
  symbolsAny: [],
  symbolsNot: [],
  abilities: [],
  abilityMatch: 'all',
  page: 1,
  pageSize: 50,
  blockZones: [], 
  attackZones: [],
};

test('no filters: no WHERE, paging only', () => {
  const { text, values } = buildCardSearch(base);
  assert.ok(!text.includes('WHERE'));
  assert.ok(text.includes('LIMIT $1 OFFSET $2'));
  assert.deepEqual(values, [50, 0]);
});

test('paging offset', () => {
  const { values } = buildCardSearch({ ...base, page: 3, pageSize: 20 });
  assert.deepEqual(values, [20, 40]);
});

test('name, text, type, set and format filters use parameters', () => {
  const { text, values } = buildCardSearch({
    ...base, name: 'tom', text: 'draw 50%', types: ['attack'], sets: ['sf62x'], format: 'Standard',
  });
  assert.ok(text.includes('c.name ILIKE $1'));
  assert.ok(text.includes("websearch_to_tsquery('english', $2)"));
  assert.ok(text.includes('c.rules_text ILIKE $3'));
  assert.ok(text.includes('c.card_type = ANY($4::text[])'));
  assert.ok(text.includes('lower(s.code) = ANY($5::text[])'));
  assert.ok(text.includes('lower($6)'));
  assert.deepEqual(values, ['%tom%', 'draw 50%', '%draw 50\\%%', ['attack'], ['sf62x'], 'Standard', 50, 0]);
  assert.ok(!text.includes('Standard') && !text.includes('draw 50'));
});

test('name only does not touch rules text, and text only does not touch name', () => {
  const n = buildCardSearch({ ...base, name: 'tom' });
  assert.ok(!n.text.includes('rules_text'));
  const t = buildCardSearch({ ...base, text: 'draw' });
  assert.ok(!t.text.includes('c.name ILIKE'));
});

test('keyword filters: rating and detail', () => {
  const { text, values } = buildCardSearch({
    ...base,
    keywords: [
      { name: 'powerful', value: { op: 'gte', n: 2 } },
      { name: 'combo', detail: { op: 'eq', text: 'Kick' } },
      { name: 'combo', detail: { op: 'contains', text: 'k_' } },
    ],
  });
  assert.equal((text.match(/EXISTS \(SELECT 1 FROM card_keywords/g) ?? []).length, 3);
  assert.ok(text.includes('ck.value >= $2'));
  assert.ok(text.includes('ck.detail = $4'));
  assert.ok(text.includes('ck.detail::text ILIKE $6'));
  assert.deepEqual(values, ['powerful', 2, 'combo', 'Kick', 'combo', '%k\\_%', 50, 0]);
});

test('keyword filter: requirement matches any alternative in a slash list', () => {
  const { text, values } = buildCardSearch({
    ...base,
    keywords: [{ name: 'breaker', requirement: 'Kyo' }],
  });
  assert.ok(
    text.includes("lower($2) = ANY(string_to_array(lower(ck.requirement::text), '/'))"),
    text,
  );
  assert.deepEqual(values, ['breaker', 'Kyo', 50, 0]);
});

test('stat filters use whitelisted columns and parameters', () => {
  const { text, values } = buildCardSearch({
    ...base,
    stats: [
      { stat: 'difficulty', op: 'lte', n: 3 },
      { stat: 'block_modifier', op: 'gte', n: 2 },
    ],
  });
  assert.ok(text.includes('c.difficulty <= $1'));
  assert.ok(text.includes('c.block_modifier >= $2'));
  assert.deepEqual(values, [3, 2, 50, 0]);
});

test('parseCardSearch: stat filters', () => {
  const p = parseCardSearch({ stat: ['difficulty:lte:3', 'control:4'] });
  assert.deepEqual(p.stats, [
    { stat: 'difficulty', op: 'lte', n: 3 },
    { stat: 'control', op: 'eq', n: 4 },
  ]);
  assert.throws(() => parseCardSearch({ stat: 'power:3' }), FilterError);
});

test('keyword_any: one OR group, separate from the AND filters', () => {
  const { text, values } = buildCardSearch({
    ...base,
    keywords: [{ name: 'throw' }],
    keywordsAny: [{ name: 'powerful', value: { op: 'gte', n: 2 } }, { name: 'slam' }],
  });
  assert.equal((text.match(/EXISTS \(SELECT 1 FROM card_keywords/g) ?? []).length, 3);
  assert.ok(text.includes(' OR EXISTS (SELECT 1 FROM card_keywords'));
  assert.deepEqual(values, ['throw', 'powerful', 2, 'slam', 50, 0]);
  // the OR group is wrapped in brackets so it cannot leak into the AND chain
  assert.ok(/AND\s+\(EXISTS/.test(text), text);
});

test('symbol filters: plain vs attuned, all vs any', () => {
  const { text, values } = buildCardSearch({
    ...base,
    symbols: [{ symbol: 'earth', attuned: false }],
    symbolsAny: [{ symbol: 'fire', attuned: true }, { symbol: 'water', attuned: false }],
  });
  assert.equal((text.match(/FROM card_symbols cs/g) ?? []).length, 3);
  assert.ok(text.includes('cs.symbol = $1 AND cs.attuned = $2'));
  assert.deepEqual(values, ['earth', false, 'fire', true, 'water', false, 50, 0]);
});

test('parseCardSearch: keyword_any and symbols', () => {
  const p = parseCardSearch({
    keyword_any: ['throw', 'powerful:gte:2'],
    symbol: 'earth',
    symbol_any: ['at_fire', 'water'],
  });
  assert.equal(p.keywordsAny.length, 2);
  assert.deepEqual(p.symbols, [{ symbol: 'earth', attuned: false }]);
  assert.deepEqual(p.symbolsAny, [
    { symbol: 'fire', attuned: true },
    { symbol: 'water', attuned: false },
  ]);
});

test('ability filters: all vs any', () => {
  const all = buildCardSearch({ ...base, abilities: ['blitz', 'response'] });
  assert.ok(all.text.includes('c.ability_types @> $1::text[]'));
  const any = buildCardSearch({ ...base, abilities: ['blitz', 'response'], abilityMatch: 'any' });
  assert.ok(any.text.includes('c.ability_types && $1::text[]'));
  assert.deepEqual(any.values, [['blitz', 'response'], 50, 0]);
});

test('escapeLike', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('parseCardSearch: defaults and full example', () => {
  const d = parseCardSearch({});
  assert.deepEqual(d, {
    name: undefined, text: undefined, types: [], sets: [], format: undefined, keywords: [], keywordsAny: [],
    keywordsNot: [], stats: [], symbols: [], symbolsAny: [], symbolsNot: [], abilities: [],
    abilityMatch: 'all', page: 1, pageSize: 50, blockZones: [], attackZones: [],
  });

  const p = parseCardSearch({
    name: ' tomura ',
    text: ' draw ',
    type: ['Attack', 'foundation'],
    set: 'SF62X',
    format: 'Standard',
    keyword: ['powerful:gte:2', 'throw'],
    ability: 'Blitz,Response',
    ability_match: 'any',
    page: '2',
    page_size: '25',
  });
  assert.equal(p.name, 'tomura');
  assert.equal(p.text, 'draw');
  assert.deepEqual(p.types, ['attack', 'foundation']);
  assert.deepEqual(p.sets, ['sf62x']);
  assert.equal(p.keywords.length, 2);
  assert.deepEqual(p.abilities, ['blitz', 'response']);
  assert.equal(p.abilityMatch, 'any');
  assert.equal(p.page, 2);
  assert.equal(p.pageSize, 25);
});

test('parseCardSearch: bad input is a FilterError', () => {
  for (const bad of [
    { keyword: 'powerful:zzz' },
    { ability: 'nope' },
    { ability_match: 'both' },
    { page: '0' },
    { page: 'abc' },
    { page_size: '9999' },
    { name: 'x'.repeat(201) },
    { text: 'x'.repeat(201) },
    { keyword: Array.from({ length: 21 }, () => 'throw') },
    { keyword_any: Array.from({ length: 51 }, () => 'throw') },
    { symbol: 'ea rth' },
  ]) {
    assert.throws(() => parseCardSearch(bad), FilterError, JSON.stringify(bad).slice(0, 60));
  }
});

test('zone filters', () => {
  const { text, values } = buildCardSearch({ ...base, blockZones: ['high', 'mid'], attackZones: ['low'] });
  assert.ok(text.includes('c.block_zone = ANY($1::text[])'));
  assert.ok(text.includes('c.attack_zone = ANY($2::text[])'));
  assert.deepEqual(values, [['high', 'mid'], ['low'], 50, 0]);
});

test('not_keyword: NOT EXISTS, always ANDed', () => {
  const { text, values } = buildCardSearch({
    ...base,
    keywords: [{ name: 'quest' }],
    keywordsNot: [{ name: 'spell' }],
  });
  assert.ok(text.includes('NOT EXISTS (SELECT 1 FROM card_keywords'));
  assert.deepEqual(values, ['quest', 'spell', 50, 0]);
});

test('not_symbol: NOT EXISTS, always ANDed', () => {
  const { text, values } = buildCardSearch({
    ...base,
    symbols: [{ symbol: 'earth', attuned: false }],
    symbolsNot: [{ symbol: 'fire', attuned: true }],
  });
  assert.equal((text.match(/NOT EXISTS \(SELECT 1\s+FROM card_symbols cs/g) ?? []).length, 1);
  assert.deepEqual(values, ['earth', false, 'fire', true, 50, 0]);
});

test('name suggestions: every word must appear, parameters only', () => {
  const { text, values } = buildNameSuggest(' tomura shig ', 8);
  assert.ok(text.includes('c.name ILIKE $1 AND c.name ILIKE $2'));
  assert.ok(text.includes('DISTINCT ON (lower(c.name))'));
  assert.deepEqual(values, ['%tomura%', '%shig%', 'tomura shig%', '%tomura shig%', 8]);
  assert.ok(!text.includes('tomura'));
});
