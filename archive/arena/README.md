# Chroniken von Eldoria

Ein einfaches Fantasy-Sammelkartenspiel im Browser, inspiriert von Warcraft/Hearthstone.
Spielbar gegen den Computer (Leicht/Normal) oder zu zweit an einem Gerät (Hot-Seat).

## Starten

Keine Installation nötig – `index.html` im Browser öffnen, oder:

```bash
python3 -m http.server 8765   # dann http://localhost:8765
```

## Spielprinzip

- 30 Leben, bis zu 10 Manakristalle (+1 pro Zug), 30-Karten-Deck, max. 7 Diener, max. 10 Handkarten.
- 6 Helden mit eigener Heldenfähigkeit (2 Mana) und 4 Klassenkarten; dazu 16 neutrale Karten.
- Schlüsselwörter: Spott, Ansturm, Gottesschild, Windzorn, Kampfschrei, Todesröcheln, Einfrieren.
- Bedienung: Karte anklicken → ggf. Ziel anklicken. Diener anklicken → Angriffsziel anklicken. Rechtsklick/Esc bricht ab.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/cards.js`  | Helden und Karten (Daten + Effekte) – hier neue Karten ergänzen |
| `js/engine.js` | Regeln und Spielzustand, ohne DOM (läuft auch in Node) |
| `js/ai.js`     | Computergegner: simuliert jede legale Aktion und wählt die beste |
| `js/ui.js`     | Menü, Rendering, Eingabe, Animationen |
| `test/simulate.js` | KI-gegen-KI-Partien zum Testen und Balancen: `node test/simulate.js 500` |
