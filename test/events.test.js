// Scene triggers fire once per transition, with flat payloads within the
// limits of the core; scene actions return their declared outputs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detectReminders,
  detectCancellations,
  detectLineChanges,
  reminderData,
  cancelledData,
  lineEvent,
  nextDeparturesOutputs,
  lineTrafficOutputs,
  pick,
  tolerance,
  TRIGGERS,
  REMINDER_MINUTES,
  NEXT_DEPARTURES_OUTPUTS,
  LINE_TRAFFIC_OUTPUTS,
} from '../src/events.js';
import { parseTraffic, lineTraffic } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ, passage, rawAlert } from './helpers/fixtures.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const FOLLOWED = {
  name: 'Comédie (1 → Mosson)',
  deviceId: 'ext:tam-montpellier:stop:comedie_1_mosson',
  stop: { code: 'comedie', name: 'Comédie' },
};
const L17 = { id: '17', name: '17', mode: 'bus', deviceId: 'ext:tam-montpellier:line:17' };
const T1 = { id: '1', name: '1', mode: 'tram', deviceId: 'ext:tam-montpellier:line:1' };
const MINUTE = 60 * 1000;
const disrupted = (alerts = [rawAlert()]) => parseTraffic({ alerts });
const normal = parseTraffic({ alerts: [] });

/**
 * @description Assert that event data is flat and within the limits of the core.
 * @param {object} data - The data.
 * @param {string} key - The trigger key.
 */
function assertPayload(data, key) {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === key);
  assert.ok(trigger, key);
  assert.ok(Object.keys(data).length <= 30);
  for (const [name, value] of Object.entries(data)) {
    assert.ok(
      value === null || ['string', 'number', 'boolean'].includes(typeof value),
      `${key}.${name}`,
    );
    if (typeof value === 'string') {
      assert.ok(value.length <= 1000, `${key}.${name}`);
    }
  }
  // Every variable is in the data, and every field filters a key of it.
  for (const variable of trigger.variables) {
    assert.ok(variable.key in data, `${key}: variable ${variable.key}`);
  }
  for (const field of trigger.fields) {
    assert.ok(field.key in data, `${key}: field ${field.key}`);
  }
}

test('reminders: once per passage and mark, never on the first reading', () => {
  // 22:48:43 in Paris: 4 min 40 s after 22:44:03.
  const passages = [passage({ time: '22:48:43', trip: 'T1@20261027' })];
  // First reading of the stop: a baseline.
  const first = detectReminders({ passages, fired: undefined, now: NOW });
  assert.deepEqual(first.due, []);
  assert.equal(first.fired.length, 1);
  // 4 min 40 s before: the 5-minute mark, once.
  const memory = detectReminders({ passages, fired: [], now: NOW });
  assert.deepEqual(
    memory.due.map((entry) => entry.mark),
    [5],
  );
  const again = detectReminders({ passages, fired: memory.fired, now: NOW + 10000 });
  assert.deepEqual(again.due, []);
  // The same trip announced later (a delay) is the same passage: no new 5.
  const later = [passage({ time: '22:48:43', delay: 1, trip: 'T1@20261027' })];
  assert.deepEqual(detectReminders({ passages: later, fired: memory.fired, now: NOW }).due, []);
  // Old reminders are forgotten.
  const forgotten = detectReminders({ passages: [], fired: memory.fired, now: NOW + 20 * MINUTE });
  assert.deepEqual(forgotten.fired, []);
  assert.deepEqual(REMINDER_MINUTES.map(tolerance), [1, 1, 1.5, 3, 3, 3]);
});

