import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CardSearchResponse, MetaResponse } from '@universus/shared';
import { api } from './api.ts';
import { EMPTY_FILTERS, OPS, buildSearchParams } from './searchParams.ts';
import type { Filters, KeywordChoice, OpName } from './searchParams.ts';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

function titleCase(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export default function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS); // what the controls show
  const [submitted, setSubmitted] = useState<Filters>(EMPTY_FILTERS); // what the results are for
  const [result, setResult] = useState<CardSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(f: Filters, page: number) {
    setSubmitted(f);
    setLoading(true);
    setError(null);
    try {
      setResult(await api.searchCards(buildSearchParams(f, page)));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.meta().then(setMeta).catch((e: unknown) => setError(messageOf(e)));
    void search(EMPTY_FILTERS, 1);
    // run once on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function cycleKeyword(name: string) {
    setFilters((f) => {
      const keywords = { ...f.keywords };
      let keywordsNot = f.keywordsNot;
      if (keywords[name]) {                 // include -> exclude
        delete keywords[name];
        keywordsNot = [...keywordsNot, name];
      } else if (keywordsNot.includes(name)) { // exclude -> nothing
        keywordsNot = keywordsNot.filter((n) => n !== name);
      } else {                              // nothing -> include
        keywords[name] = { op: 'eq', value: '' };
      }
      return { ...f, keywords, keywordsNot };
    });
  }

  function cycleSymbol(token: string) {
    setFilters((f) => {
      if (f.symbols.includes(token)) {            // include -> exclude
        return { ...f, symbols: f.symbols.filter((s) => s !== token), symbolsNot: [...f.symbolsNot, token] };
      }
      if (f.symbolsNot.includes(token)) {         // exclude -> nothing
        return { ...f, symbolsNot: f.symbolsNot.filter((s) => s !== token) };
      }
      return { ...f, symbols: [...f.symbols, token] }; // nothing -> include
    });
  }

  function editKeyword(name: string, patch: Partial<KeywordChoice>) {
    setFilters((f) => ({
      ...f,
      keywords: { ...f.keywords, [name]: { ...f.keywords[name], ...patch } as KeywordChoice },
    }));
  }

  function toggled(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function toggleAbility(type: string) {
    setFilters((f) => ({ ...f, abilities: toggled(f.abilities, type) }));
  }

  function toggleCardType(type: string) {
    setFilters((f) => ({ ...f, cardTypes: toggled(f.cardTypes, type) }));
  }

  function toggleBlockZone(zone: string) {
    setFilters((f) => ({ ...f, blockZones: toggled(f.blockZones, zone) }));
  }

  function toggleAttackZone(zone: string) {
    setFilters((f) => ({ ...f, attackZones: toggled(f.attackZones, zone) }));
  }

  function setStat(key: string, which: 'min' | 'max', value: string) {
    setFilters((f) => {
      const current = f.stats[key] ?? { min: '', max: '' };
      const next = which === 'min' ? { ...current, min: value } : { ...current, max: value };
      return { ...f, stats: { ...f.stats, [key]: next } };
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void search(filters, 1);
  }

  function reset() {
    setFilters(EMPTY_FILTERS);
    void search(EMPTY_FILTERS, 1);
  }

  function symbolButton(token: string, label: string) {
    const state = filters.symbols.includes(token)
      ? 'include'
      : filters.symbolsNot.includes(token)
        ? 'exclude'
        : 'off';
    return (
      <div key={token} className="check-item">
        <button
          type="button"
          className="tri"
          data-state={state}
          aria-label={`${label}: ${state === 'off' ? 'not filtered' : state === 'include' ? 'must have' : 'must not have'}`}
          onClick={() => cycleSymbol(token)}
        >
          <span className="tri-box" aria-hidden="true">
            {state === 'include' ? '✓' : state === 'exclude' ? '✕' : ''}
          </span>
          {label}
        </button>
      </div>
    );
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <main className="page">
      <h1>Universus Cards</h1>

      <form className="filters" onSubmit={onSubmit}>
        <label>
          Card name
          <input
            value={filters.name}
            onChange={(e) => change('name', e.target.value)}
            placeholder="part of the name"
          />
        </label>

        <label>
          Rules text
          <input
            value={filters.text}
            onChange={(e) => change('text', e.target.value)}
            placeholder="words in the rules text"
          />
        </label>

        <label>
          Format
          <select value={filters.format} onChange={(e) => change('format', e.target.value)}>
            <option value="">Any</option>
            {meta?.formats.map((f) => (
              <option key={f.id} value={f.name}>{f.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="choices">
          <legend>Card type</legend>
          <div className="check-grid">
            {meta?.cardTypes.map((t) => (
              <div key={t} className="check-item">
                <label>
                  <input
                    type="checkbox"
                    checked={filters.cardTypes.includes(t)}
                    onChange={() => toggleCardType(t)}
                  />
                  {titleCase(t)}
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Keywords</legend>
          <p className="hint">Tap once to include, twice to exclude.</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.keywordsAll}
              onChange={(e) => change('keywordsAll', e.target.checked)}
            />
            Match all included keywords
          </label>
          <div className="check-grid">
            {meta?.keywords.map((k) => {
              const choice = filters.keywords[k.name];
              const excluded = filters.keywordsNot.includes(k.name);
              const state = choice ? 'include' : excluded ? 'exclude' : 'off';
              return (
                <div key={k.id} className="check-item">
                  <button
                    type="button"
                    className="tri"
                    data-state={state}
                    aria-label={`${k.name}: ${state === 'off' ? 'not filtered' : state === 'include' ? 'must have' : 'must not have'}`}
                    onClick={() => cycleKeyword(k.name)}
                  >
                    <span className="tri-box" aria-hidden="true">
                      {state === 'include' ? '✓' : state === 'exclude' ? '✕' : ''}
                    </span>
                    {k.name}
                  </button>
                  {choice && k.hasValue && (
                    <span className="value-box">
                      <select
                        aria-label={`${k.name} comparison`}
                        value={choice.op}
                        onChange={(e) => editKeyword(k.name, { op: e.target.value as OpName })}
                      >
                        {OPS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={`${k.name} value`}
                        placeholder="any"
                        value={choice.value}
                        onChange={(e) => editKeyword(k.name, { value: e.target.value })}
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Resource symbols</legend>
          <p className="hint">Tap once to include, twice to exclude.</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.symbolsAll}
              onChange={(e) => change('symbolsAll', e.target.checked)}
            />
            Match all included symbols
          </label>
          <h3>Symbols</h3>
          <div className="check-grid">
            {meta?.symbols.map((code) => symbolButton(code, titleCase(code)))}
          </div>
          <h3>Attuned symbols</h3>
          <div className="check-grid">
            {meta?.symbols.map((code) => symbolButton(`at_${code}`, titleCase(code)))}
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Ability types</legend>
          <div className="check-grid">
            {meta?.abilityTypes.map((t) => (
              <div key={t} className="check-item">
                <label>
                  <input type="checkbox" checked={filters.abilities.includes(t)} onChange={() => toggleAbility(t)} />
                  {titleCase(t)}
                </label>
              </div>
            ))}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={filters.abilityMatch === 'all'}
              onChange={(e) => change('abilityMatch', e.target.checked ? 'all' : 'any')}
            />
            Match all selected ability types
          </label>
        </fieldset>

        <fieldset className="choices">
          <legend>Zones</legend>
          <h3>Block zone</h3>
          <div className="check-grid">
            {meta?.zones.map((z) => (
              <div key={z} className="check-item">
                <label>
                  <input type="checkbox" checked={filters.blockZones.includes(z)} onChange={() => toggleBlockZone(z)} />
                  {titleCase(z)}
                </label>
              </div>
            ))}
          </div>
          <h3>Attack zone</h3>
          <div className="check-grid">
            {meta?.zones.map((z) => (
              <div key={z} className="check-item">
                <label>
                  <input type="checkbox" checked={filters.attackZones.includes(z)} onChange={() => toggleAttackZone(z)} />
                  {titleCase(z)}
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="stats">
          <legend>Stats (leave blank for any)</legend>
          {meta?.stats.map((st) => (
            <div key={st.key} className="stat-row">
              <span>{st.label}</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${st.label} minimum`}
                placeholder={st.min === null ? 'min' : `min ${st.min}`}
                value={filters.stats[st.key]?.min ?? ''}
                onChange={(e) => setStat(st.key, 'min', e.target.value)}
              />
              <span>to</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${st.label} maximum`}
                placeholder={st.max === null ? 'max' : `max ${st.max}`}
                value={filters.stats[st.key]?.max ?? ''}
                onChange={(e) => setStat(st.key, 'max', e.target.value)}
              />
            </div>
          ))}
        </fieldset>

        <details className="wide advanced">
          <summary>Advanced keyword filters (typed)</summary>
          <label>
            One per line, for example combo:detail:kick, char. trait:detail:brawler or only:requirement:kyo
            <textarea
              rows={3}
              value={filters.keywordText}
              onChange={(e) => change('keywordText', e.target.value)}
            />
          </label>
        </details>

        <div className="button-row">
          <button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
          <button type="button" className="secondary" onClick={reset} disabled={loading}>Reset</button>
        </div>
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
            <button disabled={loading || result.page <= 1} onClick={() => void search(submitted, result.page - 1)}>
              Previous
            </button>
            <span>Page {result.page} of {totalPages}</span>
            <button disabled={loading || result.page >= totalPages} onClick={() => void search(submitted, result.page + 1)}>
              Next
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
