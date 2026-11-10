// -----------------------------------------------------------------------------
// Dashboard widgets of the TaM integration.
//
//   - `departures`  the next passages of a stop, like the screens of the
//                   stops, compact: one row per line and destination, its
//                   next two passages, each with its unit — 1 min · 9 min,
//                   52 min · 11:07, demain 04:50 —, and the trips cancelled
//                   in the next hour ("supprimé 21:44"), the row in orange
//                   when the next one is late or a cancelled trip is shown.
//                   A followed stop (chosen among the devices), several (the
//                   devices of one stop merged, a row per stop otherwise), or
//                   any stop typed in the widget settings (with an optional
//                   line);
//   - `traffic`     the state of lines — normal, information, disrupted,
//                   heavily disrupted — then their messages under way and
//                   coming; a tap opens the full text. The followed lines,
//                   the ones typed in the settings, or the five tram lines
//                   by default.
// Every content credits the TaM and the time of the reading (ODbL).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, lineStateText, passageShort, clockText, lineLabel } from './i18n.js';
import { routeOf, upcomingPassages, cancelledPassages } from './departures.js';
import { rank } from './traffic.js';
import { formatTime, localClock, serviceDay } from './time.js';

const WIDGETS = {
  DEPARTURES: 'departures',
  TRAFFIC: 'traffic',
};

const TTL_SECONDS = {
  departures: 60,
  idle: 300,
  traffic: 180,
  message: 300,
};

const BOARD_COUNT = { min: 1, max: 8, default: 6 };
// Characters a status row holds on one line in a dashboard column: beyond,
// the core cuts the value. A route then drops its last passages.
const ROW_CHARACTERS = 46;
// Passages a row shows: the next one and the one after, like the screens.
const SHOWN_PASSAGES = 2;
const MAX_LIST_ITEMS = 8;
const MAX_STATUS_ITEMS = 10;
const STATE_COLORS = {
  unknown: WIDGET_COLORS.NEUTRAL,
  normal: WIDGET_COLORS.SUCCESS,
  info: WIDGET_COLORS.INFO,
  disrupted: WIDGET_COLORS.WARNING,
  major: WIDGET_COLORS.DANGER,
};
// A next passage this late colours its row.
const LATE_MINUTES = 5;
// Cancelled trips shown when due within this time.
const CANCELLED_SHOWN_MS = 60 * 60 * 1000;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 * @example
 * clip('Roubaix Eurotéléport', 12); // -> 'Roubaix Eur…'
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description Read a bounded integer setting.
 * @param {unknown} raw - The raw setting.
 * @param {{ min: number, max: number, default: number }} bounds - The bounds.
 * @returns {number} The value.
 */
