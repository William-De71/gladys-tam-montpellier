// -----------------------------------------------------------------------------
// The traffic of the lines, read every 5 minutes from the GTFS-RT service
// alerts of the TaM (works, diversions, stops not served, events):
//   - each alert names its lines (`informed_entity.route_id`) or its
//     platforms (`stop_id`: the lines calling there are concerned), its
//     periods of validity (Unix times) and its texts. The header of the TaM
//     is often an internal code ("TR/L17/Dev/ TRL17Dev- 17DEV  2 SENSRUGBY"):
//     the title is then the first sentence of the description;
//   - its weight comes from its effect when the TaM sets one (NO_SERVICE ->
//     major; reduced service, delays, detour, stop moved -> disrupted; the
//     others -> info), else from its words ("interrompu" -> major, "déviée",
//     "non desservis", "perturbé" -> disrupted).
// States of a line, from the mildest: `unknown` (nothing read yet), `normal`,
// `info` (a message under way, normal service), `disrupted`, `major`: the
// heaviest message under way. The texts are in French only.
// -----------------------------------------------------------------------------

import { MINUTE_MS } from './time.js';

const STATES = ['unknown', 'normal', 'info', 'disrupted', 'major'];
const SERIOUS = ['disrupted', 'major'];
// A message starting this soon is shown as coming.
const UPCOMING_MS = 3 * 24 * 60 * MINUTE_MS;
const TEXT_MAX = 2000;
const TITLE_MAX = 140;
// GTFS-RT effects.
const EFFECT_STATES = {
  1: 'major',
  2: 'disrupted',
  3: 'disrupted',
  4: 'disrupted',
  5: 'info',
  6: 'info',
  7: 'info',
  9: 'disrupted',
  10: 'info',
  11: 'info',
};
const SEVERE = 4;
const MAJOR_WORDS =
  /\b(interrompue?s?|interruption|suspendue?s?|hors service|ne circule(nt)? (pas|plus)|aucun(e)? (tram|bus|circulation|desserte)|pas de (circulation|tram|bus))\b/i;
const DISRUPTED_WORDS =
  /\b(d[ée]vi[ée]e?s?|d[ée]viation|perturb[ée]e?s?|perturbation|retards?|non desservie?s?|pas desservie?s?|ralentie?s?|report[ée]e?s?|limit[ée]e?s?|accident|incident|manifestation)\b/i;

/**
 * @description A plain text: no tags, blank lines dropped.
 * @param {unknown} value - The text.
 * @param {number} [max] - Its longest length.
 * @returns {string} The text.
 */
function plainText(value, max = TEXT_MAX) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

/**
 * @description A short title.
 * @param {string} title - The title of the message.
 * @param {string} text - Its text.
 * @returns {string} The title, or the first sentence of the text, at most TITLE_MAX characters.
 */
function titleOf(title, text) {
  const [firstLine = ''] = text.split('\n');
  const sentence = title || (/^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine);
  return sentence.length > TITLE_MAX ? `${sentence.slice(0, TITLE_MAX - 1)}…` : sentence;
}

/**
 * @description The document of a message, when on https.
 * @param {unknown} value - The URL.
 * @returns {string} The URL, '' when none.
 */
function linkOf(value) {
  const url = String(value ?? '').trim();
  if (!/^https:\/\/\S+$/i.test(url.replace(/ /g, '%20')) || url.length > 2048) {
    return '';
  }
  return url.replace(/ /g, '%20');
}

/**
 * @description Whether the header of an alert reads as a title, not a code.
 * @param {string} header - The header text.
 * @returns {boolean} True for words, false for "TR/L17/Dev/ TRL17Dev- …".
 */
const readableHeader = (header) =>
  /[a-zàâçéèêëîïôûùüÿœ]{3}/.test(header) && !/[A-Za-z0-9]+\/[A-Za-z0-9]+\//.test(header);

/**
 * @description The weight of an alert.
 * @param {object} alert - The alert (effect, severity, texts).
 * @param {string} text - Its text.
 * @returns {string} `info`, `disrupted` or `major`.
 */
function alertState(alert, text) {
  if (alert.severity === SEVERE) {
    return 'major';
  }
  if (EFFECT_STATES[alert.effect]) {
    return EFFECT_STATES[alert.effect];
  }
  if (MAJOR_WORDS.test(text)) {
    return 'major';
  }
  return DISRUPTED_WORDS.test(text) ? 'disrupted' : 'info';
}

