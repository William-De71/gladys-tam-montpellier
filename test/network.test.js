import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  fold,
  slug,
  lineOf,
  byLine,
  groupStops,
  findLine,
  findStop,
  searchStops,
  gtfsDate,
  createNetwork,
  MODES,
} from '../src/network.js';
import { readGtfs } from '../src/gtfs.js';
import { createTamClient } from '../src/tam-api.js';
import { createStore } from '../src/store.js';
import { newDaySince } from '../src/time.js';
import {
  GTFS_ZIP,
  NOW,
  TZ,
  LAST_MODIFIED,
  fakeTam,
  storePath,
  silent,
} from './helpers/fixtures.js';

const reference = await readGtfs(GTFS_ZIP);
const lines = reference.routes.map(lineOf).sort(byLine);
const stops = groupStops(reference.stops, reference.linesByStop);

test('names folded for comparisons, slugs for the ids', () => {
  assert.equal(fold("Pérols Étang de l'Or"), 'perols etang de l or');
  assert.equal(slug('Gare Saint-Roch - Pont de Sète'), 'gare-saint-roch-pont-de-sete');
  assert.equal(gtfsDate(NOW, TZ), '20261027');
});

test('lines: route id, public name, mode and colour, trams first', () => {
  assert.deepEqual(
    lines.find((line) => line.id === '1'),
    {
      id: '1',
      name: '1',
      longName: 'Mosson - Gare Sud de France',
      mode: MODES.TRAM,
      color: '#005CA9',
    },
  );
  assert.equal(lines.length, 45);
  assert.deepEqual(
    lines.slice(0, 6).map((line) => [line.id, line.mode]),
    [
      ['1', 'tram'],
      ['2', 'tram'],
      ['3', 'tram'],
      ['4', 'tram'],
      ['5', 'tram'],
      ['6', 'bus'],
    ],
  );
});

test('a line is typed the way users read it', () => {
  const id = (typed) => findLine(lines, typed)?.id ?? null;
  assert.equal(id('1'), '1');
  assert.equal(id('tram 1'), '1');
  assert.equal(id('Tramway 4'), '4');
  assert.equal(id('ligne 17'), '17');
  assert.equal(id('bus 6'), '6');
  assert.equal(id('amigo'), 'Amigo');
  assert.equal(id('A'), 'A');
  assert.equal(id('Z9'), null);
  assert.equal(id(''), null);
});

test('stops: the platforms of one name, their codes and lines', () => {
  assert.equal(stops.length, 674);
  const gare = stops.find((stop) => stop.name === 'Gare Saint-Roch');
  assert.deepEqual(gare, {
    code: 'gare-saint-roch',
    name: 'Gare Saint-Roch',
    ids: ['41135', '41221'],
    platforms: ['41135', '41221'],
    lines: ['2', '3', '1'],
    lat: gare.lat,
    lon: gare.lon,
  });
  assert.ok(Math.abs(gare.lat - 43.605) < 0.01 && Math.abs(gare.lon - 3.88) < 0.01);
  // Every code is unique, even for two names of one slug.
  assert.equal(new Set(stops.map((stop) => stop.code)).size, stops.length);
  const twins = groupStops(
    [
      { id: '1', code: '1', name: 'Château', lat: 0, lon: 0 },
      { id: '2', code: '2', name: 'Chateau', lat: 0, lon: 0 },
    ],
    {},
  );
  assert.deepEqual(
    twins.map((stop) => stop.code),
    ['chateau', 'chateau-2'],
  );
});

