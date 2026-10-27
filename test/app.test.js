// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a
// fake TaM serving real (reduced) open data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, SCENE_ACTIONS, ACTIONS, IDLE_INTERVAL_MS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { formatTime } from '../src/time.js';
import { fakeTam, storePath, silent, encodeFeed, alert17, NOW, TZ } from './helpers/fixtures.js';

const CONFIG = {
  stop_1: 'Comédie',
  stop_1_line: 'tram 1',
  stop_1_direction: 'Gare Sud',
  stop_2: 'gare saint roch',
  stop_3: 'Nulle part',
  lines: '1, 17, 6, Z9',
  interval: '60',
  language: 'fr',
};
const PREFIX = 'ext:test-integration';
const COMEDIE_1 = `${PREFIX}:stop:comedie_1_gare-sud`;
const GARE = `${PREFIX}:stop:gare-saint-roch`;
const T1 = `${PREFIX}:line:1`;
const L17 = `${PREFIX}:line:17`;
const L6 = `${PREFIX}:line:6`;
const MINUTE = 60 * 1000;
const TRIP_UPDATES = 'trip_updates';

/**
 * @description The integration, connected to a fake Gladys and a fake TaM.
 * @param {object} [options] - `{ config, path, logger }`.
 * @returns {Promise<object>} `{ gladys, app, api, clock, path }`.
 */
async function startApp({ config = CONFIG, path = storePath(), logger = silent } = {}) {
  const clock = { now: NOW };
  const api = fakeTam();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: api,
    storePath: path,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  return { gladys, app, api, clock, path };
}

const created = async (gladys, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, `${externalId} is offered`);
  await gladys.fake.deviceCreated(device);
  return device;
};
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const realtimeReads = (app) => app.api.requests.byEndpoint[TRIP_UPDATES] ?? 0;
const tripOf = (passage) => passage.trip.split('@')[0];

test('two stops and three lines become five devices; unknown names are reported', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.external_id, device.name]),
    [
      [COMEDIE_1, 'TaM Comédie (1 → Gare Sud)'],
      [GARE, 'TaM Gare Saint-Roch'],
      [T1, 'TaM tram 1'],
      [L17, 'TaM ligne 17'],
      [L6, 'TaM ligne 6'],
    ],
  );
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.equal(
    status.message.fr,
    'Connecté à la TaM : 2 arrêt(s), 3 ligne(s), temps réel lu toutes les 60 s. Inconnu ou ambigu : Nulle part, Z9.',
  );
  // The timetable once, the real time of both stops in one request, the alerts.
  assert.deepEqual(
    api.calls.map((call) => call.path),
    ['/GTFS.zip', '/TripUpdate.pb', '/Alert.pb'],
  );
  // The first readings are a baseline: nothing fires.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('created devices get their states, sent again after the creation', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, COMEDIE_1);
  await created(gladys, GARE);
  await created(gladys, L17);
  const [next] = app.getSnapshot('comedie_1_gare-sud').passages;
  assert.equal(next.destination, 'Gare Sud France');
  assert.equal(gladys.fake.lastState(`${COMEDIE_1}:wait`), Math.floor((next.at - NOW) / MINUTE));
  assert.match(gladys.fake.lastState(`${COMEDIE_1}:next`), /^1 → Gare Sud France · \d+ min/);
  assert.equal(gladys.fake.lastState(`${GARE}:next`), '1 → Occitanie · À l’approche');
  assert.equal(gladys.fake.lastState(`${GARE}:following`), 7);
  assert.equal(gladys.fake.lastState(`${L17}:status`), 'Trafic normal');
  assert.equal(gladys.fake.lastState(`${L17}:messages`), 0);
  // The tram gets four minutes late; the line not created gets nothing.
  api.state.tripUpdates = encodeFeed({
    timestamp: (NOW + MINUTE) / 1000,
    tripUpdates: [
      {
        tripId: tripOf(next),
        routeId: '1',
        stops: [{ stopId: next.platform, time: (next.scheduled + 4 * MINUTE) / 1000, delay: 240 }],
      },
    ],
  });
  clock.now += MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.lastState(`${COMEDIE_1}:delay`), 4);
  assert.match(gladys.fake.lastState(`${COMEDIE_1}:next`), /\(\+4 min de retard\)$/);
  assert.equal(gladys.fake.lastState(`${T1}:status`), undefined);
});

