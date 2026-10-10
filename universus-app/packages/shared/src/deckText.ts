import type { DeckZone } from './types.ts';

/**
 * Parse and write the copy/paste deck format (BBCode-style):
 *
 *   [b][url=https://example/deck?deck=abc]My Deck[/url][/b]
 *   [b]Character[/b]
 *   1 Some Character
 *
 *   [b]Foundation[/b]
 *   4 Some Foundation
 *   ...
 *   [b]Side[/b]
 *
 * Section -> zone: Character -> 'character', Side -> 'sideboard', everything else -> 'main'.
 * The section name is kept on every entry so callers can warn when it disagrees with the
 * card's real card type. Resolving names to card ids is the caller's job.
 */
export const SECTION_ORDER = [
  'Character',
  'Foundation',
  'Attack',
  'Asset',
  'Action',
  'Backup',
  'Arena',
  'Side',
] as const;

export interface DeckTextEntry {
  zone: DeckZone;
  section: string;
  quantity: number;
  name: string;
}

export interface ParsedDeckText {
  name: string | null;
  url: string | null;
  entries: DeckTextEntry[];
  warnings: string[];
}

export interface DeckTextRow {
  zone: DeckZone;
  cardType: string;
  name: string;
  quantity: number;
}

const HEADER_URL_RE = /^\[b\]\[url=([^\]]*)\](.*?)\[\/url\]\[\/b\]$/i;
const SECTION_RE = /^\[b\]([^[\]]+)\[\/b\]$/i;
const CARD_RE = /^(\d+)(?:\s*x)?\s+(.+)$/;

/** For matching names between sources: case, spacing and curly quotes don't matter. */
export function normalizeName(name: string): string {
  return name
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function zoneForSection(section: string): DeckZone {
  const s = section.trim().toLowerCase();
  if (s === 'character') return 'character';
  if (s === 'side') return 'sideboard';
  return 'main';
}

export function parseDeckText(text: string): ParsedDeckText {
  let name: string | null = null;
  let url: string | null = null;
  let section: string | null = null;
  const entries = new Map<string, DeckTextEntry>();
  const warnings: string[] = [];
  const known = new Set<string>(SECTION_ORDER.map((s) => s.toLowerCase()));

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    let m = HEADER_URL_RE.exec(line);
    if (m && name === null && section === null) {
      url = m[1].trim();
      name = m[2].trim();
      continue;
    }

    m = SECTION_RE.exec(line);
    if (m) {
      const title = m[1].trim();
      const isKnown = known.has(title.toLowerCase());
      if (name === null && section === null && !isKnown) {
        name = title; // a plain [b]Deck name[/b] first line
        continue;
      }
      if (!isKnown) {
        warnings.push(`Unknown section "${title}"; its cards are treated as main deck`);
      }
      section = title;
      continue;
    }

    m = CARD_RE.exec(line);
    if (m) {
      const quantity = Number(m[1]);
      if (section === null) {
        warnings.push(`Card line before any section heading: "${line}"`);
        continue;
      }
      if (quantity < 1) {
        warnings.push(`Ignored zero quantity: "${line}"`);
        continue;
      }
      const cardName = m[2].trim();
      const key = `${section.toLowerCase()}|${normalizeName(cardName)}`;
      const existing = entries.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        entries.set(key, { zone: zoneForSection(section), section, quantity, name: cardName });
      }
      continue;
    }

    warnings.push(`Could not read line: "${line}"`);
  }

  return { name, url, entries: [...entries.values()], warnings };
}

function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Write a deck as copy/paste text. Same-named cards (e.g. two printings) are merged.
 * Main-deck cards are grouped by card type; empty sections are still printed, matching the
 * site's layout. Order within a section is alphabetical (deck order is not stored).
 */
export function formatDeckText(deckName: string, rows: DeckTextRow[], url?: string | null): string {
  const sections = new Map<string, Map<string, { shown: string; qty: number }>>();
  for (const title of SECTION_ORDER) sections.set(title, new Map());
  const extra: string[] = [];

  for (const row of rows) {
    let title: string;
    if (row.zone === 'character') title = 'Character';
    else if (row.zone === 'sideboard') title = 'Side';
    else title = titleCase(row.cardType) || 'Other';

    let bucket = sections.get(title);
    if (!bucket) {
      bucket = new Map();
      sections.set(title, bucket);
      extra.push(title);
    }
    const key = normalizeName(row.name);
    const current = bucket.get(key);
    if (current) current.qty += row.quantity;
    else bucket.set(key, { shown: row.name, qty: row.quantity });
  }

  // card types we don't know about go after Arena, before Side
  const ordered = [...SECTION_ORDER.filter((t) => t !== 'Side'), ...[...extra].sort(), 'Side'];

  const lines = [url ? `[b][url=${url}]${deckName}[/url][/b]` : `[b]${deckName}[/b]`];
  for (const title of ordered) {
    lines.push(`[b]${title}[/b]`);
    const items = [...(sections.get(title)?.values() ?? [])].sort((a, b) => {
      const x = a.shown.toLowerCase();
      const y = b.shown.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const item of items) lines.push(`${item.qty} ${item.shown}`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
