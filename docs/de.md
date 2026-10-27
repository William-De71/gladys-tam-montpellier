# TaM Montpellier

## Überblick

Diese Integration bringt die **TaM**, die Trams und Busse von Montpellier Méditerranée Métropole, in Gladys. Sie liefert die **nächsten Abfahrten, in Echtzeit korrigiert, mit ihrer Verspätung**, an den Haltestellen deiner Wahl (drei im Formular, bis zu 10 weitere per Schaltfläche), gefiltert nach Linie und Richtung. Sie verfolgt außerdem die **Verkehrslage** von bis zu sechs Linien (normal, Verkehrsinformation, gestört, stark gestört) mit den Meldungen der TaM: Umleitungen, nicht bediente Haltestellen, Bauarbeiten. Jede Haltestelle und jede Linie wird zu einem Gerät für das Dashboard und für Szenen.

Die Daten stammen aus den **offiziellen Open Data der TaM**, veröffentlicht auf `transport.data.gouv.fr` unter der ODbL-Lizenz: kein Konto, kein Schlüssel. Sie umfassen die städtischen und vorstädtischen Linien. Der **Fahrplan** (GTFS) wird einmal am Tag heruntergeladen, wenn er sich geändert hat, und von der Integration aufbewahrt. Die **Echtzeit** (GTFS-RT) des ganzen Netzes wird in **einer einzigen Anfrage für alle verfolgten Haltestellen** gelesen, standardmäßig jede Minute (alle 10 Minuten, solange keine Haltestelle in der nächsten halben Stunde etwas ankündigt, nachts). Die Meldungen werden alle 5 Minuten gelesen.

Eine Abfahrt wird **in Echtzeit verfolgt**, sobald das Fahrzeug seine Endhaltestelle verlassen hat: Ihre geschätzte Zeit und ihre Verspätung werden angegeben. Vorher ist es der **Fahrplan**, gekennzeichnet mit „(Fahrplan)“. **Ausgefallene Fahrten** und **nicht bediente Haltestellen** werden angezeigt.

Dies ist eine **Cloud**-Integration: Sie kontaktiert `gtfsproxy.e-tam.fr`. Sonst verlässt nichts dein Netzwerk.

## Voraussetzungen

- Gladys Assistant 5.3.0 oder neuer.
- Sonst nichts: Die Open Data der TaM brauchen weder Konto noch Schlüssel.

## Konfiguration

| Feld                | Was einzugeben ist                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Haltestelle 1, 2, 3 | Der Name der Haltestelle, wie er dort steht („Comédie“, „Gare Saint-Roch“), oder der Code eines Bahnsteigs („41115“).     |
| Linie               | Nur diese Linie: „1“, „6“, „Amigo“. Leer: alle Linien der Haltestelle.                                                    |
| Richtung            | Nur die Ziele mit diesen Wörtern: „Gare Sud“, „Jacou \| Sabines“. Leer: beide Richtungen.                                 |
| Verfolgte Linien    | Die Linien, deren Verkehrslage du verfolgst, höchstens sechs: „1, 2, 6, 17“.                                              |
| Lesen der Echtzeit  | Alle 30 Sekunden, jede Minute, alle 2 Minuten oder alle 5 Minuten.                                                        |
| Sprache der Texte   | Namen der Geräte, Zusammenfassungen und Ausgaben der Szenen. Haltestellennamen und Verkehrsmeldungen bleiben Französisch. |

Eine Haltestelle vereint alle Bahnsteige ihres Namens, Trams und Busse: „Comédie“ liefert beide Richtungen der Trams 1, 2 und 3. Die Schaltfläche **Haltestelle suchen** liefert die Haltestellen mit einigen Wörtern, mit den Codes ihrer Bahnsteige und ihren Linien („Gare Saint-Roch [41135, 41221] → 1, 2, 3“). Ein paar Wörter genügen, wenn nur eine Haltestelle sie enthält („rondel“ → Rondelet). **Verbindung testen** fragt den Fahrplan erneut ab und liest sofort jede Haltestelle und jede Linie.

Eine Linie schreibt man wie auf dem Fahrzeug: „1“ bis „5“ für die Trams, „6“, „17“, „A“, „Amigo“…

Mehr Haltestellen als die drei des Formulars (Zuhause, Arbeit, Schule…): **Haltestelle hinzufügen** nimmt dieselben drei Felder — Haltestelle, Linie, Richtung — und verfolgt bis zu 10 weitere Haltestellen. **Haltestellen auflisten** zeigt alle verfolgten Haltestellen nummeriert; **Haltestelle entfernen** nimmt diese Nummer (oder den Namen). Die hinzugefügten Haltestellen werden in der Konfiguration von Gladys gespeichert und sind damit in deren Sicherungen enthalten.

## Verwendung

### Geräte

Erstelle im Tab **Entdecken** die gewünschten Geräte:

- **TaM \<Haltestelle\>**: die nächste Abfahrt als Text („1 → Gare Sud France · 3 Min. (+2 Min. Verspätung)“), die Wartezeit der nächsten und der folgenden Abfahrt (Minuten) und die Verspätung der nächsten (Minuten, nur veröffentlicht, wenn sie in Echtzeit verfolgt wird);
- **TaM Straßenbahn 1**, **TaM Linie 17**…: die Verkehrslage als Text („Gestörter Betrieb: Rugby : La ligne 17 est déviée.“) und die Zahl der laufenden Verkehrsmeldungen.

