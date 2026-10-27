import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  directionTerms,
  serviceStart,
  indexTripUpdates,
  applyRealtime,
  buildPassages,
  minutesLeft,
  upcomingPassages,
  cancelledPassages,
  routeOf,
} from '../src/departures.js';
import { decodeFeed } from '../src/gtfs-rt.js';
import { NOW, encodeFeed, paris, passage, fixturePassages } from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
const index = (tripUpdates) => indexTripUpdates(decodeFeed(encodeFeed({ tripUpdates })));

test('GTFS times count from noon minus 12 hours, even when the clocks change', () => {
  assert.equal(serviceStart('20261027'), Date.parse('2026-10-26T23:00:00Z'));
  // 25 October 2026: back to winter time at 03:00. Noon minus 12 hours is
  // 01:00 summer time, not midnight.
  assert.equal(serviceStart('20261025'), Date.parse('2026-10-24T23:00:00Z'));
  assert.deepEqual(directionTerms('Mosson | Gare Sud'), ['mosson', 'gare sud']);
  assert.deepEqual(directionTerms(''), []);
});

test('real time: the estimate of the platform, the closest one on a loop line', () => {
  const scheduled = paris('22:50');
  const at = (minutes) => (scheduled + minutes * MINUTE) / 1000;
  const updates = index([
    {
      tripId: 'U_1',
      stops: [
        { stopId: '41133', time: at(-40), delay: 0 },
        { stopId: '41135', time: at(-5), delay: 30 },
        { stopId: '41133', time: at(3), delay: 120 },
      ],
    },
    { tripId: 'U_2', cancelled: true },
    { tripId: 'U_3', stops: [{ stopId: '41133', skipped: true }] },
  ]);
  assert.deepEqual(applyRealtime(updates.get('U_1'), '41133', scheduled, NOW), {
    at: scheduled + 3 * MINUTE,
    realtime: true,
    cancelled: false,
  });
  // No estimate for this platform: the delay of the platform before it.
  assert.deepEqual(applyRealtime(updates.get('U_1'), '41999', scheduled, NOW), {
    at: scheduled + 30000,
    realtime: true,
    cancelled: false,
  });
  assert.equal(applyRealtime(updates.get('U_2'), '41133', scheduled, NOW).cancelled, true);
  // A cancelled trip of today says nothing of tomorrow.
  assert.equal(
    applyRealtime(updates.get('U_2'), '41133', scheduled + 24 * 60 * MINUTE, NOW).cancelled,
    false,
  );
  assert.equal(applyRealtime(updates.get('U_3'), '41133', scheduled, NOW).cancelled, true);
  // No update, or one of another day: the timetable only.
  assert.deepEqual(applyRealtime(undefined, '41133', scheduled, NOW), {
    at: scheduled,
    realtime: false,
    cancelled: false,
  });
  assert.equal(
    applyRealtime(updates.get('U_1'), '41133', scheduled + 24 * 60 * MINUTE, NOW).realtime,
    false,
  );
});

test('the passages of a real stop: timetable, real time, filters', async () => {
  const gare = await fixturePassages('Gare Saint-Roch');
  assert.equal(gare.length, 38);
  assert.ok(gare.every((p, i) => i === 0 || gare[i - 1].at <= p.at));
  // The trams in service are followed; the later ones are the timetable.
  const [first] = gare;
  assert.deepEqual(
    [first.line, first.destination, first.realtime, minutesLeft(first, NOW)],
    ['1', 'Occitanie', true, 0],
  );
  assert.ok(gare.some((p) => !p.realtime) && gare.some((p) => p.realtime && p.delay !== 0));
  assert.ok(gare.every((p) => p.at > NOW - 30000 && p.at <= NOW + 24 * 60 * MINUTE));
  // The next three hours, eight per route at most.
  const routes = Map.groupBy(gare, routeOf);
  assert.ok([...routes.values()].every((list) => list.length <= 8));
  const timetable = await fixturePassages('Gare Saint-Roch', { realtime: false });
  assert.ok(timetable.every((p) => !p.realtime && p.delay === 0));
  const tram1 = await fixturePassages('Gare Saint-Roch', {
    lineId: '1',
    direction: 'mosson|occitanie',
  });
  assert.ok(tram1.length > 0);
  assert.ok(tram1.every((p) => p.lineId === '1' && p.destination === 'Occitanie'));
  // A stop asleep: the first departure of each route, the next morning.
  assert.deepEqual(
    (await fixturePassages('Château')).map((p) => [p.line, p.destination, p.realtime]),
    [
      ['36', 'Charles de Gaulle', false],
      ['36', 'Stade de Montaud', false],
      ['22', 'Collège P. M. France', false],
    ],
  );
  assert.deepEqual(buildPassages({ timetable: null, stop: { ids: [] }, now: NOW }), []);
});

test('waits, the passages to come, the cancelled ones', () => {
  const list = [
    passage({ time: '22:40' }),
    passage({ time: '22:50', cancelled: true }),
    passage({ time: '22:55' }),
  ];
  assert.equal(minutesLeft(list[2], NOW), 10);
  assert.equal(minutesLeft(list[0], NOW), 0);
  assert.deepEqual(
    upcomingPassages(list, NOW).map((p) => p.trip),
    ['1-22:55'],
  );
  assert.deepEqual(
    cancelledPassages(list, NOW).map((p) => p.trip),
    ['1-22:50'],
  );
  assert.equal(routeOf(list[0]), '1|mosson');
});