test('departure soon: fired close to its mark, once, between two readings too', async (t) => {
  const { gladys, app, api, clock } = await startApp({
    config: {
      stop_1: 'Gare Saint-Roch',
      stop_1_line: '2',
      stop_1_direction: 'Jacou',
      language: 'en',
    },
  });
  t.after(() => gladys.fake.shutdown());
  const passage = app
    .getSnapshot('gare-saint-roch_2_jacou')
    .passages.find((entry) => entry.scheduled > NOW + 20 * MINUTE);
  clock.now += MINUTE;
  const at = clock.now + 12 * MINUTE;
  api.state.tripUpdates = encodeFeed({
    timestamp: clock.now / 1000,
    tripUpdates: [
      {
        tripId: tripOf(passage),
        routeId: '2',
        stops: [
          { stopId: passage.platform, time: at / 1000, delay: (at - passage.scheduled) / 1000 },
        ],
      },
    ],
  });
  await app.readStops({ force: true });
  const ours = () =>
    eventsOf(gladys, TRIGGERS.DEPARTURE_SOON).filter(
      (event) => event.data.time === formatTime(at, TZ),
    );
  assert.deepEqual(ours(), []);
  // Seven minutes later, without a reading: the 5-minute mark (between readings).
  clock.now += 7 * MINUTE + 10000;
  await app.checkReminders();
  assert.deepEqual(
    ours().map((event) => [event.data.minutes, event.data.line, event.data.destination]),
    [['5', '2', 'Jacou']],
  );
  assert.equal(ours()[0].data.stop, `${PREFIX}:stop:gare-saint-roch_2_jacou`);
  assert.match(
    ours()[0].data.summary,
    new RegExp(`^2 towards Jacou leaves Gare Saint-Roch in 5 min \\(${formatTime(at, TZ)}`),
  );
  await app.checkReminders();
  await app.readStops({ force: true });
  assert.equal(ours().length, 1);
});

test('departure cancelled: fired once per trip of the next hour', async (t) => {
  const { gladys, app, api } = await startApp({
    config: { stop_1: 'Gare Saint-Roch', language: 'fr' },
  });
  t.after(() => gladys.fake.shutdown());
  const passage = app
    .getSnapshot('gare-saint-roch')
    .passages.find((entry) => entry.lineId === '2' && entry.scheduled > NOW + 10 * MINUTE);
  api.state.tripUpdates = encodeFeed({
    tripUpdates: [{ tripId: tripOf(passage), routeId: '2', cancelled: true }],
  });
  await app.readStops({ force: true });
  await app.readStops({ force: true });
  const time = formatTime(passage.scheduled, TZ);
  const cancelled = eventsOf(gladys, TRIGGERS.DEPARTURE_CANCELLED);
  assert.deepEqual(
    cancelled.map((event) => [event.data.line, event.data.time, event.data.stop]),
    [['2', time, GARE]],
  );
  assert.equal(
    cancelled[0].data.summary,
    `Le 2 de ${time} vers ${passage.destination} à Gare Saint-Roch est supprimé.`,
  );
  // Shown in the widget, left out of the waits.
  const widget = await gladys.fake.widgetGet(WIDGETS.DEPARTURES, { settings: {}, language: 'fr' });
  assert.ok(
    widget.data.content.components[2].items.some((item) => item.value.includes(`supprimé ${time}`)),
  );
});

test('a disruption, then back to normal: fired once each, never again after a restart', async (t) => {
  const path = storePath();
  const config = { stop_1: 'Gare Saint-Roch', lines: '17', language: 'fr' };
  const { gladys, app, api, clock } = await startApp({ config, path });
  t.after(() => gladys.fake.shutdown());
  // Line 17 diverted.
  api.state.alerts = encodeFeed({ alerts: [alert17()] });
  await app.trafficTick();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.line_name, event.data.kind]),
    [
      [TRIGGERS.LINE_DISRUPTED, 'Ligne 17', undefined],
      [TRIGGERS.TRAFFIC_MESSAGE, 'Ligne 17', 'disrupted'],
    ],
  );
  const [disrupted] = gladys.fake.sceneEvents;
  assert.equal(disrupted.data.line, L17);
  assert.deepEqual(
    [disrupted.data.state, disrupted.data.title, disrupted.data.start],
    ['disrupted', 'Travaux : La ligne 17 est déviée.', '27/10 21:44'],
  );
  assert.equal(
    disrupted.data.summary,
    'Ligne 17 : Trafic perturbé (Travaux : La ligne 17 est déviée.)',
  );
  // The same reading again: nothing new.
  await app.trafficTick();
  assert.equal(gladys.fake.sceneEvents.length, 2);
  // A restart on the same /data: nothing replayed, nothing downloaded again.
  const second = createFakeGladys({ config });
  t.after(() => second.fake.shutdown());
  const calls = api.calls.length;
  const restarted = createApp(second, {
    fetch: api,
    storePath: path,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    logger: silent,
  });
  await second.connect();
  await restarted.whenReady();
  assert.deepEqual(second.fake.sceneEvents, []);
  assert.ok(!api.calls.slice(calls).some((call) => call.path === '/GTFS.zip'));
  // The detour over; a mere information still runs.
  clock.now += 30 * MINUTE;
  api.state.alerts = encodeFeed({ alerts: [alert17({ effect: 6 })] });
  await restarted.trafficTick();
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.state]),
    [[TRIGGERS.LINE_RESTORED, 'info']],
  );
});

