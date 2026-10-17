import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ABILITY_TYPES, FilterError, STATS } from '@universus/shared';
import type {
  CardDetail,
  CardListItem,
  CardSearchResponse,
  KeywordInfo,
  MetaResponse,
} from '@universus/shared';
import { CARD_COLUMNS, STAT_COLUMNS, buildCardSearch } from './cardQuery.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { parseCardSearch } from './parseQuery.ts';
import type { RawQuery } from './parseQuery.ts';

function statusOf(err: unknown): number {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' && code >= 400 && code < 600 ? code : 500;
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: config.corsOrigins });
  app.addHook('onClose', async () => {
    await pool.end();
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof FilterError) {
      return reply.status(400).send({ error: err.message });
    }
    const status = statusOf(err);
    if (status >= 500) {
      req.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
    return reply.status(status).send({ error: err instanceof Error ? err.message : 'Bad request' });
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  // Everything the filter UI needs in one call
  app.get('/meta', async (): Promise<MetaResponse> => {
    const [keywords, formats, sets, types, ranges, symbols] = await Promise.all([
      pool.query(`SELECT id, name::text AS name, has_value AS "hasValue" FROM keywords ORDER BY name`),
      pool.query(`SELECT id, name FROM formats ORDER BY name`),
      pool.query(
        `SELECT id, code, name, to_char(release_date, 'YYYY-MM-DD') AS "releaseDate"
         FROM sets ORDER BY release_date DESC NULLS LAST, name`,
      ),
      pool.query(`SELECT DISTINCT card_type FROM cards ORDER BY card_type`),
      // lowest and highest value of every filterable stat, in one query
      pool.query(
        `SELECT ${STATS.map(
          (st) => `min(${STAT_COLUMNS[st.key]}) AS "${st.key}_min", max(${STAT_COLUMNS[st.key]}) AS "${st.key}_max"`,
        ).join(', ')} FROM cards`,
      ),
      pool.query(`SELECT code FROM symbols ORDER BY code`),
    ]);
    return {
      keywords: keywords.rows as KeywordInfo[],
      formats: formats.rows,
      sets: sets.rows,
      abilityTypes: [...ABILITY_TYPES],
      cardTypes: types.rows.map((r: { card_type: string }) => r.card_type),
      symbols: symbols.rows.map((r: { code: string }) => r.code),
      stats: STATS.map((st) => ({
        key: st.key,
        label: st.label,
        min: ranges.rows[0]?.[`${st.key}_min`] ?? null,
        max: ranges.rows[0]?.[`${st.key}_max`] ?? null,
      })),
    };
  });

  app.get<{ Querystring: RawQuery }>('/cards', async (req): Promise<CardSearchResponse> => {
    const params = parseCardSearch(req.query);
    const { text, values } = buildCardSearch(params);
    const { rows } = await pool.query(text, values);
    const total = rows.length > 0 ? Number(rows[0].total) : 0;
    const items = rows.map(({ total: _total, ...card }) => card as CardListItem);
    return { items, total, page: params.page, pageSize: params.pageSize };
  });

  app.get<{ Params: { id: string } }>('/cards/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new FilterError('Card id must be a positive integer');

    const [card, keywords, symbols, formats] = await Promise.all([
      pool.query(
        `SELECT ${CARD_COLUMNS},
                to_char(s.release_date, 'YYYY-MM-DD') AS "releaseDate",
                s.block, c.source_url AS "sourceUrl"
         FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.id = $1`,
        [id],
      ),
      pool.query(
        `SELECT k.name::text AS name, ck.value, ck.detail::text AS detail,
                ck.requirement::text AS requirement
         FROM card_keywords ck JOIN keywords k ON k.id = ck.keyword_id
         WHERE ck.card_id = $1 ORDER BY ck.id`,
        [id],
      ),
      pool.query(
        `SELECT symbol, attuned, quantity FROM card_symbols WHERE card_id = $1 ORDER BY symbol, attuned`,
        [id],
      ),
      pool.query(
        `SELECT f.name FROM card_formats cf JOIN formats f ON f.id = cf.format_id
         WHERE cf.card_id = $1 ORDER BY f.name`,
        [id],
      ),
    ]);
    if (card.rows.length === 0) return reply.status(404).send({ error: 'Card not found' });

    const detail: CardDetail = {
      ...card.rows[0],
      keywords: keywords.rows,
      symbols: symbols.rows,
      formats: formats.rows.map((r: { name: string }) => r.name),
    };
    return detail;
  });

  return app;
}
