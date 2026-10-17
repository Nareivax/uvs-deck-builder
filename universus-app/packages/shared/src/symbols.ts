import { FilterError } from './errors.ts';

/**
 * Resource symbol filters, one per `symbol` / `symbol_any` query parameter:
 *   earth       the plain Earth symbol
 *   at_earth    the attuned Earth symbol
 * Plain and attuned are different symbols, matching how the cards are scraped.
 */
export interface SymbolFilter {
  symbol: string;
  attuned: boolean;
}

export function parseSymbolFilter(input: string): SymbolFilter {
  const text = input.trim().toLowerCase();
  const attuned = text.startsWith('at_');
  const symbol = attuned ? text.slice(3) : text;
  if (!/^[a-z0-9_]{1,30}$/.test(symbol)) {
    throw new FilterError(`Bad symbol "${input}" (use for example earth or at_earth)`);
  }
  return { symbol, attuned };
}
