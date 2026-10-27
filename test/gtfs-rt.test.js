import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeFeed, readVarint } from '../src/gtfs-rt.js';
import { TRIP_UPDATES, ALERTS, NOW, encodeFeed, varint } from './helpers/fixtures.js';

test('varints, negative ones on 64 bits', () => {
  assert.deepEqual(readVarint(varint(300), 0), [300n, 2]);
  assert.equal(BigInt.asIntN(64, readVarint(varint(-44), 0)[0]), -44n);
  assert.throws(() => readVarint(Buffer.from([0x80]), 0), { kind: 'invalid' });
});

test('the real trip updates of the TaM', () => {
  const feed = decodeFeed(TRIP_UPDATES);
  assert.equal(feed.timestamp * 1000, NOW);
  assert.equal(feed.tripUpdates.length, 91);
  const [first] = feed.tripUpdates;
  assert.match(first.tripId, /^[US]_/);
  assert.ok(first.routeId);
  assert.ok(first.stops.length > 0);
  // Early or late, in seconds. The urban trips send no stop_sequence; the
  // suburban ones send it, with a time and no delay.
  const delays = feed.tripUpdates.flatMap((update) =>
    update.stops.map((stop) => stop.departure?.delay ?? stop.arrival?.delay ?? 0),
  );
  assert.ok(delays.some((delay) => delay < 0));
  const urban = feed.tripUpdates.filter((update) => update.tripId.startsWith('U_'));
  assert.ok(urban.every((update) => update.stops.every((s) => s.sequence === null)));
  const suburban = feed.tripUpdates.find((update) => update.tripId.startsWith('S_'));
  assert.deepEqual([suburban.stops[0].sequence, suburban.stops[0].departure.delay], [1, null]);
});

test('the real alert of the TaM: lines, period, texts', () => {
  const [alert] = decodeFeed(ALERTS).alerts;
  assert.deepEqual(
    [alert.id, alert.routeIds, alert.periods],
    ['1053187', ['17'], [{ start: 1793453400, end: 1793473200 }]],
  );
  assert.match(alert.header, /TR\/L17\/Dev/);
  assert.match(alert.description, /^Rugby : La ligne 17 est déviée\./);
});

test('cancelled trips, skipped stops, effects; garbage refused', () => {
  const feed = decodeFeed(
    encodeFeed({
      tripUpdates: [
        { tripId: 'U_1', routeId: '1', cancelled: true },
        {
          tripId: 'U_2',
          routeId: '2',
          directionId: 1,
          stops: [
            { stopId: '41133', time: 1793137800, delay: -30 },
            { stopId: '41135', skipped: true },
          ],
        },
      ],
      alerts: [{ id: 'a', routeIds: ['3'], stopIds: ['41133'], effect: 1, url: 'https://x.fr' }],
    }),
  );
  assert.equal(feed.tripUpdates[0].cancelled, true);
  const [arrival, skipped] = feed.tripUpdates[1].stops;
  assert.deepEqual(arrival.departure, { delay: -30, time: 1793137800 });
  assert.equal(skipped.skipped, true);
  assert.equal(feed.tripUpdates[1].directionId, 1);
  assert.deepEqual(
    [feed.alerts[0].effect, feed.alerts[0].stopIds, feed.alerts[0].url],
    [1, ['41133'], 'https://x.fr'],
  );
  assert.throws(() => decodeFeed(Buffer.from('<html>Bad Gateway</html>')), { kind: 'invalid' });
  assert.throws(() => decodeFeed(Buffer.alloc(0)), { kind: 'invalid' });
});
