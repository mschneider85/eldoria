# Fremdbibliotheken

| Datei | Bibliothek | Quelle | Lizenz |
|---|---|---|---|
| `trystero.js` | Trystero 0.25.4 (Nostr-Vermittlung, mit noble-secp256k1) | https://github.com/dmotz/trystero | MIT |
| `qrcode.js` | QR Code Generator 2.0.4 (Kazuhiko Arase) | https://github.com/kazuhikoarase/qrcode-generator | MIT |

Beide werden erst geladen, wenn jemand die Online-Lobby öffnet. `trystero.js` ist mit esbuild gebündelt
(`export { joinRoom, selfId } from 'trystero'`, Format IIFE, globaler Name `TrysteroLib`).
„QR Code“ ist eine eingetragene Marke der DENSO WAVE INCORPORATED.
