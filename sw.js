/*
 * Service Worker: Nach dem ersten Besuch startet Eldoria sofort und läuft auch offline (Online-Modus braucht natürlich Netz).
 *
 * Die Version kommt aus index.html (sw.js?v=…, dieselbe Cache-Version wie bei den Skripten). Eine neue Version
 * lädt beim Installieren alles in einen frischen Cache und löscht danach den alten.
 * - Seite (index.html): erst aus dem Netz, damit Updates sofort ankommen; ohne Netz aus dem Cache.
 * - Alles andere: aus dem Cache, sonst aus dem Netz (und dann für später gemerkt).
 */
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `eldoria-${VERSION}`;
const v = (f) => `${f}?v=${VERSION}`;

// Karten und Schlachtfelder kennt cards.js – so muss hier keine Liste gepflegt werden
importScripts(v('js/cards.js'));
const { CARDS, TERRAINS } = self.CG;

const FILES = [
  './',
  'manifest.webmanifest',
  v('css/style.css'),
  ...['cards', 'engine', 'ai', 'net', 'audio', 'art-fx', 'ui', 'ui-duel', 'ui-input', 'ui-online', 'deer', 'vendor/trystero', 'vendor/qrcode'].map((n) => v(`js/${n}.js`)),
  ...['cinzel-latin', 'cinzel-latin-ext', 'alegreya-latin', 'alegreya-latin-ext', 'noto-emoji-subset'].map((n) => `art/fonts/${n}.woff2`),
  ...['arrow', 'hand', 'help', 'zoom', 'zoom-out'].map((n) => `art/cursors/${n}.svg`),
  ...['fog', 'leather', 'metal', 'paper', 'table', 'wood'].map((n) => `art/textures/${n}.webp`),
  ...['icon-192', 'icon-512', 'maskable-512', 'apple-touch-icon'].map((n) => `art/icons/${n}.png`),
  'art/terrains/back.webp', 'art/terrains/back.thumb.webp', 'art/terrains/forest.menu.webp',
  ...Object.keys(CARDS).flatMap((id) => [`art/cards/${id}.webp`, `art/cards/${id}.thumb.webp`]),
  ...TERRAINS.flatMap((t) => [`art/terrains/${t.id}.webp`, `art/terrains/${t.id}.thumb.webp`]),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('eldoria-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Wartezeit aufs Netz, bevor bei schlechtem Empfang die gespeicherte Seite kommt. */
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Auch Einladungslinks (?room=…) landen hier; offline gibt es dann eben die gespeicherte Startseite.
    // Kommt die Seite erst nach dem Zeitlimit, wird sie trotzdem noch gespeichert – sonst bliebe ein Handy mit
    // schlechtem Empfang für immer auf der alten Version (der nächste Start lädt dann die neue).
    const net = fetch(req).then((res) => {
      if (!res.ok) return res;
      const copy = res.clone();
      return caches.open(CACHE).then((c) => c.put('./', copy)).then(() => res, () => res);
    });
    e.waitUntil(net.catch(() => {}));
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, NAV_TIMEOUT_MS); });
    const cached = () => caches.match('./').then((hit) => hit || net);
    e.respondWith(Promise.race([net.then((res) => res, () => cached()), timeout.then(cached)])
      .finally(() => clearTimeout(timer)));
    return;
  }

  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
