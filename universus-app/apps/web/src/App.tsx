import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CardSearchResponse, MetaResponse } from '@universus/shared';
import { api } from './api.ts';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [q, setQ] = useState('');
  const [cardType, setCardType] = useState('');
  const [format, setFormat] = useState('');
  const [keywordText, setKeywordText] = useState('');
  const [abilities, setAbilities] = useState<string[]>([]);
  const [abilityMatch, setAbilityMatch] = useState<'all' | 'any'>('all');
  const [result, setResult] = useState<CardSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(page: number) {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (cardType) params.set('type', cardType);
    if (format) params.set('format', format);
    for (const line of keywordText.split('\n')) {
      if (line.trim()) params.append('keyword', line.trim());
    }
    for (const a of abilities) params.append('ability', a);
    if (abilities.length > 1) params.set('ability_match', abilityMatch);
    params.set('page', String(page));
    params.set('page_size', '30');

    setLoading(true);
    setError(null);
    try {
      setResult(await api.searchCards(params));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.meta().then(setMeta).catch((e: unknown) => setError(messageOf(e)));
    void search(1);
    // run once on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void search(1);
  }

  function toggleAbility(type: string) {
    setAbilities((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <main className="page">
      <h1>Universus Cards</h1>

      <form className="filters" onSubmit={onSubmit}>
        <label>
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or rules text" />
        </label>

        <label>
          Card type
          <select value={cardType} onChange={(e) => setCardType(e.target.value)}>
            <option value="">Any</option>
            {meta?.cardTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Any</option>
            {meta?.formats.map((f) => (
              <option key={f.id} value={f.name}>{f.name}</option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Ability types</legend>
          {meta?.abilityTypes.map((t) => (
            <label key={t} className="inline">
              <input type="checkbox" checked={abilities.includes(t)} onChange={() => toggleAbility(t)} />
              {t}
            </label>
          ))}
          <label className="inline">
            <select value={abilityMatch} onChange={(e) => setAbilityMatch(e.target.value as 'all' | 'any')}>
              <option value="all">match all</option>
              <option value="any">match any</option>
            </select>
          </label>
        </fieldset>

        <label className="wide">
          Keywords (one per line)
          <textarea
            rows={3}
            value={keywordText}
            onChange={(e) => setKeywordText(e.target.value)}
            placeholder={'powerful:gte:2\ncombo:detail:kick\nchar. trait:detail:brawler'}
          />
        </label>

        <button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <p className="count">{result.total} cards</p>
          <ul className="results">
            {result.items.map((card) => (
              <li key={card.id} className="card">
                {card.imageMiniUrl && <img src={card.imageMiniUrl} alt="" loading="lazy" />}
                <div>
                  <h2>{card.name}</h2>
                  <p className="meta">
                    {card.cardType} · {card.setCode} #{card.number}
                    {card.rarity ? ` · ${card.rarity}` : ''}
                    {card.abilityTypes.length > 0 ? ` · ${card.abilityTypes.join(', ')}` : ''}
                  </p>
                  {card.rulesText && <p className="rules">{card.rulesText}</p>}
                </div>
              </li>
            ))}
          </ul>
          <nav className="pager">
            <button disabled={loading || result.page <= 1} onClick={() => void search(result.page - 1)}>
              Previous
            </button>
            <span>Page {result.page} of {totalPages}</span>
            <button disabled={loading || result.page >= totalPages} onClick={() => void search(result.page + 1)}>
              Next
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
