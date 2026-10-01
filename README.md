# Eldoria

Ein Fantasy-Quartett im Browser mit taktischem Kniff – gegen den Computer (Leicht/Normal/Schwer)
oder zu zweit online an zwei Geräten.

## Starten

Keine Installation nötig – `index.html` im Browser öffnen, oder:

```bash
python3 -m http.server 8765   # dann http://localhost:8765
```

## Online spielen

Direkt von Browser zu Browser (WebRTC), ohne eigenen Server. Wer „Spiel eröffnen“ wählt, bekommt einen
**Einladungslink**, einen **QR-Code** und einen kurzen **Raumcode** (z. B. `K7M-Q2P`). Der Mitspieler tippt
auf den Link, scannt den QR-Code mit der Handykamera oder gibt den Code unter „Beitreten“ ein – fertig.

Zusammengeführt werden die beiden über öffentliche Nostr-Relays (Bibliothek [Trystero](https://github.com/dmotz/trystero),
lokal in `js/vendor/`). Die Relays sehen nur verschlüsselte Verbindungsdaten, das Spiel selbst läuft direkt
zwischen den Geräten; ein öffentlicher STUN-Server hilft beim Finden der Adressen. Die Seite muss über HTTPS
oder `localhost` laufen (z. B. GitHub Pages). In sehr strengen Netzen (manche Mobilfunkanbieter) kommt keine
Direktverbindung zustande – dann hilft ein WLAN.

Notlösung ohne Relays: „Klappt nicht? Ohne Vermittlung verbinden“ – dann tauschen die Spieler zwei lange Codes
von Hand aus.

Beide Geräte rechnen dieselbe Partie mit demselben Startwert (der Gast spiegelverkehrt), übers Netz gehen
nur die Züge. Beide müssen dieselbe Spielversion geladen haben (geprüft wird die Cache-Version aus `index.html`);
nach jedem Duell vergleichen beide eine Prüfsumme des Spielstands, damit Abweichungen sofort auffallen.
Reißt die Verbindung mitten in der Partie ab (Handy gesperrt, kurz kein Netz), warten beide eine Minute und
suchen sich über den Raum neu; die verpassten Züge werden dann nachgeschickt. Bei den Codes von Hand geht das nicht.
Gedacht ist der Online-Modus für Partien unter Freunden: Beide Geräte kennen den ganzen Spielstand, ein
veränderter Browser könnte also die gegnerische Hand auslesen.
Lässt der Gegner länger als 30 Sekunden auf seinen Zug warten, zeigt ein Zähler das an; nach zwei Minuten
kann man die Partie dort direkt verlassen. Gezogen wird nie für ihn.

## Spielprinzip

- 32 Karten: 8 Völker × 4 Karten (1A–8D), Werte ⚔️ Stärke, 🛡️ Rüstung, ✨ Magie, 💨 Tempo.
- Jeder hat 16 Karten: 3 auf der Hand, der Rest liegt als eigener Nachziehstapel neben dem Spielfeld.
  Nach jeder Runde wird auf 3 aufgefüllt; eroberte Karten kommen unter den Stapel des Siegers (gezogen wird von oben).
- Jede Runde bestimmt ein **Schlachtfeld**, welcher Wert zählt (teils mit Völkerbonus, im Nebelsumpf gewinnt der niedrigste Wert,
  an der Kreuzung und im Kriegsrat entscheidet ein Münzwurf, wer die Eigenschaft wählt).
- Beide wählen **verdeckt** eine Karte; der Sieger erobert beide. Gleichstand → Kriegsbeute für den nächsten Rundensieger.
- Alle 4 Karten eines Volkes = **Quartett** (wird abgelegt und ist sicher). **3 Quartette gewinnen** (nach 40 Runden zählen Quartette, danach Karten).
- Extras: 📯 Schlachtruf: vor der Wahl alle Handkarten in den eigenen Stapel mischen und neu ziehen. Lädt sich in 2 Runden wieder auf, in denen man zurückliegt – das hilft bei der Aufholjagd. Die Drachenkönigin (6A) ist die stärkste Karte – aber mit schwacher Fähigkeit.
- **Fähigkeiten:** Jede Karte hat eine von 12 Fähigkeiten, die beim Aufdecken wirken – z. B. Umlenken (andere Eigenschaft zählt),
  Verrat (niedrigster Wert gewinnt), Rückzug (Karte geht bei Niederlage nicht verloren), Plündern, Spion, Schwächen.
  Starke Karten haben eher schwache Fähigkeiten und umgekehrt – die höchste Karte ist also nicht automatisch richtig.
  Beschreibung: Maus über die Karte oder Rechtsklick für Großansicht.
- Tastatur: `1`–`3` Karte wählen, `H` Schlachtruf, `Enter` ausspielen/weiter, `Z` Karte groß zeigen, `Esc` Fenster schließen;
  mit `Tab` lassen sich die Handkarten ansteuern, `Leertaste` wählt.
- Nach dem Duell geht es nach ein paar Sekunden von selbst weiter (Balken im „Weiter“-Knopf); Maus auf dem Schlachtfeld hält ihn an.
- Rechtsklick (Handy: lange drücken) zeigt eine Karte groß; im Menü gibt es eine Kartengalerie.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/cards.js`  | Völker, Karten und Schlachtfelder (hier lässt sich alles balancen) |
| `js/engine.js` | Regeln und Spielzustand, ohne DOM (läuft auch in Node) |
| `js/net.js`    | Online-Verbindung: Raum über Nostr-Relays (Link, QR, Raumcode) oder Codes von Hand, WebRTC-Datenkanal |
| `js/vendor/`   | Trystero und QR-Code-Generator (MIT, siehe `LIZENZ.md`), werden erst in der Online-Lobby geladen |
| `js/ai.js`     | Computergegner: Siegchance × Wert der Beute gegen Verlustrisiko; „Schwer“ zählt Karten und rechnet mit der wahrscheinlichen Gegnerkarte |
| `js/audio.js`  | Soundeffekte und Hintergrundmusik, live mit der Web-Audio-API erzeugt (keine Audiodateien) |
| `js/ui.js`     | Menü, Rundenablauf, Animationen; `ART_FX` legt die bewegten Bildeffekte je Karte fest (Glut, Funken, Leuchten, Nebel …) |
| `art/src/**/*.svg` | Handgezeichnete SVG-Illustrationen (32 Helden, 14 Schlachtfelder, Kartenrückseite) – die Quellen |
| `art/src/textures/*.webp` | Graue Strukturkarten (Stein, Metall, Stoff, Holz, Haar, Schuppen …, CC0), die beim Bauen über die Illustrationen gelegt werden. In einem SVG markiert man Flächen mit `data-tx="stone"` am Verlauf oder `filter="url(#tx-metal)"` an Form/Gruppe (Varianten `-soft`, `-fine`) – Details in `tools/texturize.py` |
| `art/cards`, `art/terrains` | Daraus erzeugte WebP-Bilder (groß + `.thumb` für kleine Darstellungen), die das Spiel lädt: nach Änderungen an einem SVG `tools/build-art.sh` ausführen |
| `art/cursors/*.svg` | Eigene Mauszeiger (Pfeil, Panzerhandschuh, Lupe, Info) |
| `tools/texturize.py` | Setzt die Material-Texturen in ein SVG ein (von `build-art.sh` und `render-svg.sh` aufgerufen) |
| `tools/emoji-font.py` | Baut die Emoji-Ersatzschrift (`art/fonts/noto-emoji-subset.woff2`) nur mit den Emojis des Spiels – nach neuen Emojis ausführen |
| `tools/render-svg.sh` | Rendert ein SVG per Headless-Chromium als PNG (zum Prüfen von Illustrationen) |
| `test/simulate.js` | KI-gegen-KI-Partien mit Invarianten-Prüfung: `node test/simulate.js 500` |
| `test/online.js` | Online-Partien im Gleichschritt: Host und Gast müssen bei jeder Zugreihenfolge gleich rechnen (inkl. Prüfsumme und ungültiger Züge): `node test/online.js 500` |
| `test/balance.js` | Balance-Analyse (Karten, Fähigkeiten, Schlachtruf, Schwierigkeitsstufen): `node test/balance.js 3000` |
