// Types shared by the API, the web app and (later) the mobile app.
// They describe what the API sends, not the raw database rows.

export type DeckZone = 'character' | 'main' | 'sideboard';

export interface CardListItem {
  id: number;
  name: string;
  cardType: string;
  rarity: string | null;
  rulesText: string | null;
  abilityTypes: string[];
  number: string;
  setCode: string;
  setName: string;
  difficulty: number | null;
  control: number | null;
  blockModifier: number | null;
  blockZone: string | null;
  attackZone: string | null;
  attackSpeed: number | null;
  attackDamage: number | null;
  handSize: number | null;
  vitality: number | null;
  imageMiniUrl: string | null;
}

export interface CardKeywordInfo {
  name: string;
  value: number | null;
  detail: string | null;
}

export interface CardSymbolInfo {
  symbol: string;
  attuned: boolean;
}

export interface CardDetail extends CardListItem {
  releaseDate: string | null;
  block: string | null;
  sourceUrl: string | null;
  keywords: CardKeywordInfo[];
  symbols: CardSymbolInfo[];
  formats: string[];
}

export interface CardSearchResponse {
  items: CardListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KeywordInfo {
  id: number;
  name: string;
  hasValue: boolean;
}

export interface MetaResponse {
  keywords: KeywordInfo[];
  formats: { id: number; name: string }[];
  sets: { id: number; code: string; name: string; releaseDate: string | null }[];
  abilityTypes: string[];
  cardTypes: string[];
}
