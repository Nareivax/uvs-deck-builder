/**
 * The search form's state, and how it becomes URL parameters for GET /cards.
 * No React in here, so it can be tested on its own.
 */
export type OpName = 'eq' | 'gte' | 'lte' | 'gt' | 'lt';

/** Operators offered next to a keyword's value box. */
export const OPS: { value: OpName; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'gte', label: '≥' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
];

export interface KeywordChoice {
  op: OpName;
  value: string;
}

export interface Filters {
  q: string;
  cardType: string;
  format: string;
  /** Ticked keywords by name, with the value typed next to keywords that take one. */
  keywords: Record<string, KeywordChoice>;
  /** true: a card needs every ticked keyword. false: any one of them is enough. */
  keywordsAll: boolean;
  /** Extra keyword filters typed by hand, one per line (detail, requirement, ...). Always AND. */
  keywordText: string;
  /** Ticked symbols: "earth" is the plain symbol, "at_earth" the attuned one. */
  symbols: string[];
  symbolsAll: boolean;
  abilities: string[];
  abilityMatch: 'all' | 'any';
  /** Minimum and maximum typed for each stat, by stat key. */
  stats: Record<string, { min: string; max: string }>;
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  cardType: '',
  format: '',
  keywords: {},
  keywordsAll: false,
  keywordText: '',
  symbols: [],
  symbolsAll: false,
  abilities: [],
  abilityMatch: 'all',
  stats: {},
};

export function buildSearchParams(f: Filters, page: number, pageSize = 30): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.cardType) params.set('type', f.cardType);
  if (f.format) params.set('format', f.format);

  for (const [name, choice] of Object.entries(f.keywords)) {
    const value = choice.value.trim();
    const token = value === '' ? name : `${name}:${choice.op}:${value}`;
    params.append(f.keywordsAll ? 'keyword' : 'keyword_any', token);
  }
  for (const line of f.keywordText.split('\n')) {
    if (line.trim()) params.append('keyword', line.trim());
  }

  for (const symbol of f.symbols) {
    params.append(f.symbolsAll ? 'symbol' : 'symbol_any', symbol);
  }

  for (const type of f.abilities) params.append('ability', type);
  if (f.abilities.length > 1) params.set('ability_match', f.abilityMatch);

  for (const [key, range] of Object.entries(f.stats)) {
    if (range.min.trim() !== '') params.append('stat', `${key}:gte:${range.min.trim()}`);
    if (range.max.trim() !== '') params.append('stat', `${key}:lte:${range.max.trim()}`);
  }

  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}
