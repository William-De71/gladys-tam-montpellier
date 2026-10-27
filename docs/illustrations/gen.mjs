// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The two widgets on a real Tuesday evening in Montpellier: the open data of
// the TaM read on 2026-10-27 at 22:44 and kept in test/fixtures (the GTFS of
// Gare Saint-Roch and the trip updates of that minute) go through the real
// code (src/gtfs.js, src/departures.js, src/traffic.js) and the real widget
// builders (src/widgets.js). Added to show what the widgets do: a cancelled
// tram 2, a diversion of line 17 under way, night works on tram 1, and the
// rugby diversion of line 17 (a real alert) moved two days ahead.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildDeparturesWidget, buildTrafficWidget } = await load('src/widgets.js');
const { parseTraffic, lineTraffic } = await load('src/traffic.js');
const { LANGUAGES } = await load('src/i18n.js');
const { NOW, TZ, fixturePassages, rawAlert } = await load('test/helpers/fixtures.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const passages = await fixturePassages('Gare Saint-Roch');
// The second tram 2 towards Jacou cancelled.
const jacou = passages.filter((p) => p.lineId === '2' && p.destination === 'Jacou');
jacou[1].cancelled = true;
const day = 24 * 3600;
const traffic = parseTraffic({
  alerts: [
    rawAlert(),
    rawAlert({
      id: 'night-works',
      routeIds: ['1'],
      header: 'Travaux de nuit',
      description: 'Arrêt Corum : quai provisoire après 22h, rue de la République.',
    }),
    rawAlert({
      id: 'rugby',
      header: '    TR/L17/Dev/ TRL17Dev- 17DEV  2 SENSRUGBY',
      description:
        'Rugby : La ligne 17 est déviée. Les arrêts de G.Danton à Irissou non desservis dans les 2 sens.',
      periods: [{ start: NOW / 1000 + 2 * day - 9 * 3600, end: NOW / 1000 + 2 * day - 3 * 3600 }],
    }),
  ],
});
const LINES = [
  { id: '1', name: '1', mode: 'tram' },
  { id: '2', name: '2', mode: 'tram' },
  { id: '17', name: '17', mode: 'bus' },
  { id: '6', name: '6', mode: 'bus' },
];
const lines = LINES.map((line) => ({ line, traffic: lineTraffic(traffic, line.id, NOW) }));

const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    departures: buildDeparturesWidget({
      title: 'Gare Saint-Roch',
      passages,
      readAt: NOW,
      count: 6,
      language,
      now: NOW,
      timeZone: TZ,
    }),
    traffic: buildTrafficWidget({
      lines,
      readAt: NOW - 2 * 60 * 1000,
      language,
      now: NOW,
      timeZone: TZ,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
