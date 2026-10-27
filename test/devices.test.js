// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  stopKey,
  followedName,
  idsOf,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
  buildLineDevice,
  buildLineStates,
  lineStatusText,
  DEVICE_TYPES,
} from '../src/device.js';
import { parseTraffic, lineTraffic } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import { fakeGladys, NOW, TZ, passage, rawAlert } from './helpers/fixtures.js';

const COMEDIE_1 = {
  stop: { code: 'comedie', name: 'Comédie' },
  line: { id: '1', name: '1', mode: 'tram' },
  direction: 'Mosson',
};
COMEDIE_1.key = stopKey(COMEDIE_1.stop, COMEDIE_1.line, COMEDIE_1.direction);
COMEDIE_1.name = followedName(COMEDIE_1);
const GARE = {
  stop: { code: 'gare-saint-roch', name: 'Gare Saint-Roch' },
  line: null,
  direction: '',
};
GARE.key = stopKey(GARE.stop, null, '');
GARE.name = followedName(GARE);
const L6 = { id: '6', name: '6', mode: 'bus' };
const T1 = { id: '1', name: '1', mode: 'tram' };
const AMIGO = { id: 'Amigo', name: 'Amigo', mode: 'bus' };
const L17 = { id: '17', name: '17', mode: 'bus' };
const PASSAGES = [
  passage({ time: '22:58', delay: 1 }),
  passage({ time: '23:13', delay: 0 }),
  passage({ time: '22:50', line: '2', destination: 'Jacou' }),
];
const forStop = (list) => list.filter((entry) => entry.lineId === '1').sort((a, b) => a.at - b.at);
const traffic = parseTraffic({
  alerts: [
    rawAlert(),
    rawAlert({
      id: 'info-1',
      routeIds: ['1'],
      header: 'Travaux de nuit',
      description: 'Arrêt Corum : quai provisoire après 22h.',
    }),
  ],
});

const devices = (language) => [
  buildStopDevice(fakeGladys, COMEDIE_1, language),
  buildStopDevice(fakeGladys, GARE, language),
  buildLineDevice(fakeGladys, L6, language),
  buildLineDevice(fakeGladys, T1, language),
  buildLineDevice(fakeGladys, AMIGO, language),
];

// Pairs with an icon and a label in the Gladys front (front/src/utils/consts.js).
const PAIRS = [
  [DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, undefined],
  [
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    DEVICE_FEATURE_UNITS.MINUTES,
  ],
  [DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, undefined],
];