test('one request for every stop; quiet stops every 10 minutes', async (t) => {
  const { gladys, app, clock } = await startApp({
    config: {
      stop_1: 'Gare Saint-Roch',
      stop_2: 'Gare Saint-Roch',
      stop_2_line: '1',
      interval: '30',
      added_stops: [
        { stop: 'comedie', line: '', direction: '' },
        { stop: 'rondelet', line: '17', direction: '' },
      ],
    },
  });
  t.after(() => gladys.fake.shutdown());
  assert.equal(app.getStops().length, 4);
  const before = realtimeReads(app);
  clock.now += 31 * 1000;
  await app.readStops();
  assert.equal(realtimeReads(app), before + 1, 'four devices, one request');
  // Château sleeps until the morning: read every 10 minutes.
  const night = await startApp({ config: { stop_1: 'Château' } });
  t.after(() => night.gladys.fake.shutdown());
  const quiet = realtimeReads(night.app);
  night.clock.now += 2 * MINUTE;
  await night.app.readStops();
  assert.equal(realtimeReads(night.app), quiet);
  night.clock.now += IDLE_INTERVAL_MS;
  await night.app.readStops();
  assert.equal(realtimeReads(night.app), quiet + 1);
});

test('the open data down: a clear status; without real time, the timetable', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, GARE);
  api.state.fail = 503;
  await app.trafficTick();
  clock.now += 2 * MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /do not answer \(alerts: HTTP 503\)/);
  // The timetable kept in /data still gives the departures.
  assert.match(gladys.fake.lastState(`${GARE}:next`), /\(théorique\)$/);
  api.state.fail = null;
  await app.trafficTick();
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.doesNotMatch(gladys.fake.lastState(`${GARE}:next`), /théorique/);
  // The real time alone failing: still connected, the timetable meanwhile.
  api.state.failRealtime = 502;
  clock.now += 2 * MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.lastState(`${GARE}:next`), /\(théorique\)$/);
});

test('widgets: followed stops, a typed stop, lines; valid in every language', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const answers = [
      await gladys.fake.widgetGet(WIDGETS.DEPARTURES, { settings: {}, language }),
      await gladys.fake.widgetGet(WIDGETS.DEPARTURES, {
        settings: { stops: [COMEDIE_1, GARE] },
        language,
      }),
      await gladys.fake.widgetGet(WIDGETS.DEPARTURES, {
        settings: { stop_name: 'Corum', line: '2' },
        language,
      }),
      await gladys.fake.widgetGet(WIDGETS.TRAFFIC, { settings: {}, language }),
      await gladys.fake.widgetGet(WIDGETS.TRAFFIC, { settings: { lines: '17' }, language }),
    ];
    for (const answer of answers) {
      assert.equal(answer.success, true);
      assert.deepEqual(validateWidgetContent(answer.data.content), [], language);
    }
  }
  const typed = await gladys.fake.widgetGet(WIDGETS.DEPARTURES, {
    settings: { stop_name: 'Corum', line: '2' },
    language: 'fr',
  });
  const [heading, , status] = typed.data.content.components;
  assert.equal(heading.text, 'Corum (2)');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['2 → St-Jean de Vedas', '2 → Jacou', '2 → Sabines', '2 → Nd de Sablassou'],
  );
  const unknown = await gladys.fake.widgetGet(WIDGETS.TRAFFIC, {
    settings: { lines: 'Z9' },
    language: 'en',
  });
  assert.equal(unknown.data.content.components[0].text, 'Unknown or ambiguous: Z9.');
});

test('the traffic widget shows the trams when no line is followed', async (t) => {
  const { gladys } = await startApp({ config: { stop_1: 'Gare Saint-Roch' } });
  t.after(() => gladys.fake.shutdown());
  const traffic = await gladys.fake.widgetGet(WIDGETS.TRAFFIC, { settings: {}, language: 'fr' });
  assert.deepEqual(
    traffic.data.content.components[1].items.map((item) => [item.label, item.value]),
    [
      ['Tram 1', 'Trafic normal'],
      ['Tram 2', 'Trafic normal'],
      ['Tram 3', 'Trafic normal'],
      ['Tram 4', 'Trafic normal'],
      ['Tram 5', 'Trafic normal'],
    ],
  );
});