Nachts, ohne Abfahrt in den nächsten drei Stunden, zeigt das Gerät die erste Abfahrt am Morgen.

### Verkehrslage

Die TaM veröffentlicht **Meldungen**: einen Text, die betroffenen Linien (oder Haltestellen) und ihre Zeiträume. Der Zustand einer Linie ergibt sich aus ihrer schwersten laufenden Meldung: **stark gestört** bei einer Unterbrechung, **gestört** bei einer Umleitung, nicht bedienten Haltestellen oder Verspätungen, sonst **Verkehrsinformation**; **normal** ohne Meldung. Eine Meldung, die in den nächsten drei Tagen beginnt, wird als „Demnächst“ angezeigt.

### Dashboard-Widgets

![Das Widget TaM Abfahrten an Gare Saint-Roch und das Widget TaM Verkehrslage der Trams und einiger Buslinien (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-tam-montpellier/main/docs/assets/widgets.de.png)

- **TaM Abfahrten**: die nächsten Abfahrten einer Haltestelle, kompakt. Eine Zeile pro Linie und Ziel, mit ihren nächsten Abfahrten hintereinander („2 · 17 Min.“). Eine ausgefallene Fahrt wird angezeigt („entfällt 22:48“) und färbt die Zeile orange, wie eine Verspätung ab 5 Minuten. Die Einstellung **Angezeigte Fahrten** legt die Zahl der Zeilen fest. Wähle eine verfolgte Haltestelle oder gib in den Widget-Einstellungen eine beliebige Haltestelle (und eine Linie) ein. Mit **Mehrere Haltestellen** zeigt ein Widget mehrere Haltestellengeräte: Die Geräte einer Haltestelle werden unter ihrem Namen zusammengefasst; bei verschiedenen Haltestellen beginnt jede mit einer eigenen Zeile.
- **TaM Verkehrslage**: der Zustand jeder Linie, dann die laufenden Meldungen und die der nächsten drei Tage, mit ihrem Zeitraum. Tippe auf eine Karte für den vollständigen Text. Die verfolgten Linien, die in den Einstellungen eingegebenen oder die fünf Tramlinien, wenn du keine verfolgst.

### Szenen

Auslöser, einmal pro Änderung (die erste Lesung dient nur als Referenz):

- **TaM: Abfahrt bald**: Eine Abfahrt an einer verfolgten Haltestelle fährt in 2, 3, 5, 10, 15 oder 20 Minuten ab, gerechnet nach ihrer Echtzeitschätzung.
- **TaM: Abfahrt entfällt**: Eine Fahrt der nächsten Stunde an einer verfolgten Haltestelle fällt aus oder bedient die Haltestelle nicht.
- **TaM: Linie gestört**: Eine verfolgte Linie wird gestört oder stark gestört.
- **TaM: wieder normal**: Auf der Linie gibt es keine laufende Störung mehr.
- **TaM: neue Verkehrsmeldung**: Die TaM veröffentlicht eine Meldung zu einer verfolgten Linie, aktuell oder demnächst.

Jeder liefert einen fertigen Satz, `{{triggerEvent.data.summary}}`, und seine Werte (Linie, Ziel, Uhrzeit, Verspätung, Titel, Text, Beginn und Ende…). Die Aktionen **TaM: nächste Abfahrten** und **TaM: Verkehrslage einer Linie** liefern dieselbe Art von Werten, für eine Nachricht oder eine Bedingung.

Beispiele:

- Wenn die Tram 1 Richtung Gare Sud France in 5 Minuten an Comédie abfährt → die Lampe im Flur grün schalten.
- Wenn eine Abfahrt deiner Haltestelle entfällt oder die Linie 17 umgeleitet wird → die Zusammenfassung vor dem Losgehen aufs Handy schicken.
- Jeden Werktag um 7:30 → die nächsten Abfahrten deiner Haltestelle lesen und vom Küchenlautsprecher ansagen lassen.

### Transport

Nur Cloud: Die Daten kommen aus dem Internet. Der Fahrplan einmal am Tag, die Echtzeit des ganzen Netzes in einer Anfrage, die Meldungen alle 5 Minuten.

## Fehlerbehebung

- **„Unbekannt oder mehrdeutig“**: Nutze **Haltestelle suchen** und kopiere dann den genauen Namen oder einen Bahnsteigcode; für eine Linie ihren Namen wie auf dem Fahrzeug („1“, „17“, „Amigo“).
- **„(Fahrplan)“ nach einer Abfahrt**: Das Fahrzeug hat seine Endhaltestelle noch nicht verlassen, oder die TaM verfolgt es nicht; die Zeit ist die des Fahrplans.
- **Keine Abfahrt in der eingegebenen Richtung**: Die Ziele sind die auf den Fahrzeugen („Gare Sud France“, „Occitanie“); leere die Richtung, um alle zu sehen.
- **„Die Open Data der TaM antworten nicht“**: Die Integration versucht es bei jeder Lesung erneut; bis dahin kommen die Abfahrten aus dem gespeicherten Fahrplan.
- **Ein Problem melden**: Drücke **Diagnose** und kopiere dann die Zeilen, die mit „TaM diagnostic“ beginnen, aus dem Tab Protokolle in ein GitHub-Issue oder eine Antwort im Forum, mit den Versionen von Gladys und der Integration.