test('devices are never polled by Gladys: the integration has its own timer', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) {
          assert.equal(typeof feature[key], 'number', `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(feature.read_only, true, feature.external_id);
        assert.equal(feature.has_feedback, false, feature.external_id);
        assert.ok(feature.name.length > 0 && feature.name.length <= 255);
      }
      const names = new Set(device.features.map((feature) => feature.name));
      assert.equal(names.size, device.features.length, 'every feature has its own name');
    }
  }
});

test('category / type / unit pairs known to the Gladys front, from the SDK constants', () => {
  for (const feature of devices('en').flatMap((device) => device.features)) {
    assert.ok(
      PAIRS.some(
        ([category, type, unit]) =>
          feature.category === category && feature.type === type && feature.unit === unit,
      ),
      `${feature.external_id}: ${feature.category}/${feature.type}/${feature.unit}`,
    );
  }
});

test('ids from the code of the stop, the route id and the direction; read back', () => {
  const [comedie, gare, l6, t1, amigo] = devices('fr');
  assert.equal(comedie.external_id, 'ext:tam-montpellier:stop:comedie_1_mosson');
  assert.equal(comedie.name, 'TaM Comédie (1 → Mosson)');
  assert.equal(gare.external_id, 'ext:tam-montpellier:stop:gare-saint-roch');
  assert.equal(gare.name, 'TaM Gare Saint-Roch');
  assert.deepEqual([l6.external_id, l6.name], ['ext:tam-montpellier:line:6', 'TaM ligne 6']);
  assert.deepEqual([t1.external_id, t1.name], ['ext:tam-montpellier:line:1', 'TaM tram 1']);
  assert.deepEqual(
    [amigo.external_id, amigo.name],
    ['ext:tam-montpellier:line:amigo', 'TaM ligne Amigo'],
  );
  assert.equal(devices('de')[3].name, 'TaM Straßenbahn 1');
  assert.deepEqual(parseExternalId('ext:tam-montpellier:stop:gare-saint-roch:wait'), {
    type: 'stop',
    key: 'gare-saint-roch',
  });
  assert.deepEqual(parseExternalId('ext:tam-montpellier:line:1'), { type: 'line', key: '1' });
  assert.equal(parseExternalId('something'), null);
  // Other accents or case in the direction: the same device.
  assert.equal(stopKey(COMEDIE_1.stop, COMEDIE_1.line, 'MOSSON'), COMEDIE_1.key);
  assert.deepEqual(
    comedie.params.map((param) => [param.name, param.value]),
    [
      ['TAM_STOP', 'Comédie'],
      ['TAM_LINE', '1'],
      ['TAM_DIRECTION', 'Mosson'],
    ],
  );
});

test('stop states: the next passage, the two waits and the delay', () => {
  const states = buildStopStates(fakeGladys, COMEDIE_1, forStop(PASSAGES), {
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  const byKey = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state ?? s.text]),
  );
  // 22:44:03: the 1 of 22:58, 1 min late (22:59), then the one of 23:13.
  assert.equal(byKey.wait, 14);
  assert.equal(byKey.following, 28);
  assert.equal(byKey.delay, 1);
  assert.equal(byKey.next, '1 → Mosson · 14 min (+1 min de retard)');
  // The timetable only: no delay published, the text says it.
  const scheduled = buildStopStates(
    fakeGladys,
    COMEDIE_1,
    [passage({ time: '22:50', realtime: false })],
    { language: 'en', now: NOW, timeZone: TZ },
  );
  assert.deepEqual(
    scheduled.map((s) => s.device_feature_external_id.split(':').pop()),
    ['next', 'wait'],
  );
  assert.equal(scheduled[0].text, '1 → Mosson · 5 min (timetable)');
  // Nothing announced: the waits are left untouched.
  const empty = buildStopStates(fakeGladys, GARE, [], { language: 'es', now: NOW });
  assert.deepEqual(
    empty.map((s) => s.text),
    ['Ningún paso anunciado'],
  );
});

test('line states: the state with the title of the heaviest message, the count', () => {
  assert.deepEqual(
    buildLineStates(fakeGladys, L17, lineTraffic(traffic, '17', NOW), 'fr').map(
      (s) => s.text ?? s.state,
    ),
    ['Trafic perturbé : Travaux : La ligne 17 est déviée.', 1],
  );
  assert.deepEqual(
    buildLineStates(fakeGladys, L6, lineTraffic(traffic, '6', NOW), 'en').map(
      (s) => s.text ?? s.state,
    ),
    ['Normal traffic', 0],
  );
  const [status] = buildLineStates(fakeGladys, T1, lineTraffic(traffic, '1', NOW), 'de');
  assert.equal(status.text, 'Verkehrsinformation: Travaux de nuit');
  assert.equal(lineStatusText({ state: 'major', messages: [] }, 'es'), 'Tráfico muy alterado');
});

test('the discovery batch and the states pass the checks of the fake host API', async (t) => {
  const gladys = createFakeGladys({});
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  for (const language of LANGUAGES) {
    await gladys.publishDiscoveredDevices([
      buildStopDevice(gladys, COMEDIE_1, language),
      buildLineDevice(gladys, L17, language),
    ]);
  }
  const [stop, line] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(stop);
  await gladys.fake.deviceCreated(line);
  await gladys.publishStates(
    buildStopStates(gladys, COMEDIE_1, forStop(PASSAGES), { language: 'en', now: NOW }),
  );
  await gladys.publishStates(buildLineStates(gladys, L17, lineTraffic(traffic, '17', NOW), 'en'));
  assert.equal(idsOf(gladys, DEVICE_TYPES.STOP, COMEDIE_1.key).device, stop.external_id);
  assert.equal(idsOf(gladys, DEVICE_TYPES.LINE, '17').device, line.external_id);
  assert.equal(gladys.fake.lastState(`${stop.external_id}:wait`), 14);
  assert.equal(gladys.fake.lastState(`${line.external_id}:messages`), 1);
});
