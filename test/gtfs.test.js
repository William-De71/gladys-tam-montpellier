import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  zipEntries,
  readEntry,
  splitCsvLine,
  eachRow,
  gtfsSeconds,
  serviceDates,
  readGtfs,
} from '../src/gtfs.js';
import { GTFS_ZIP, makeZip, gtfsFiles } from './helpers/fixtures.js';

test('a zip, deflated or stored, read through its central directory', async () => {
  for (const store of [false, true]) {
    const zip = makeZip({ 'a.txt': 'héllo', 'dir/b.txt': 'b' }, { store });
    const entries = zipEntries(zip);
    assert.deepEqual([...entries.keys()], ['a.txt', 'b.txt']);
    assert.equal((await readEntry(zip, entries, 'a.txt')).toString('utf8'), 'héllo');
    assert.equal(await readEntry(zip, entries, 'none.txt'), null);
  }
  assert.throws(() => zipEntries(Buffer.from('not a zip at all, not at all')), {
    kind: 'invalid',
  });
});

test('CSV: quotes, CRLF, a byte order mark', () => {
  assert.deepEqual(splitCsvLine('a,"b, c",d'), ['a', 'b, c', 'd']);
  assert.deepEqual(splitCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
  const rows = [];
  eachRow(Buffer.from('﻿id,name\r\n1,"Gare, Sud"\r\n\r\n2,Corum\r\n'), (row, column) =>
    rows.push([row[column('id')], row[column('name')]]),
  );
  assert.deepEqual(rows, [
    ['1', 'Gare, Sud'],
    ['2', 'Corum'],
  ]);
  eachRow(null, () => assert.fail('no row'));
});

test('GTFS times beyond midnight; the dates of the services', () => {
  assert.equal(gtfsSeconds('06:43:00'), 6 * 3600 + 43 * 60);
  assert.equal(gtfsSeconds('25:10:30'), 25 * 3600 + 10 * 60 + 30);
  assert.equal(gtfsSeconds('soon'), null);
  const calendar = Buffer.from(
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      'WEEK,1,1,1,1,1,0,0,20261001,20261231\n',
  );
  const dates = Buffer.from(
    'service_id,date,exception_type\nWEEK,20261028,2\nSUN,20261101,1\nOLD,20250101,1\n',
  );
  assert.deepEqual(Object.fromEntries(serviceDates(calendar, dates, '20261026', '20261102')), {
    WEEK: ['20261026', '20261027', '20261029', '20261030', '20261102'],
    SUN: ['20261101'],
  });
});

test('the GTFS of the TaM: reference data, then the departures of some platforms', async () => {
  const reference = await readGtfs(GTFS_ZIP);
  assert.equal(reference.routes.length, 45);
  assert.equal(reference.stops.length, 1461);
  assert.equal(reference.timetable, null);
  assert.deepEqual(reference.linesByStop['41133'], ['2', '3', '1']);
  const { timetable } = await readGtfs(GTFS_ZIP, {
    stopIds: new Set(['41133', '41223']),
    from: '20261027',
    to: '20261028',
  });
  assert.ok(timetable.rows.length > 300);
  for (const [tripId, stopId, seconds] of timetable.rows) {
    assert.ok(['41133', '41223'].includes(stopId));
    assert.ok(seconds > 0 && seconds < 30 * 3600);
    const trip = timetable.trips[tripId];
    assert.ok(['1', '2', '3'].includes(trip[0]), tripId);
    assert.ok(timetable.services[trip[1]].length > 0);
  }
  // A terminus is an arrival, never a departure.
  const files = gtfsFiles();
  const last = files['stop_times.txt'].trim().split('\n').at(-1).split(',');
  const { timetable: end } = await readGtfs(GTFS_ZIP, {
    stopIds: new Set([last[3]]),
    from: '20261027',
    to: '20261028',
  });
  assert.ok(!end.rows.some(([tripId]) => tripId === last[0]));
});

test('a GTFS without its files is refused', async () => {
  await assert.rejects(readGtfs(makeZip({ 'agency.txt': 'agency_id\nTAM\n' })), {
    kind: 'invalid',
  });
});
