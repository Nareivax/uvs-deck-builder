import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardSearch, escapeLike } from './cardQuery.ts';
import type { CardSearchParams } from './cardQuery.ts';
import { parseCardSearch } from './parseQuery.ts';
import { FilterError } from '@universus/shared';

const base: CardSearchParams = {
  types: [],
  sets: [],
  keywords: [],
  abilities: [],
  abilityMatch: 'all',
  page: 1,
  pageSize: 50,
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

test('text, type, set and format filters use parameters', () => {
  const { text, values } = buildCardSearch({
    ...base, q: 'draw 50%', types: ['attack'], sets: ['sf62x'], format: 'Standard',
  });
  assert.ok(text.includes("websearch_to_tsquery('english', $1)"));
  assert.ok(text.includes('c.name ILIKE $2'));
  assert.ok(text.includes('c.card_type = ANY($3::text[])'));
  assert.ok(text.includes('lower(s.code) = ANY($4::text[])'));
  assert.ok(text.includes('lower($5)'));
  assert.deepEqual(values, ['draw 50%', '%draw 50\\%%', ['attack'], ['sf62x'], 'Standard', 50, 0]);
  // user text never appears in the SQL itself
  assert.ok(!text.includes('Standard') && !text.includes('draw 50'));
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
    q: undefined, types: [], sets: [], format: undefined, keywords: [], abilities: [],
    abilityMatch: 'all', page: 1, pageSize: 50,
  });

  const p = parseCardSearch({
    q: ' tomura ',
    type: ['Attack', 'foundation'],
    set: 'SF62X',
    format: 'Standard',
    keyword: ['powerful:gte:2', 'throw'],
    ability: 'Blitz,Response',
    ability_match: 'any',
    page: '2',
    page_size: '25',
  });
  assert.equal(p.q, 'tomura');
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
    { q: 'x'.repeat(201) },
    { keyword: Array.from({ length: 11 }, () => 'throw') },
  ]) {
    assert.throws(() => parseCardSearch(bad), FilterError, JSON.stringify(bad).slice(0, 60));
  }
});
