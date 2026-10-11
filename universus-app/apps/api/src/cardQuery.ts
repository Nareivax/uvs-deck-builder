import type { KeywordFilter, NumberOp } from '@universus/shared';

export interface CardSearchParams {
  q?: string;
  types: string[];
  sets: string[];
  format?: string;
  keywords: KeywordFilter[];
  abilities: string[];
  abilityMatch: 'all' | 'any';
  page: number;
  pageSize: number;
}

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

/** Columns returned for a card in lists and in the detail view (aliased to camelCase). */
export const CARD_COLUMNS = `
  c.id, c.name, c.card_type AS "cardType", c.rarity, c.rules_text AS "rulesText",
  c.ability_types AS "abilityTypes", c.number, s.code AS "setCode", s.name AS "setName",
  c.difficulty, c.control, c.block_modifier AS "blockModifier", c.block_zone AS "blockZone",
  c.attack_zone AS "attackZone", c.attack_speed AS "attackSpeed", c.attack_damage AS "attackDamage",
  c.hand_size AS "handSize", c.vitality, c.image_mini_url AS "imageMiniUrl"`;

// Operators come from this fixed table, never from user text.
const SQL_OPS: Record<NumberOp, string> = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Builds the card search query. Every user-supplied value goes into `values` and is
 * referenced as $1, $2, ... so nothing user-typed is ever pasted into the SQL text.
 * Keyword filters read card_keywords only; ability filters read cards.ability_types.
 */
export function buildCardSearch(p: CardSearchParams): BuiltQuery {
  const values: unknown[] = [];
  const add = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  const where: string[] = [];

  if (p.q) {
    const ts = add(p.q);
    const like = add(`%${escapeLike(p.q)}%`);
    where.push(`(c.search @@ websearch_to_tsquery('english', ${ts}) OR c.name ILIKE ${like})`);
  }
  if (p.types.length > 0) {
    where.push(`c.card_type = ANY(${add(p.types)}::text[])`);
  }
  if (p.sets.length > 0) {
    where.push(`lower(s.code) = ANY(${add(p.sets)}::text[])`);
  }
  if (p.format) {
    where.push(
      `EXISTS (SELECT 1 FROM card_formats cf JOIN formats f ON f.id = cf.format_id
               WHERE cf.card_id = c.id AND lower(f.name) = lower(${add(p.format)}))`,
    );
  }
  for (const kf of p.keywords) {
    const parts = ['ck.card_id = c.id', `k.name = ${add(kf.name)}`];
    if (kf.value) parts.push(`ck.value ${SQL_OPS[kf.value.op]} ${add(kf.value.n)}`);
    if (kf.detail) {
      parts.push(
        kf.detail.op === 'eq'
          ? `ck.detail = ${add(kf.detail.text)}`
          : `ck.detail::text ILIKE ${add(`%${escapeLike(kf.detail.text)}%`)}`,
      );
    }
    if (kf.requirement) {
      // "Benimaru/Goro/Kyo" is a list of alternatives: a filter for any one of them matches.
      parts.push(
        `lower(${add(kf.requirement)}) = ANY(string_to_array(lower(ck.requirement::text), '/'))`,
      );
    }
    where.push(
      `EXISTS (SELECT 1 FROM card_keywords ck JOIN keywords k ON k.id = ck.keyword_id
               WHERE ${parts.join(' AND ')})`,
    );
  }
  if (p.abilities.length > 0) {
    const op = p.abilityMatch === 'any' ? '&&' : '@>';
    where.push(`c.ability_types ${op} ${add(p.abilities)}::text[]`);
  }

  const limit = add(p.pageSize);
  const offset = add((p.page - 1) * p.pageSize);

  const text = `SELECT ${CARD_COLUMNS},
       count(*) OVER() AS total
FROM cards c
JOIN sets s ON s.id = c.set_id
${where.length > 0 ? `WHERE ${where.join('\n  AND ')}` : ''}
ORDER BY c.name, s.release_date DESC NULLS LAST, c.id
LIMIT ${limit} OFFSET ${offset}`;

  return { text, values };
}
