import { useEffect, useId, useRef, useState } from 'react';
import type { CardSuggestion } from '@universus/shared';
import { api } from './api.ts';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called when a suggestion is chosen; the parent should run the search. */
  onPick: (name: string) => void;
}

/** Text box with a drop-down of card names containing what has been typed. */
export default function NameSearch({ value, onChange, onPick }: Props) {
  const [items, setItems] = useState<CardSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const skipNext = useRef(false); // set after picking, so the new value doesn't reopen the list
  const listId = useId();

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await api.suggest(q);
        if (cancelled) return;
        setItems(found);
        setActive(-1);
        setOpen(found.length > 0);
      } catch {
        if (!cancelled) {
          setItems([]);
          setOpen(false);
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    if (active >= 0) {
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, listId]);

  function pick(item: CardSuggestion) {
    skipNext.current = true;
    setOpen(false);
    setItems([]);
    setActive(-1);
    onPick(item.name);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || items.length === 0) {
      if (e.key === 'ArrowDown' && items.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); // pick the highlighted name instead of submitting the form
      pick(items[active]);
    }
  }

  return (
    <div className="suggest">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(items.length > 0)}
        onBlur={() => setOpen(false)}
        placeholder="part of the name"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {open && (
        <ul id={listId} className="suggest-list" role="listbox">
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              // mousedown (not click) so it fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {item.imageMiniUrl ? (
                <img src={item.imageMiniUrl} alt="" loading="lazy" />
              ) : (
                <span className="no-img" />
              )}
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