test('scene actions: next departures of a stop, traffic of a line', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const next = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_NEXT_DEPARTURES, { stop: GARE });
  assert.equal(next.success, true);
  const { outputs } = next.data;
  assert.deepEqual(
    [outputs.found, outputs.line, outputs.destination, outputs.minutes, outputs.realtime],
    [true, '1', 'Occitanie', 0, true],
  );
  assert.equal(outputs.following_minutes, 7);
  assert.equal(
    outputs.summary,
    'Prochain passage à Gare Saint-Roch : 1 vers Occitanie à l’approche. Le suivant dans 7 min.',
  );
  api.state.alerts = encodeFeed({ alerts: [alert17()] });
  const traffic = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_LINE_TRAFFIC, { line: L17 });
  // A reading of less than 90 s is reused: the alert is not seen yet.
  assert.equal(traffic.data.outputs.state, 'normal');
  const first = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_LINE_TRAFFIC, {});
  assert.deepEqual(
    [first.data.outputs.line_name, first.data.outputs.summary],
    ['Tram 1', 'Tram 1 : Trafic normal.'],
  );
});

test('configuration actions: test, find a stop, diagnostic', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  api.state.alerts = encodeFeed({ alerts: [alert17()] });
  const tested = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(tested.success, true);
  const fr = tested.data.message.fr;
  assert.match(fr, /^Open data TaM joint : 45 lignes, 674 arrêts/);
  assert.match(fr, /Gare Saint-Roch : 38 passage\(s\), prochain 1 à l’approche/);
  assert.match(fr, /Tram 1 : Trafic normal · Ligne 17 : Trafic perturbé · Ligne 6 : Trafic normal/);
  assert.match(fr, /inconnu ou ambigu : Nulle part · inconnu ou ambigu : Z9/);
  // The timetable asked again, unchanged.
  assert.notEqual(api.calls.filter((call) => call.path === '/GTFS.zip').at(-1).since, '');
  const found = await gladys.fake.action(ACTIONS.SEARCH_STOP, { query: 'gare saint' });
  const text = found.data.message.fr;
  assert.match(text, /^Saisissez le nom/);
  assert.match(text, /\n• Gare Saint-Roch \[41135, 41221\] → 1, 2, 3\n/);
  assert.match(text, /\n• Gare Saint-Roch - Pont de Sète \[11, 21, 23, 24\] → 17\n/);
  const short = await gladys.fake.action(ACTIONS.SEARCH_STOP, { query: 'r' });
  assert.match(short.data.message.en, /at least two letters/);
  const none = await gladys.fake.action(ACTIONS.SEARCH_STOP, { query: 'zzz' });
  assert.equal(none.data.message.en, 'No stop matches "zzz".');
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.match(diagnostic.data.message.en, /TaM diagnostic/);
});

test('add, list and remove stops with the buttons, beyond the three of the form', async (t) => {
  const { gladys, app } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const added = await gladys.fake.action(ACTIONS.ADD_STOP, { stop: 'corum', line: 'tram 2' });
  assert.match(added.data.message.en, /^Stop added: Corum \(2\)\. 3 stop\(s\)/);
  assert.deepEqual(gladys.fake.config.added_stops, [{ stop: 'corum', line: '2', direction: '' }]);
  assert.ok(
    gladys.fake.discoveredDevices.some((device) => device.external_id === `${PREFIX}:stop:corum_2`),
  );
  const snapshot = app.getSnapshot('corum_2');
  assert.ok(snapshot.passages.length > 0);
  assert.ok(snapshot.passages.every((p) => p.lineId === '2'));
  const again = await gladys.fake.action(ACTIONS.ADD_STOP, { stop: 'Corum', line: '2' });
  assert.match(again.data.message.en, /already followed/);
  const unknown = await gladys.fake.action(ACTIONS.ADD_STOP, { stop: 'Nowhere' });
  assert.equal(unknown.data.message.en, 'Unknown or ambiguous: Nowhere.');
  const list = await gladys.fake.action(ACTIONS.LIST_STOPS);
  assert.equal(
    list.data.message.fr,
    '4 arrêt(s) suivi(s) :\n' +
      '1. Comédie (1 → Gare Sud) (formulaire, arrêt 1)\n' +
      '2. Gare Saint-Roch (formulaire, arrêt 2)\n' +
      '3. Nulle part (formulaire, arrêt 3, inconnu ou ambigu)\n' +
      '4. Corum (2)',
  );
  const inForm = await gladys.fake.action(ACTIONS.REMOVE_STOP, { stop: '2' });
  assert.match(inForm.data.message.en, /is stop 2 of the form/);
  const removed = await gladys.fake.action(ACTIONS.REMOVE_STOP, { stop: '4' });
  assert.match(removed.data.message.en, /^Stop removed: Corum \(2\)/);
  assert.deepEqual(gladys.fake.config.added_stops, []);
  assert.equal(app.getStops().length, 2);
});
