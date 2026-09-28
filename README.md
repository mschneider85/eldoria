# Eldoria-Quartett

Ein Fantasy-Quartett im Browser mit taktischem Kniff – gegen den Computer (Leicht/Normal)
oder zu zweit an einem Gerät (Hot-Seat).

## Starten

Keine Installation nötig – `index.html` im Browser öffnen, oder:

```bash
python3 -m http.server 8765   # dann http://localhost:8765
```

## Spielprinzip

- 32 Karten: 8 Völker × 4 Karten (1A–8D), Werte ⚔️ Stärke, 🛡️ Rüstung, ✨ Magie, 💨 Tempo.
- Jeder hat 16 Karten: 3 auf der Hand, der Rest liegt als eigener Nachziehstapel neben dem Spielfeld.
  Nach jeder Runde wird auf 3 aufgefüllt; eroberte Karten kommen unter den Stapel des Siegers (gezogen wird von oben).
- Jede Runde bestimmt ein **Schlachtfeld**, welcher Wert zählt (teils mit Völkerbonus, im Nebelsumpf gewinnt der niedrigste Wert,
  an der Kreuzung wählt der Anführer).
- Beide wählen **verdeckt** eine Karte; der Sieger erobert beide. Gleichstand → Kriegsbeute für den nächsten Rundensieger.
- Alle 4 Karten eines Volkes = **Quartett** (wird abgelegt und ist sicher). **2 Quartette gewinnen.**
- Extras: 📯 Kriegshorn (+20, lädt sich danach in 4 Runden wieder auf). Die Drachenkönigin (6A) ist die stärkste Karte – aber ohne Sonderregel.
- **Fähigkeiten:** Jede Karte hat eine von 13 Fähigkeiten, die beim Aufdecken wirken – z. B. Umlenken (andere Eigenschaft zählt),
  Verrat (niedrigster Wert gewinnt), Rückzug (Karte geht bei Niederlage nicht verloren), Plündern, Spion, Schwächen.
  Starke Karten haben eher schwache Fähigkeiten und umgekehrt – die höchste Karte ist also nicht automatisch richtig.
  Beschreibung: Maus über die Karte, Rechtsklick für Großansicht, oder in den Spielregeln.
- Tastatur: `1`–`3` Karte wählen, `H` Kriegshorn, `Enter` ausspielen/weiter, `Esc` Fenster schließen.
- Rechtsklick (Handy: lange drücken) zeigt eine Karte groß; im Menü gibt es eine Kartengalerie.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/cards.js`  | Völker, Karten und Schlachtfelder (hier lässt sich alles balancen) |
| `js/engine.js` | Regeln und Spielzustand, ohne DOM (läuft auch in Node) |
| `js/ai.js`     | Computergegner: Siegchance × Wert der Beute gegen Verlustrisiko |
| `js/audio.js`  | Soundeffekte und Hintergrundmusik, live mit der Web-Audio-API erzeugt (keine Audiodateien) |
| `js/ui.js`     | Menü, Rundenablauf, Hot-Seat-Übergaben, Animationen |
| `art/src/**/*.svg` | Handgezeichnete SVG-Illustrationen (32 Helden, 14 Schlachtfelder, Kartenrückseite) – die Quellen |
| `art/cards`, `art/terrains` | Daraus erzeugte WebP-Bilder (groß + `.thumb` für kleine Darstellungen), die das Spiel lädt: nach Änderungen an einem SVG `tools/build-art.sh` ausführen |
| `art/cursors/*.svg` | Eigene Mauszeiger (Pfeil, Panzerhandschuh, Lupe, Info) |
| `tools/render-svg.sh` | Rendert ein SVG per Headless-Chromium als PNG (zum Prüfen von Illustrationen) |
| `test/simulate.js` | KI-gegen-KI-Partien mit Statistik: `node test/simulate.js 500` |

Die frühere Hearthstone-artige Version liegt unter `archive/arena/`.