test('a stop is typed by its name, a few of its words or a platform code', () => {
  const name = (typed) => findStop(stops, typed)?.name ?? null;
  assert.equal(name('gare saint roch'), 'Gare Saint-Roch');
  assert.equal(name('Gare Saint-Roch - Pont de Sète'), 'Gare Saint-Roch - Pont de Sète');
  assert.equal(name('comedie'), 'Comédie');
  assert.equal(name('CORUM'), 'Corum');
  assert.equal(name('rondel'), 'Rondelet');
  assert.equal(name('41115'), 'Occitanie Hôpitaux - Facultés');
  assert.equal(name('chateau'), 'Château');
  // Several stops hold "gare": the user says which.
  assert.equal(name('gare'), null);
  assert.equal(name('Nulle part'), null);
  assert.equal(name(''), null);
  assert.deepEqual(
    searchStops(stops, 'gare saint').map((stop) => stop.name),
    ['Gare Saint-Roch', 'Gare Saint-Roch - Pont de Sète', 'Gare Saint-Roch - République'],
  );
  assert.deepEqual(searchStops(stops, '  '), []);
});

/**
 * @description A network on the fake TaM, with its store.
 * @param {object} [options] - `{ path, clock }`.
 * @returns {Promise<object>} `{ network, api, fetch, store, clock, path }`.
 */
async function network({ path = storePath(), clock = { now: NOW } } = {}) {
  const fetch = fakeTam();
  const api = createTamClient({ fetch, now: () => clock.now });
  const store = createStore({ path });
  await store.load();
  return {
    network: createNetwork({
      api,
      store,
      zipPath: join(dirname(path), 'tam-gtfs.zip'),
      now: () => clock.now,
      isNewDay: (since) => newDaySince(since, clock.now, TZ),
      timeZone: TZ,
      logger: silent,
    }),
    api,
    fetch,
    store,
    clock,
    path,
  };
}

test('the timetable is read once, kept with the zip, asked again daily (304)', async () => {
  const first = await network();
  assert.equal((await first.network.lines()).length, 45);
  assert.equal((await first.network.stops()).length, 674);
  await first.network.resolveStop('comedie');
  assert.equal(first.fetch.calls.length, 1);
  assert.equal(first.store.data.network.lastModified, LAST_MODIFIED);
  assert.ok(existsSync(join(dirname(first.path), 'tam-gtfs.zip')));
  // A restart: the store and the zip, nothing downloaded.
  const restart = await network({ path: first.path });
  assert.equal((await restart.network.resolveLine('tram 2')).id, '2');
  assert.equal(restart.fetch.calls.length, 0);
  // The next day: asked again with If-Modified-Since, unchanged.
  restart.clock.now = NOW + 24 * 3600 * 1000;
  await restart.network.lines();
  assert.deepEqual(restart.fetch.calls, [{ path: '/GTFS.zip', since: LAST_MODIFIED }]);
  assert.equal(restart.api.requests.notModified, 1);
  // A failure keeps what is known.
  restart.fetch.state.fail = 503;
  assert.equal((await restart.network.lines(true)).length, 45);
});

test('without anything kept, a failure is an error', async () => {
  const { network: net, fetch } = await network();
  fetch.state.fail = 'network';
  await assert.rejects(net.lines(), { kind: 'unreachable' });
});

test('the timetable of the stops: built from the zip, kept while it holds them', async () => {
  const { network: net } = await network();
  const comedie = await net.resolveStop('comedie');
  const gare = await net.resolveStop('gare saint roch');
  const first = await net.timetable([comedie]);
  assert.deepEqual(first.codes, ['comedie']);
  assert.equal(first.from, '20261026');
  assert.equal(first.to, '20261102');
  assert.ok(first.rows.length > 300);
  assert.ok(first.rows.every(([, stopId]) => comedie.ids.includes(stopId)));
  // Kept as is for the same stop.
  assert.equal(await net.timetable([comedie]), first);
  // Another stop: both.
  const both = await net.timetable([gare]);
  assert.deepEqual(both.codes, ['comedie', 'gare-saint-roch']);
  assert.equal(net.describeTimetable().stops.length, 2);
  assert.deepEqual(net.linesOfPlatform('41135'), ['2', '3', '1']);
  assert.equal(net.peekLine('17').name, '17');
});