/**
 * @description What is kept of an alert.
 * @param {object} alert - An alert of the feed.
 * @param {Function} [linesOfPlatform] - `(platform id) => route ids`.
 * @returns {object} `{ id, lineIds, state, title, text, url, periods, hours }`,
 * periods `[{ start, end }]` in ms (null when open).
 */
function messageOf(alert, linesOfPlatform = () => []) {
  const header = plainText(alert.header, TITLE_MAX * 2);
  const description = plainText(alert.description);
  const title = titleOf(readableHeader(header) ? header : '', description);
  const text = description || (readableHeader(header) ? header : '');
  const lineIds = [
    ...new Set([
      ...alert.routeIds.filter(Boolean),
      ...alert.stopIds.flatMap((stopId) => linesOfPlatform(stopId)),
    ]),
  ];
  return {
    id: String(alert.id),
    lineIds,
    state: alertState(alert, `${header} ${description}`),
    title,
    text,
    url: linkOf(alert.url),
    periods: alert.periods.map((period) => ({
      start: period.start ? period.start * 1000 : null,
      end: period.end ? period.end * 1000 : null,
    })),
    hours: '',
  };
}

/**
 * @description Read the traffic.
 * @param {object} feed - decodeFeed() of the alerts.
 * @param {object} [options] - `{ linesOfPlatform }`.
 * @returns {{ messages: object[] }} The messages about a line.
 */
function parseTraffic(feed, { linesOfPlatform } = {}) {
  return {
    messages: (feed?.alerts ?? [])
      .map((alert) => messageOf(alert, linesOfPlatform))
      .filter((message) => message.lineIds.length > 0 && (message.text || message.title)),
  };
}

/**
 * @description The rank of a state, for comparisons.
 * @param {string} state - A state.
 * @returns {number} Its position in STATES.
 */
const rank = (state) => STATES.indexOf(state);

/**
 * @description A message as it stands at an instant: under way (the period
 * holding now), coming (its next period) or over.
 * @param {object} message - The message.
 * @param {number} now - Now (ms).
 * @returns {object|null} The message with `start`, `end` and `coming`, null when over.
 */
function messageAt(message, now) {
  const periods = message.periods.length ? message.periods : [{ start: null, end: null }];
  const current = periods.find(
    (period) => (period.start ?? -Infinity) <= now && (period.end ?? Infinity) > now,
  );
  if (current) {
    return { ...message, start: current.start, end: current.end, coming: false };
  }
  const next = periods
    .filter((period) => period.start !== null && period.start > now)
    .sort((a, b) => a.start - b.start)[0];
  return next ? { ...message, start: next.start, end: next.end, coming: true } : null;
}

/**
 * @description The traffic of one line.
 * @param {object|null} traffic - parseTraffic().
 * @param {string} lineId - The route id.
 * @param {number} now - Now (ms).
 * @returns {{ state: string, since: number|null, messages: object[], upcoming: object[] }}
 * Its state, the messages under way (heaviest, then latest start first) and
 * the ones coming in the next three days (soonest first).
 */
function lineTraffic(traffic, lineId, now) {
  if (!traffic) {
    return { state: 'unknown', since: null, messages: [], upcoming: [] };
  }
  const own = traffic.messages
    .filter((message) => message.lineIds.includes(lineId))
    .map((message) => messageAt(message, now))
    .filter(Boolean);
  const messages = own
    .filter((message) => !message.coming)
    .sort((a, b) => rank(b.state) - rank(a.state) || (b.start ?? 0) - (a.start ?? 0));
  const upcoming = own
    .filter((message) => message.coming && message.start - now <= UPCOMING_MS)
    .sort((a, b) => a.start - b.start);
  const state = messages[0]?.state ?? 'normal';
  return {
    state,
    since: SERIOUS.includes(state) ? (messages[0].start ?? null) : null,
    messages,
    upcoming,
  };
}

/**
 * @description The messages of a line about a disruption under way.
 * @param {{ messages: object[] }} line - lineTraffic().
 * @returns {object[]} The messages.
 */
const seriousMessages = (line) => line.messages.filter((m) => SERIOUS.includes(m.state));

export {
  STATES,
  SERIOUS,
  UPCOMING_MS,
  plainText,
  titleOf,
  linkOf,
  readableHeader,
  alertState,
  messageOf,
  parseTraffic,
  rank,
  messageAt,
  lineTraffic,
  seriousMessages,
};