function readCount(raw, bounds) {
  const value = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {number} [ttl] - Its freshness.
 * @returns {object} The content.
 */
function messageContent(message, ttl = TTL_SECONDS.message) {
  return { ttl_seconds: ttl, components: [{ type: 'text', variant: 'body', text: message }] };
}

/**
 * @description The rows of the "departures" widget: one per line and
 * destination, its next passages on one line, soonest route first.
 * @param {object[]} passages - The passages to come, soonest first.
 * @returns {object[][]} The passages of each route.
 */
function routesOf(passages) {
  const byRoute = new Map();
  for (const passage of passages) {
    const route = routeOf(passage);
    byRoute.set(route, [...(byRoute.get(route) ?? []), passage]);
  }
  return [...byRoute.values()];
}

/**
 * @description The passages a row shows, as on the screens of the stops: the
 * next two trips that run, and the trips cancelled in the next hour (the only
 * cancelled ones the routes carry), in time order. One trip that runs only
 * when the next belongs to a later service day: "demain 04:50 · demain 05:10"
 * would say the day twice.
 * @param {object[]} passages - The passages of the route, soonest first.
 * @param {object} options - `{ now, timeZone }`.
 * @returns {object[]} The passages to show.
 */
function shownPassages(passages, { now, timeZone }) {
  const running = passages.filter((passage) => !passage.cancelled);
  const laterDay =
    running.length > 0 && serviceDay(running[0].at, timeZone) !== serviceDay(now, timeZone);
  const kept = new Set(running.slice(0, laterDay ? 1 : SHOWN_PASSAGES));
  return passages.filter((passage) => passage.cancelled || kept.has(passage));
}

/**
 * @description The times of one route, each with its unit, so that the row
 * reads at a glance: "4 min · 19 min", "À l'approche · 12 min",
 * "52 min · 11:07", "6 min · supprimé 22:58 · 21 min", "demain 04:50".
 * @param {object[]} passages - The passages to show (shownPassages).
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The value of the row.
 */
function routeValue(passages, options) {
  const parts = passages.map((passage) =>
    passage.cancelled
      ? t('cancelledShort', options.language, { time: clockText(passage.scheduled, options) })
      : passageShort(passage, options),
  );
  return clip(parts.join(' · '), 40);
}

/**
 * @description Cut the passages of a row to one line: the trip after the next
 * goes first, then the cancellations, latest first. The next trip that runs
 * always stays.
 * @param {object[]} shown - The passages to show (shownPassages).
 * @param {string} label - The label of the row.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {{ shown: object[], value: string }} What fits, and its value.
 */
function fitRow(shown, label, options) {
  const next = shown.find((passage) => !passage.cancelled);
  let value = routeValue(shown, options);
  while (label.length + value.length > ROW_CHARACTERS) {
    const drop =
      shown.findLast((passage) => !passage.cancelled && passage !== next) ??
      shown.findLast((passage) => passage.cancelled);
    if (!drop) {
      break;
    }
    shown = shown.filter((passage) => passage !== drop);
    value = routeValue(shown, options);
  }
  return { shown, value };
}

/**
 * @description The rows of one stop: one compact row per line and
 * destination, soonest first, each row cut to one line. A row is orange when
 * its next trip is late or when it shows a cancelled trip: never for a
 * cancellation it does not show.
 * @param {object[]} upcoming - The passages to come, cancelled ones of the
 * next hour included (soonest first).
 * @param {number} count - How many routes (rows).
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object[]} The rows.
 */
function boardRows(upcoming, count, options) {
  const nextOf = (route) => route.find((passage) => !passage.cancelled);
  return (
    routesOf(upcoming)
      .filter((route) => nextOf(route))
      // By the next trip that runs: a cancelled one does not bring its route up.
      .sort((a, b) => nextOf(a).at - nextOf(b).at)
      .slice(0, count)
      .map((route) => {
        const next = nextOf(route);
        const label = clip(next.destination ? `${next.line} → ${next.destination}` : next.line, 40);
        const { shown, value } = fitRow(shownPassages(route, options), label, options);
        const troubled =
          shown.some((passage) => passage.cancelled) ||
          (next.realtime && next.delay >= LATE_MINUTES);
        return { label, value, color: troubled ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS };
      })
  );
}

/**
 * @description The "departures" widget: the stop, then one compact row per
 * line and destination, like the screens of the stops. With several stops
 * (`boards`), still one heading and one list (the content budget of the core
 * allows one status list and two texts): each stop opens with a row of its
 * own — its name and the time of its reading —, then its routes.
 * @param {object} options - Options.
 * @param {string} [options.title] - The name of the stop.
 * @param {object[]} [options.passages] - Its passages.
 * @param {number} [options.readAt] - When they were read (ms).
 * @param {object[]} [options.boards] - Several stops instead:
 * `[{ title, label, passages, readAt }]`, `label` the short name of the stop.
 * @param {number} options.count - How many routes (rows) to show per stop.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} [options.timeZone] - IANA timezone.
 * @returns {object} The content.
 */
function buildDeparturesWidget({
  title,
  passages,
  readAt,
  boards = [{ title, passages, readAt }],
  count,
  language,
  now,
  timeZone,
}) {
  const options = { language, now, timeZone };
  // A stop takes a row of its own and at least one route.
  const shown = boards.slice(0, Math.floor(MAX_STATUS_ITEMS / 2));
  const several = shown.length > 1;
  const nameOf = (board) => board.label ?? board.title;
  const headingText = several ? [...new Set(shown.map(nameOf))].join(' · ') : shown[0].title;
  const heading = { type: 'text', variant: 'heading', text: clip(headingText, 40) };
  // The oldest reading: the widget never claims fresher data than it shows.
  const oldest = Math.min(...shown.map((board) => board.readAt));
  const updated = t('updatedAt', language, { time: formatTime(oldest, timeZone) });
  const upcomingOf = (board) => upcomingPassages(board.passages, now);
  // The routes, with the trips cancelled in the next hour.
  const rowsOf = (board) =>
    [
      ...upcomingOf(board),
      ...cancelledPassages(board.passages, now).filter(
        (passage) => passage.scheduled - now <= CANCELLED_SHOWN_MS,
      ),
    ].sort((a, b) => a.at - b.at);
  const silent = () => t('noPassage', language);
  if (shown.every((board) => upcomingOf(board).length === 0)) {
    const reason = t('noPassage', language);
    return {
      ttl_seconds: TTL_SECONDS.idle,
      components: [heading, { type: 'text', variant: 'body', text: `${reason}. ${updated}.` }],
    };
  }
  // The routes of each stop share what the stop rows leave of the list.
  const perStop = several
    ? Math.max(1, Math.min(count, Math.floor((MAX_STATUS_ITEMS - shown.length) / shown.length)))
    : Math.min(count, MAX_STATUS_ITEMS);
  const items = [];
  for (const board of shown) {
    const upcoming = upcomingOf(board);
    if (several) {
      items.push({
        icon: 'map-pin',
        label: clip(nameOf(board), 40),
        value: clip(
          upcoming.length
            ? t('readAt', language, { time: formatTime(board.readAt, timeZone) })
            : silent(),
          40,
        ),
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    items.push(...boardRows(rowsOf(board), perStop, options));
  }
  // With several stops, each stop row carries its own reading time.
  return {
    ttl_seconds: TTL_SECONDS.departures,
    components: [
      heading,
      { type: 'text', variant: 'caption', text: clip(several ? 'TaM' : updated, 80) },
      { type: 'status', items },
    ],
  };
}

/**
 * @description "31/10", the day of an instant in the timezone of the instance.
 * @param {number|null} instant - The instant (ms).
 * @param {string} [timeZone] - IANA timezone.
 * @returns {string} The day and month, '' when none.
 */
function shortDate(instant, timeZone) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  return new Intl.DateTimeFormat('fr-FR', { timeZone, day: '2-digit', month: '2-digit' }).format(
    new Date(instant),
  );
}

/**
 * @description A date of a message: "21:30" today, "02/11 04:30" another day.
 * @param {number|null} instant - The instant (ms).
 * @param {number} now - Now (ms).
 * @param {string} [timeZone] - IANA timezone.
 * @returns {string} The date, '' when none.
 */
function dateText(instant, now, timeZone) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const time = formatTime(instant, timeZone);
  return localClock(instant, timeZone).date === localClock(now, timeZone).date
    ? time
    : `${shortDate(instant, timeZone)} ${time}`;
}

/**
 * @description The period of a message: "02/11 04:30 → 03/11 02:00",
 * "since 15/07 04:00" when its end is far, with its hours of the day.
 * @param {object} message - The message.
 * @param {number} now - Now (ms).
 * @param {string} [timeZone] - IANA timezone.
 * @param {string} language - The language.
 * @returns {string} The period.
 */
function periodText(message, now, timeZone, language) {
  const start = dateText(message.start, now, timeZone);
  const end = dateText(message.end, now, timeZone);
  // An end months away (works "until further notice") says little.
  const farEnd = !Number.isFinite(message.end) || message.end - now > 60 * 24 * 3600 * 1000;
  let period = '';
  if (start && end && !farEnd) {
    period = t('periodFromTo', language, { start, end });
  } else if (start) {
    period = t('periodFrom', language, { start });
  }
  return [period, message.hours].filter(Boolean).join(', ');
}

/**
 * @description The "traffic" widget.
 * @param {object} options - Options.
 * @param {Array<{ line: object, traffic: object }>} options.lines - The lines and their traffic.
 * @param {number|null} options.readAt - When the traffic was read.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} [options.timeZone] - IANA timezone.
 * @returns {object} The content.
 */
function buildTrafficWidget({ lines, readAt, language, now, timeZone }) {
  const components = [
    { type: 'text', variant: 'heading', text: t('trafficTitle', language) },
    {
      type: 'status',
      items: lines.slice(0, MAX_STATUS_ITEMS).map(({ line, traffic }) => ({
        label: clip(lineLabel(line, language), 40),
        value: clip(lineStateText(traffic.state, language), 40),
        color: STATE_COLORS[traffic.state] ?? WIDGET_COLORS.NEUTRAL,
      })),
    },
  ];
  // One card per message, even when it covers several of the lines; the
  // messages under way, then the coming ones.
  const grouped = new Map();
  for (const { line, traffic } of lines) {
    const label = lineLabel(line, language);
    const listed = [
      ...traffic.messages.map((message) => ({ message, coming: false })),
      ...(traffic.upcoming ?? []).map((message) => ({ message, coming: true })),
    ];
    for (const { message, coming } of listed) {
      const entry = grouped.get(message.id) ?? { message, coming, names: [] };
      if (!entry.names.includes(label)) {
        entry.names.push(label);
      }
      grouped.set(message.id, entry);
    }
  }
  const items = [...grouped.values()].sort(
    (a, b) =>
      Number(a.coming) - Number(b.coming) ||
      rank(b.message.state) - rank(a.message.state) ||
      (a.coming
        ? (a.message.start ?? 0) - (b.message.start ?? 0)
        : (b.message.start ?? 0) - (a.message.start ?? 0)),
  );
  if (items.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: items.slice(0, MAX_LIST_ITEMS).map(({ message, coming, names }) => {
        const item = {
          title: clip(message.title || names.join(', '), 60),
          subtitle: clip(
            [
              coming ? t('upcomingState', language) : t(`kind_${message.state}`, language),
              periodText(message, now, timeZone, language),
            ]
              .filter(Boolean)
              .join(' · '),
            60,
          ),
          badge: {
            text: clip(names.join(' · '), 16),
            color: coming
              ? WIDGET_COLORS.NEUTRAL
              : (STATE_COLORS[message.state] ?? WIDGET_COLORS.NEUTRAL),
          },
        };
        if (message.text) {
          item.description = clip(message.text, 2000);
        }
        if (/^https:\/\//.test(message.url) && message.url.length <= 2048) {
          item.links = [{ url: message.url, label: clip(t('moreInfo', language), 24) }];
        }
        return item;
      }),
    });
  }
  // Two texts at most: without a message, the body carries the update time.
  const updated = readAt ? t('updatedAt', language, { time: formatTime(readAt, timeZone) }) : '';
  if (items.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: [t('noMessage', language), updated && `${updated}.`].filter(Boolean).join(' '),
    });
  } else if (updated) {
    components.push({ type: 'text', variant: 'caption', text: updated });
  }
  return { ttl_seconds: TTL_SECONDS.traffic, components };
}

export {
  WIDGETS,
  TTL_SECONDS,
  BOARD_COUNT,
  STATE_COLORS,
  clip,
  messageContent,
  readCount,
  routeValue,
  shownPassages,
  shortDate,
  dateText,
  periodText,
  buildDeparturesWidget,
  buildTrafficWidget,
};
