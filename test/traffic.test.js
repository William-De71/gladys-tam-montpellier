import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  plainText,
  titleOf,
  linkOf,
  readableHeader,
  alertState,
  messageOf,
  parseTraffic,
  messageAt,
  lineTraffic,
  seriousMessages,
} from '../src/traffic.js';
import { decodeFeed } from '../src/gtfs-rt.js';
import { ALERTS, NOW, rawAlert } from './helpers/fixtures.js';

const HOUR = 3600;
const now = NOW / 1000;

test('texts: plain, a title, a link', () => {
  assert.equal(plainText(' Ligne 6 <br/>déviée\r\n\n  ce soir '), 'Ligne 6\ndéviée\nce soir');
  assert.equal(
    titleOf('', 'Rugby : La ligne 17 est déviée. Les arrêts…'),
    'Rugby : La ligne 17 est déviée.',
  );
  assert.equal(linkOf('https://www.tam-voyages.com/a b'), 'https://www.tam-voyages.com/a%20b');
  assert.equal(linkOf('http://insecure.fr'), '');
  // The TaM often writes an internal code as the header.
  assert.equal(readableHeader('    TR/L17/Dev/ TRL17Dev- 17DEV  2 SENSRUGBY'), false);
  assert.equal(readableHeader('Travaux place de la Comédie'), true);
});

test('the weight of an alert: its effect, its severity, else its words', () => {
  const state = (fields, text = '') => alertState(rawAlert(fields), text);
  assert.equal(state({ effect: 1 }), 'major');
  assert.equal(state({ effect: 4 }), 'disrupted');
  assert.equal(state({ effect: 6 }), 'info');
  assert.equal(state({ severity: 4 }), 'major');
  assert.equal(state({}, 'Le tramway est interrompu entre Corum et Odysseum.'), 'major');
  assert.equal(state({}, 'La ligne 17 est déviée.'), 'disrupted');
  assert.equal(state({}, 'Arrêts non desservis dans les 2 sens.'), 'disrupted');
  assert.equal(state({}, 'Travaux de nuit, quai provisoire.'), 'info');
});

test('the real alert of the TaM: a title out of its text, coming on the 31st', () => {
  const traffic = parseTraffic(decodeFeed(ALERTS));
  assert.deepEqual(traffic.messages, [
    {
      id: '1053187',
      lineIds: ['17'],
      state: 'disrupted',
      title: 'Rugby : La ligne 17 est déviée.',
      text: 'Rugby : La ligne 17 est déviée. Les arrêts de G.Danton à Irissou non desservis dans les 2 sens.',
      url: '',
      periods: [{ start: 1793453400000, end: 1793473200000 }],
      hours: '',
    },
  ]);
  // On the 27th it is more than three days away: neither under way nor coming.
  assert.deepEqual(lineTraffic(traffic, '17', NOW), {
    state: 'normal',
    since: null,
    messages: [],
    upcoming: [],
  });
  const saturday = lineTraffic(traffic, '17', Date.parse('2026-10-31T15:00:00Z'));
  assert.equal(saturday.state, 'disrupted');
  assert.equal(saturday.since, 1793453400000);
});

test('a platform alert concerns the lines calling there', () => {
  const message = messageOf(rawAlert({ routeIds: [], stopIds: ['41133'] }), (stopId) =>
    stopId === '41133' ? ['1', '2', '3'] : [],
  );
  assert.deepEqual(message.lineIds, ['1', '2', '3']);
  // No line at all: dropped.
  assert.deepEqual(parseTraffic({ alerts: [rawAlert({ routeIds: [] })] }).messages, []);
});

test('periods: under way, coming, over; the state of a line', () => {
  const base = messageOf(rawAlert());
  assert.equal(messageAt(base, NOW).coming, false);
  assert.equal(messageAt({ ...base, periods: [] }, NOW).start, null);
  assert.equal(
    messageAt(
      { ...base, periods: [{ start: (now - 5 * HOUR) * 1000, end: (now - HOUR) * 1000 }] },
      NOW,
    ),
    null,
  );
  const traffic = parseTraffic({
    alerts: [
      rawAlert({ id: 'detour' }),
      rawAlert({ id: 'cut', effect: 1, periods: [{ start: now - 600, end: null }] }),
      rawAlert({
        id: 'soon',
        header: 'Concert',
        description: 'Desserte renforcée.',
        periods: [{ start: now + 24 * HOUR, end: now + 28 * HOUR }],
      }),
      rawAlert({ id: 'later', periods: [{ start: now + 5 * 24 * HOUR, end: null }] }),
    ],
  });
  const line = lineTraffic(traffic, '17', NOW);
  assert.equal(line.state, 'major');
  assert.equal(line.since, NOW - 600000);
  assert.deepEqual(
    line.messages.map((m) => m.id),
    ['cut', 'detour'],
  );
  assert.deepEqual(
    line.upcoming.map((m) => m.id),
    ['soon'],
  );
  assert.equal(seriousMessages(line).length, 2);
  assert.equal(lineTraffic(traffic, '1', NOW).state, 'normal');
  assert.equal(lineTraffic(null, '1', NOW).state, 'unknown');
  const info = parseTraffic({ alerts: [rawAlert({ effect: 6 })] });
  assert.deepEqual(
    [lineTraffic(info, '17', NOW).state, lineTraffic(info, '17', NOW).since],
    ['info', null],
  );
});