test('cancellations: once per trip, within the hour, never on the first reading', () => {
  const passages = [
    passage({ time: '22:55', cancelled: true, trip: 'C1' }),
    passage({ time: '23:59', cancelled: true, trip: 'C2' }),
    passage({ time: '23:00', trip: 'C3' }),
  ];
  assert.deepEqual(detectCancellations({ passages, known: undefined, now: NOW }).due, []);
  const first = detectCancellations({ passages, known: [], now: NOW });
  assert.deepEqual(
    first.due.map((entry) => entry.trip),
    ['C1'],
  );
  assert.deepEqual(detectCancellations({ passages, known: first.known, now: NOW }).due, []);
  for (const language of LANGUAGES) {
    assertPayload(
      cancelledData(FOLLOWED, first.due[0], { language, timeZone: TZ }),
      TRIGGERS.DEPARTURE_CANCELLED,
    );
  }
  assert.equal(
    cancelledData(FOLLOWED, first.due[0], { language: 'fr', timeZone: TZ }).summary,
    'Le 1 de 22:55 vers Mosson à Comédie est supprimé.',
  );
});

test('departure soon: a flat payload, its summary in every language', () => {
  const late = passage({ time: '22:49', delay: 3 });
  for (const language of LANGUAGES) {
    const data = reminderData(FOLLOWED, late, 5, { language, timeZone: TZ });
    assertPayload(data, TRIGGERS.DEPARTURE_SOON);
    assert.equal(data.minutes, '5');
    assert.equal(data.time, '22:52');
    assert.equal(data.delay_minutes, 3);
  }
  assert.equal(
    reminderData(FOLLOWED, late, 5, { language: 'fr', timeZone: TZ }).summary,
    '1 vers Mosson passe à Comédie dans 5 min (22:52, 3 min de retard).',
  );
  assert.equal(
    reminderData(FOLLOWED, passage({ time: '22:49' }), 5, { language: 'en', timeZone: TZ }).summary,
    '1 towards Mosson leaves Comédie in 5 min (22:49).',
  );
});

test('line changes: disrupted, a new message, back to normal', () => {
  // First reading of the line: a baseline, even disrupted.
  const first = detectLineChanges({ lines: [L17, T1], traffic: disrupted(), seen: {}, now: NOW });
  assert.deepEqual(first.changes, []);
  assert.equal(first.seen['17'].state, 'disrupted');
  // From normal to disrupted: the disruption and its message.
  const before = detectLineChanges({ lines: [L17], traffic: normal, seen: {}, now: NOW - MINUTE });
  const now = detectLineChanges({
    lines: [L17],
    traffic: disrupted(),
    seen: before.seen,
    now: NOW,
  });
  assert.deepEqual(
    now.changes.map((change) => [change.key, change.message?.state]),
    [
      [TRIGGERS.LINE_DISRUPTED, 'disrupted'],
      [TRIGGERS.TRAFFIC_MESSAGE, 'disrupted'],
    ],
  );
  // The same reading again: nothing.
  const same = detectLineChanges({ lines: [L17], traffic: disrupted(), seen: now.seen, now: NOW });
  assert.deepEqual(same.changes, []);
  // A coming message is new too.
  const coming = detectLineChanges({
    lines: [L17],
    traffic: disrupted([
      rawAlert(),
      rawAlert({
        id: 'SOON',
        header: 'Concert au Zénith',
        description: 'Desserte renforcée en soirée.',
        periods: [{ start: NOW / 1000 + 2 * 86400, end: NOW / 1000 + 2 * 86400 + 4 * 3600 }],
      }),
    ]),
    seen: same.seen,
    now: NOW,
  });
  assert.deepEqual(
    coming.changes.map((change) => [change.key, change.message.id, change.message.state]),
    [[TRIGGERS.TRAFFIC_MESSAGE, 'SOON', 'info']],
  );
  // Back to normal.
  const over = detectLineChanges({ lines: [L17], traffic: normal, seen: coming.seen, now: NOW });
  assert.deepEqual(
    over.changes.map((change) => [change.key, change.traffic.state]),
    [[TRIGGERS.LINE_RESTORED, 'normal']],
  );
});

