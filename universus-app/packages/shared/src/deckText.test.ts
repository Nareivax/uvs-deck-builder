import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDeckText, normalizeName, parseDeckText } from './deckText.ts';
import type { DeckTextRow } from './deckText.ts';

// A real copy/paste export, including its irregular indentation and empty sections
const SAMPLE = `    [b][url=https://uvsultra.online/deck.php?deck=lFxMrTiXswkqSMmBpdbsNlJURSNLbT]MuraMuraMura[/url][/b]
    [b]Character[/b]
    1 Tomura Shigaraki, All For One's Successor

    [b]Foundation[/b]
    4 Ambush Tackle
4 Need for Destruction
4 Numbers Advantage
4 Gloating
4 Spiteful Intentions
4 Marley's Warriors
4 Dark Ward
4 Former Head Financial Manager
4 Forbidden Exorcism
4 Treasure Hunting

    [b]Attack[/b]
    4 Exilio
4 Golden Destruction
4 Massive Optimal Punch
4 Adaptive Stabbing
4 Combination Blast
4 Nesh

    [b]Asset[/b]
    2 Evil Aura
2 Military Airship

    [b]Action[/b]
    2 Wipe Out All Humans
    
    [b]Backup[/b]
        

    [b]Arena[/b]
        

    [b]Side[/b]
`;

test('parses the sample deck', () => {
  const d = parseDeckText(SAMPLE);
  assert.equal(d.name, 'MuraMuraMura');
  assert.equal(d.url, 'https://uvsultra.online/deck.php?deck=lFxMrTiXswkqSMmBpdbsNlJURSNLbT');
  assert.deepEqual(d.warnings, []);

  const bySection = new Map<string, typeof d.entries>();
  for (const e of d.entries) bySection.set(e.section, [...(bySection.get(e.section) ?? []), e]);
  assert.deepEqual([...bySection.keys()], ['Character', 'Foundation', 'Attack', 'Asset', 'Action']);
  assert.deepEqual(
    bySection.get('Character')!.map((e) => [e.quantity, e.name, e.zone]),
    [[1, "Tomura Shigaraki, All For One's Successor", 'character']],
  );
  assert.equal(bySection.get('Foundation')!.length, 10);
  assert.ok(bySection.get('Foundation')!.every((e) => e.quantity === 4 && e.zone === 'main'));
  assert.equal(bySection.get('Attack')!.length, 6);
  assert.deepEqual(bySection.get('Asset')!.map((e) => [e.quantity, e.name]), [
    [2, 'Evil Aura'],
    [2, 'Military Airship'],
  ]);
});

test('round trip', () => {
  const d = parseDeckText(SAMPLE);
  const rows: DeckTextRow[] = d.entries.map((e) => ({
    zone: e.zone,
    cardType: e.section.toLowerCase(),
    name: e.name,
    quantity: e.quantity,
  }));
  const text = formatDeckText(d.name!, rows, d.url);
  assert.ok(text.startsWith('[b][url=https://uvsultra.online/deck.php?deck=lFxMrTiXswkqSMmBpdbsNlJURSNLbT]MuraMuraMura[/url][/b]\n[b]Character[/b]\n1 Tomura'));
  for (const title of ['Character', 'Foundation', 'Attack', 'Asset', 'Action', 'Backup', 'Arena', 'Side']) {
    assert.ok(text.includes(`[b]${title}[/b]`), `missing section ${title}`);
  }
  const again = parseDeckText(text);
  const key = (e: { zone: string; section: string; name: string; quantity: number }) =>
    `${e.zone}|${e.section}|${e.name}|${e.quantity}`;
  assert.deepEqual(again.entries.map(key).sort(), d.entries.map(key).sort());
  assert.equal(again.name, d.name);
  assert.equal(again.url, d.url);
  assert.deepEqual(again.warnings, []);
});

test('sideboard, merged printings, unknown types, plain header', () => {
  const rows: DeckTextRow[] = [
    { zone: 'character', cardType: 'character', name: 'Hero', quantity: 1 },
    { zone: 'main', cardType: 'attack', name: 'Punch', quantity: 2 },
    { zone: 'main', cardType: 'attack', name: 'Punch', quantity: 2 }, // second printing
    { zone: 'main', cardType: 'monster', name: 'Odd Card', quantity: 1 },
    { zone: 'sideboard', cardType: 'attack', name: 'Kick', quantity: 3 },
  ];
  const out = formatDeckText('Test', rows);
  assert.equal(out.split('\n')[0], '[b]Test[/b]');
  assert.ok(out.includes('[b]Attack[/b]\n4 Punch\n'));
  assert.ok(out.indexOf('[b]Monster[/b]') > out.indexOf('[b]Arena[/b]'));
  assert.ok(out.indexOf('[b]Monster[/b]') < out.indexOf('[b]Side[/b]'));
  assert.ok(out.trimEnd().endsWith('[b]Side[/b]\n3 Kick'));

  const back = parseDeckText(out);
  assert.equal(back.name, 'Test');
  assert.equal(back.url, null);
  assert.deepEqual(
    back.entries.map((e) => `${e.zone}|${e.name}|${e.quantity}`).sort(),
    ['character|Hero|1', 'main|Odd Card|1', 'main|Punch|4', 'sideboard|Kick|3'],
  );
  assert.ok(back.warnings.some((w) => w.includes('Unknown section')));
});

test('quantity styles, merging and warnings', () => {
  const d = parseDeckText('[b]Foundation[/b]\n3x Card A\n2 card a\n0 Zero\nrandom text\n');
  assert.deepEqual(d.entries.map((e) => [e.quantity, e.name]), [[5, 'Card A']]);
  assert.equal(d.warnings.length, 2);
  assert.ok(parseDeckText('1 Card\n').warnings.length > 0); // card line before any section
});

test('name matching tolerates curly apostrophes and spacing', () => {
  assert.equal(normalizeName('Marley\u2019s  Warriors'), normalizeName("marley's warriors"));
});
