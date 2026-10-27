import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTamClient, USER_AGENT } from '../src/tam-api.js';
import { fakeTam, LAST_MODIFIED, GTFS_ZIP } from './helpers/fixtures.js';

test('the timetable, then 304 while unchanged; the feeds decoded', async () => {
  const fetch = fakeTam();
  const api = createTamClient({ fetch });
  const answer = await api.gtfs();
  assert.equal(answer.lastModified, LAST_MODIFIED);
  assert.equal(answer.zip.length, GTFS_ZIP.length);
  assert.equal(await api.gtfs(LAST_MODIFIED), null);
  assert.equal((await api.tripUpdates()).tripUpdates.length, 91);
  assert.equal((await api.alerts()).alerts.length, 1);
  assert.deepEqual(api.requests.byEndpoint, { gtfs: 2, trip_updates: 1, alerts: 1 });
  assert.equal(api.requests.notModified, 1);
  assert.match(USER_AGENT, /^gladys-tam-montpellier\//);
});

test('errors: unreachable, busy, invalid', async () => {
  const fetch = fakeTam();
  const api = createTamClient({ fetch });
  fetch.state.fail = 'network';
  await assert.rejects(api.tripUpdates(), { kind: 'unreachable', message: 'ECONNREFUSED' });
  fetch.state.fail = 503;
  await assert.rejects(api.alerts(), { kind: 'busy', status: 503 });
  fetch.state.fail = 404;
  await assert.rejects(api.gtfs(), { kind: 'invalid' });
  fetch.state.fail = null;
  fetch.state.tripUpdates = Buffer.from('<html>oops</html>');
  await assert.rejects(api.tripUpdates(), { kind: 'invalid' });
  assert.equal(api.requests.failed, 4);
});
