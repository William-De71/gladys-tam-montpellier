// The widget contents pass the validator of the SDK (what the core would
// drop or truncate), in every language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildDeparturesWidget,
  buildTrafficWidget,
  messageContent,
  readCount,
  routeValue,
  shortDate,
  dateText,
  BOARD_COUNT,
} from '../src/widgets.js';
import { parseTraffic, lineTraffic } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ, passage, rawAlert, fixturePassages } from './helpers/fixtures.js';

const GARE = await fixturePassages('Gare Saint-Roch');
const line = (id, name, mode = 'bus') => ({ id, name, mode });

/**
 * @description Assert that the core would keep the content whole.
 * @param {object} content - The content.
 * @param {string} label - For the message.
 */
function assertValid(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
}

test('departures widget: one compact row per route, soonest first, in every language', () => {
  for (const language of LANGUAGES) {
    const content = buildDeparturesWidget({
      title: 'Gare Saint-Roch',
      passages: GARE,
      readAt: NOW,
      count: 6,
      language,
      now: NOW,
      timeZone: TZ,
    });
    assertValid(content, language);
    const [heading, caption, status] = content.components;
    assert.equal(heading.text, 'Gare Saint-Roch');
    assert.match(caption.text, /^TaM · .*22:44/);
    assert.equal(status.items.length, 6);
  }
  const fr = buildDeparturesWidget({
    title: 'Gare Saint-Roch',
    passages: GARE,
    readAt: NOW,
    count: 4,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  assert.deepEqual(
    fr.components[2].items.map((item) => [item.label, item.value]),
    [
      ['1 → Occitanie', 'À l’approche · 15 · 30 · 45 min'],
      ['1 → Gare Sud France', '7 · 20 · 35 · 50 min'],
      ['2 → Jacou', '9 · 38 min · 23:53 · 00:23'],
      ['3 → Juvignac', '15 · 45 min · 00:00 · 00:30'],
    ],
  );
});

test('departures widget: a cancelled trip and a late one colour their row', () => {
  const passages = [
    passage({ time: '22:48', cancelled: true, trip: 'C1' }),
    passage({ time: '22:56', trip: 'C2' }),
    passage({ time: '22:46', line: '17', destination: 'Les Bouisses', delay: 6 }),
    passage({ time: '22:50', line: '2', destination: 'Jacou' }),
  ].sort((a, b) => a.at - b.at);
  const content = buildDeparturesWidget({
    title: 'Comédie',
    passages,
    readAt: NOW,
    count: 6,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'troubled');
  assert.deepEqual(
    content.components[2].items.map((item) => [item.label, item.value, item.color]),
    [
      ['2 → Jacou', '5 min', 'success'],
      ['17 → Les Bouisses', '7 min', 'warning'],
      ['1 → Mosson', 'supprimé 22:48 · 11 min', 'warning'],
    ],
  );
});

test('departures widget: times beyond an hour, nothing announced', () => {
  const options = { language: 'en', now: NOW, timeZone: TZ };
  const late = [passage({ time: '22:50' }), passage({ time: '24:10', realtime: false })];
  assert.equal(routeValue(late, options), '5 min · 00:10');
  const empty = buildDeparturesWidget({
    title: 'Château',
    passages: [],
    readAt: NOW,
    count: 6,
    language: 'de',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(empty, 'empty');
  assert.equal(empty.components[1].text, 'Keine Abfahrt angekündigt. TaM · aktualisiert um 22:44.');
  assert.equal(empty.ttl_seconds, 300);
});

test('departures widget: several stops in one list, a row per stop then its routes', () => {
  const content = buildDeparturesWidget({
    boards: [
      { title: 'Gare Saint-Roch', label: 'Gare Saint-Roch', passages: GARE, readAt: NOW },
      { title: 'Château', label: 'Château', passages: [], readAt: NOW - 60000 },
    ],
    count: 6,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'several');
  const [heading, caption, status] = content.components;
  assert.equal(heading.text, 'Gare Saint-Roch · Château');
  assert.equal(caption.text, 'TaM');
  assert.equal(status.items[0].icon, 'map-pin');
  assert.equal(status.items[0].value, 'lu à 22:44');
  assert.equal(status.items.at(-1).value, 'Aucun passage annoncé');
  assert.ok(status.items.length <= 10);
});

test('traffic widget: states, messages under way and coming, in every language', () => {
  const traffic = parseTraffic({
    alerts: [
      rawAlert(),
      rawAlert({
        id: 'info-1',
        routeIds: ['1'],
        header: 'Travaux de nuit',
        description: 'Arrêt Corum : quai provisoire après 22h.',
        url: 'https://www.tam-voyages.com/infos-trafic',
      }),
      rawAlert({
        id: 'rugby',
        routeIds: ['17'],
        header: 'TR/L17/Dev/ TRL17Dev- 17DEV  2 SENSRUGBY',
        description:
          'Rugby : La ligne 17 est déviée. Les arrêts de G.Danton à Irissou non desservis.',
        periods: [{ start: NOW / 1000 + 2 * 86400, end: NOW / 1000 + 2 * 86400 + 5 * 3600 }],
      }),
    ],
  });
  const lines = [
    line('1', '1', 'tram'),
    line('2', '2', 'tram'),
    line('17', '17'),
    line('6', '6'),
  ].map((entry) => ({ line: entry, traffic: lineTraffic(traffic, entry.id, NOW) }));
  for (const language of LANGUAGES) {
    const content = buildTrafficWidget({ lines, readAt: NOW, language, now: NOW, timeZone: TZ });
    assertValid(content, language);
  }
  const fr = buildTrafficWidget({ lines, readAt: NOW, language: 'fr', now: NOW, timeZone: TZ });
  const [heading, status, cards, caption] = fr.components;
  assert.equal(heading.text, 'Trafic TaM');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['Tram 1', 'Info trafic', 'info'],
      ['Tram 2', 'Trafic normal', 'success'],
      ['Ligne 17', 'Trafic perturbé', 'warning'],
      ['Ligne 6', 'Trafic normal', 'success'],
    ],
  );
  // Under way, the heaviest first, then the coming ones, with their period.
  assert.deepEqual(
    cards.items.map((item) => [item.title, item.badge.text, item.subtitle]),
    [
      ['Travaux : La ligne 17 est déviée.', 'Ligne 17', 'Perturbation · 21:44 → 28/10 01:44'],
      ['Travaux de nuit', 'Tram 1', 'Information · 21:44 → 28/10 01:44'],
      ['Rugby : La ligne 17 est déviée.', 'Ligne 17', 'À venir · 29/10 22:44 → 30/10 03:44'],
    ],
  );
  assert.match(cards.items[0].description, /non desservis/);
  assert.equal(cards.items[1].links[0].url, 'https://www.tam-voyages.com/infos-trafic');
  assert.equal(caption.text, 'TaM · mis à jour à 22:44');
  // Nothing to say.
  const calm = buildTrafficWidget({
    lines: [lines[3]],
    readAt: NOW,
    language: 'es',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(calm, 'calm');
  assert.equal(
    calm.components[2].text,
    'Ningún aviso de tráfico para estas líneas. TaM · actualizado a las 22:44.',
  );
});

test('messages and settings', () => {
  assertValid(messageContent('Hello'), 'message');
  assert.equal(readCount(undefined, BOARD_COUNT), BOARD_COUNT.default);
  assert.equal(readCount('99', BOARD_COUNT), BOARD_COUNT.max);
  assert.equal(readCount(0, BOARD_COUNT), BOARD_COUNT.min);
  assert.equal(shortDate(Date.parse('2026-12-31T22:59:00Z'), TZ), '31/12');
  assert.equal(shortDate(null, TZ), '');
  assert.equal(dateText(Date.parse('2026-10-27T15:48:00Z'), NOW, TZ), '16:48');
  assert.equal(dateText(Date.parse('2026-10-26T20:31:00Z'), NOW, TZ), '26/10 21:31');
  assert.equal(dateText(null, NOW, TZ), '');
});
