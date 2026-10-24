import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, buildSearchParams } from './searchParams.ts';
import type { Filters } from './searchParams.ts';

const withFilters = (patch: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...patch });

test('empty form: paging only', () => {
  const p = buildSearchParams(EMPTY_FILTERS, 1);
  assert.equal(p.toString(), 'page=1&page_size=30');
});

test('ticked keywords: any by default, all when asked; values only when typed', () => {
  const keywords = {
    Throw: { op: 'eq' as const, value: '' },
    Powerful: { op: 'gte' as const, value: ' 2 ' },
  };
  const any = buildSearchParams(withFilters({ keywords }), 1);
  assert.deepEqual(any.getAll('keyword_any'), ['Throw', 'Powerful:gte:2']);
  assert.deepEqual(any.getAll('keyword'), []);

  const all = buildSearchParams(withFilters({ keywords, keywordsAll: true }), 1);
  assert.deepEqual(all.getAll('keyword'), ['Throw', 'Powerful:gte:2']);
  assert.deepEqual(all.getAll('keyword_any'), []);
});

test('hand-typed keyword lines are always AND', () => {
  const p = buildSearchParams(
    withFilters({
      keywords: { Slam: { op: 'eq', value: '' } },
      keywordText: 'combo:detail:kick\n\n  only:requirement:kyo  ',
    }),
    1,
  );
  assert.deepEqual(p.getAll('keyword'), ['combo:detail:kick', 'only:requirement:kyo']);
  assert.deepEqual(p.getAll('keyword_any'), ['Slam']);
});

test('symbols: plain and attuned, any by default', () => {
  const any = buildSearchParams(withFilters({ symbols: ['earth', 'at_fire'] }), 1);
  assert.deepEqual(any.getAll('symbol_any'), ['earth', 'at_fire']);
  const all = buildSearchParams(withFilters({ symbols: ['earth', 'at_fire'], symbolsAll: true }), 1);
  assert.deepEqual(all.getAll('symbol'), ['earth', 'at_fire']);
  assert.deepEqual(all.getAll('symbol_any'), []);
});

test('abilities, stats and the basic fields', () => {
  const p = buildSearchParams(
    withFilters({
      q: ' tomura ',
      cardTypes: ['attack', 'foundation'],
      format: 'Standard',
      abilities: ['blitz', 'response'],
      abilityMatch: 'any',
      stats: { difficulty: { min: '2', max: '' }, control: { min: '', max: '4' }, vitality: { min: '', max: '' } },
    }),
    3,
    20,
  );
  assert.equal(p.get('q'), 'tomura');
  assert.deepEqual(p.getAll('type'), ['attack', 'foundation']);
  assert.equal(p.get('format'), 'Standard');
  assert.deepEqual(p.getAll('ability'), ['blitz', 'response']);
  assert.equal(p.get('ability_match'), 'any');
  assert.deepEqual(p.getAll('stat'), ['difficulty:gte:2', 'control:lte:4']);
  assert.equal(p.get('page'), '3');
  assert.equal(p.get('page_size'), '20');
});

test('Zones', () => {
  const any = buildSearchParams(withFilters({ blockZones: ['high', 'mid'] }), 1);
  assert.deepEqual(any.getAll('block_zone'), ['high', 'mid']);
  const all = buildSearchParams(withFilters({ attackZones: ['low'] }), 1);
  assert.deepEqual(all.getAll('attack_zone'), ['low']);
});

test('Keywords Not', () => {
  const any = buildSearchParams(withFilters({ keywordsNot: ['Spell'] }), 1);
  assert.deepEqual(any.getAll('not_keyword'), ['Spell']);
});