test('line events: flat payloads, summaries in every language', () => {
  const traffic = lineTraffic(disrupted(), '17', NOW);
  const [message] = traffic.messages;
  for (const language of LANGUAGES) {
    const event = lineEvent(
      { key: TRIGGERS.LINE_DISRUPTED, line: L17, traffic, message },
      { language, timeZone: TZ },
    );
    assertPayload(event.data, TRIGGERS.LINE_DISRUPTED);
    const fresh = lineEvent(
      { key: TRIGGERS.TRAFFIC_MESSAGE, line: L17, traffic, message },
      { language, timeZone: TZ },
    );
    assertPayload(fresh.data, TRIGGERS.TRAFFIC_MESSAGE);
    const restored = lineEvent(
      { key: TRIGGERS.LINE_RESTORED, line: T1, traffic: lineTraffic(normal, '1', NOW) },
      { language, timeZone: TZ },
    );
    assertPayload(restored.data, TRIGGERS.LINE_RESTORED);
  }
  const fresh = lineEvent(
    { key: TRIGGERS.TRAFFIC_MESSAGE, line: L17, traffic, message },
    { language: 'en', timeZone: TZ },
  );
  assert.deepEqual(
    [fresh.data.line, fresh.data.line_name, fresh.data.kind, fresh.data.start, fresh.data.end],
    ['ext:tam-montpellier:line:17', 'Line 17', 'disrupted', '27/10 21:44', '28/10 01:44'],
  );
  assert.equal(fresh.data.summary, 'Line 17, disruption: Travaux : La ligne 17 est déviée.');
  const event = lineEvent(
    { key: TRIGGERS.LINE_DISRUPTED, line: L17, traffic, message },
    { language: 'fr', timeZone: TZ },
  );
  assert.equal(
    event.data.summary,
    'Ligne 17 : Trafic perturbé (Travaux : La ligne 17 est déviée.)',
  );
});

test('scene action outputs: declared keys only, flat values', () => {
  const declared = (key) =>
    manifest.scene_actions.find((action) => action.key === key).outputs.map((output) => output.key);
  assert.deepEqual(NEXT_DEPARTURES_OUTPUTS, declared('get_next_departures'));
  assert.deepEqual(LINE_TRAFFIC_OUTPUTS, declared('get_line_traffic'));
  const passages = [
    passage({ time: '22:50', delay: 2 }),
    passage({ time: '23:05', realtime: false }),
  ];
  const next = pick(
    nextDeparturesOutputs({ followed: FOLLOWED, passages, now: NOW, language: 'en', timeZone: TZ }),
    NEXT_DEPARTURES_OUTPUTS,
  );
  assert.deepEqual(
    [
      next.found,
      next.line,
      next.minutes,
      next.time,
      next.realtime,
      next.delay_minutes,
      next.following_minutes,
    ],
    [true, '1', 7, '22:52', true, 2, 20],
  );
  assert.equal(
    next.summary,
    'Next passage at Comédie: 1 towards Mosson in 7 min. The following one in 20 min.',
  );
  const none = nextDeparturesOutputs({
    followed: FOLLOWED,
    passages: [],
    now: NOW,
    language: 'en',
    timeZone: TZ,
  });
  assert.deepEqual([none.found, none.minutes, none.time, none.realtime], [false, -1, '', false]);
  assert.equal(none.summary, 'No passage announced at Comédie.');
  const traffic = lineTrafficOutputs({
    line: L17,
    traffic: lineTraffic(disrupted(), '17', NOW),
    language: 'fr',
  });
  assert.deepEqual(
    [
      traffic.line_name,
      traffic.state,
      traffic.disrupted,
      traffic.message_count,
      traffic.state_label,
    ],
    ['Ligne 17', 'disrupted', true, 1, 'Trafic perturbé'],
  );
  for (const value of [...Object.values(next), ...Object.values(traffic)]) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
});
