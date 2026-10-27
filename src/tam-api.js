// -----------------------------------------------------------------------------
// HTTP client of the open data of the TaM, the trams and buses of Montpellier
// Méditerranée Métropole: https://transport.data.gouv.fr/datasets/offre-de-transport-tam-en-temps-reel-gtfs-rt-urbain-et-suburbain
// No key, ODbL. The "COMMON" feeds cover the urban and the suburban lines
// (their trip ids are prefixed "U_" and "S_" in both the GTFS and the
// GTFS-RT, so they match):
//   /COMMON/GTFS.zip           the timetable (3.9 MB, rebuilt every night):
//                              read with If-Modified-Since, at most daily;
//   /COMMON/TripUpdate.pb      GTFS-RT trip updates of the whole network
//                              (60 KB): ONE request for every followed stop;
//   /COMMON/Alert.pb           GTFS-RT service alerts (traffic messages).
// The VehiclePosition.pb feed is not used.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { decodeFeed } from './gtfs-rt.js';

const BASE_URL = process.env.TAM_API_URL || 'https://gtfsproxy.e-tam.fr/COMMON';
const TIMEOUT_MS = 20000;
const GTFS_TIMEOUT_MS = 120000;
// The zip is about 4 MB: anything far bigger is not the timetable.
const GTFS_MAX_BYTES = 64 * 1024 * 1024;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-tam-montpellier/${version} (+https://github.com/William-De71/gladys-tam-montpellier)`;

const ENDPOINTS = {
  GTFS: 'gtfs',
  TRIP_UPDATES: 'trip_updates',
  ALERTS: 'alerts',
};

class TamError extends Error {
  /**
   * @param {string} kind - `busy`, `unreachable` or `invalid`.
   * @param {string} message - The detail.
   * @param {object} [extra] - `{ status }`.
   */
  constructor(kind, message, { status = null } = {}) {
    super(message);
    this.name = 'TamError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * @description A client of the open data of the TaM.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - The fetch function (tests).
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {string} [options.baseUrl] - The feeds root (tests, end-to-end runs).
 * @returns {object} The methods, and `requests` for the diagnostic.
 */
function createTamClient({
  fetch: fetchFn = globalThis.fetch,
  now = () => Date.now(),
  baseUrl = BASE_URL,
} = {}) {
  // Requests made, per endpoint, for the diagnostic.
  const requests = { total: 0, byEndpoint: {}, failed: 0, notModified: 0, last: null };

  /**
   * @description Get a file of the open data.
   * @param {string} endpoint - ENDPOINTS, for the counters.
   * @param {string} path - The path, after the root.
   * @param {object} [options] - `{ headers, timeout }`.
   * @returns {Promise<Response>} The answer (200 or 304).
   */
  async function call(endpoint, path, { headers = {}, timeout = TIMEOUT_MS } = {}) {
    requests.total += 1;
    requests.byEndpoint[endpoint] = (requests.byEndpoint[endpoint] ?? 0) + 1;
    requests.last = now();
    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        headers: { 'user-agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      requests.failed += 1;
      throw new TamError('unreachable', err.cause?.code ?? err.message);
    }
    if (response.status === 304) {
      requests.notModified += 1;
      return response;
    }
    if (!response.ok) {
      requests.failed += 1;
      let kind = 'unreachable';
      if (response.status === 429 || response.status === 503) {
        kind = 'busy';
      } else if (response.status >= 400 && response.status < 500) {
        kind = 'invalid';
      }
      throw new TamError(kind, `${endpoint}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response;
  }

  /**
   * @description The bytes of an answer.
   * @param {string} endpoint - ENDPOINTS.
   * @param {Response} response - The answer.
   * @param {number} [max] - The largest accepted size.
   * @returns {Promise<Buffer>} The bytes.
   */
  async function bytesOf(endpoint, response, max = GTFS_MAX_BYTES) {
    let body;
    try {
      body = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      requests.failed += 1;
      throw new TamError('unreachable', `${endpoint}: ${err.message}`);
    }
    if (body.length > max) {
      requests.failed += 1;
      throw new TamError('invalid', `${endpoint}: ${body.length} bytes`);
    }
    return body;
  }

  /**
   * @description A GTFS-RT feed.
   * @param {string} endpoint - ENDPOINTS.
   * @param {string} path - The path.
   * @returns {Promise<object>} decodeFeed().
   */
  async function feed(endpoint, path) {
    const response = await call(endpoint, path);
    const body = await bytesOf(endpoint, response, 8 * 1024 * 1024);
    try {
      return decodeFeed(body);
    } catch (err) {
      requests.failed += 1;
      throw new TamError('invalid', `${endpoint}: ${err.message}`);
    }
  }

  return {
    requests,
    /**
     * @description The timetable, when it changed.
     * @param {string} [lastModified] - The Last-Modified of the copy kept.
     * @returns {Promise<{ zip: Buffer, lastModified: string }|null>} The
     * archive, null when unchanged (304).
     */
    gtfs: async (lastModified = '') => {
      const response = await call(ENDPOINTS.GTFS, '/GTFS.zip', {
        headers: lastModified ? { 'if-modified-since': lastModified } : {},
        timeout: GTFS_TIMEOUT_MS,
      });
      if (response.status === 304) {
        return null;
      }
      const zip = await bytesOf(ENDPOINTS.GTFS, response);
      return { zip, lastModified: response.headers.get('last-modified') ?? '' };
    },
    /**
     * @description The trip updates of the whole network.
     * @returns {Promise<object>} `{ timestamp, tripUpdates }`.
     */
    tripUpdates: () => feed(ENDPOINTS.TRIP_UPDATES, '/TripUpdate.pb'),
    /**
     * @description The service alerts.
     * @returns {Promise<object>} `{ timestamp, alerts }`.
     */
    alerts: () => feed(ENDPOINTS.ALERTS, '/Alert.pb'),
  };
}

export { BASE_URL, USER_AGENT, ENDPOINTS, TamError, createTamClient };
