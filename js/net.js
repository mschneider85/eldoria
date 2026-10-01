/*
 * Online-Verbindung von Gerät zu Gerät (WebRTC-Datenkanal), ohne eigenen Server. Zwei Wege:
 *  1. Raum (Standard): Beide treten mit demselben Raumcode bei – per Link, QR-Code oder abgetippt.
 *     Zusammengeführt werden sie über öffentliche Nostr-Relays (Bibliothek Trystero, js/vendor/).
 *     Die Relays sehen nur verschlüsselte Verbindungsdaten (Raumcode = Passwort), nie das Spiel.
 *  2. Codes (Notlösung ohne Relays): Die Spieler tauschen zwei lange Codes selbst aus:
 *       Gastgeber: host() → Code A weitergeben … accept(Code B)
 *       Gast:      join(Code A) → Code B zurückschicken
 * Ein öffentlicher STUN-Server hilft in beiden Fällen nur, die eigene Adresse im Internet herauszufinden –
 * das Spiel selbst läuft direkt zwischen den Geräten.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const PREFIX = 'ELDORIA1-';
  const GATHER_MS = 5000; // länger warten wir nicht auf weitere Adressen

  const APP_ID = 'eldoria-quartett';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I – leicht abzutippen
  const CODE_LEN = 8; // 32^8 ≈ 10^12 Codes – auch ein öffentlich geteilter Link lässt sich nicht erraten
  // Spielversion (Cache-Version aus index.html): Beide Geräte müssen dieselbe haben
  const BUILD = (G.document && document.currentScript && new URL(document.currentScript.src).searchParams.get('v')) || 'dev';

  let pc = null;
  let dc = null;
  let room = null; // Trystero-Raum
  let peer = null; // Mitspieler im Raum
  let roomSend = null;
  let opened = false;
  let code = null; // Raumcode, um nach einem Abriss wieder beizutreten
  // Verlassen dauert einen Moment – bis dahin gäbe Trystero beim Beitreten denselben (sterbenden) Raum zurück
  let leaving = Promise.resolve();
  // drop: Mitspieler im Raum weg – true zurückgeben, um auf ihn zu warten (statt close)
  const handlers = { message: () => {}, open: () => {}, close: () => {}, error: () => {}, drop: () => false };

  /* ------------------------------------------------------------ Codes */
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = (str) => {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
  };
  async function pipe(bytes, Stream) {
    const out = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (!G.CompressionStream) return `${PREFIX}J${toB64(raw)}`;
    return `${PREFIX}Z${toB64(await pipe(raw, CompressionStream))}`;
  }
  async function decode(code) {
    const text = String(code).replace(/\s+/g, '');
    const at = text.indexOf(PREFIX);
    if (at < 0) throw new Error('Das ist kein Eldoria-Code.');
    const body = text.slice(at + PREFIX.length);
    try {
      let bytes = fromB64(body.slice(1));
      if (body[0] === 'Z') bytes = await pipe(bytes, DecompressionStream);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error('Der Code ist unvollständig oder beschädigt.');
    }
  }

  /* ------------------------------------------------------------ Verbindung */
  function close() {
    enterRoom.token = null; // ein Beitritt, der noch lädt, läuft danach ins Leere
    const r = room;
    room = peer = roomSend = code = null;
    if (r) leaving = r.leave().catch(() => {});
    const was = pc;
    pc = null;
    if (dc) { dc.onclose = dc.onmessage = dc.onopen = null; try { dc.close(); } catch (e) { /* schon zu */ } }
    dc = null;
    opened = false;
    if (was) try { was.close(); } catch (e) { /* schon zu */ }
  }

  function lost() {
    if (!pc && !room) return;
    const wasOpen = opened;
    close();
    handlers.close(wasOpen);
  }

  function create() {
    close();
    if (!G.RTCPeerConnection) throw new Error('Dieser Browser kann keine Direktverbindungen (WebRTC).');
    pc = new RTCPeerConnection({ iceServers: ICE });
    const me = pc;
    pc.onconnectionstatechange = () => { if (pc === me && pc.connectionState === 'failed') lost(); };
    return pc;
  }

  function bind(channel) {
    dc = channel;
    dc.onopen = () => { opened = true; handlers.open(); };
    dc.onclose = () => lost();
    dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      handlers.message(m);
    };
  }

  /** Wartet, bis alle Adressen gesammelt sind – der Code muss sie enthalten, es gibt ja keinen Server für Nachzügler. */
  function gathered(conn) {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); conn.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (conn.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, GATHER_MS);
      conn.addEventListener('icegatheringstatechange', check);
    });
  }

  /** Gastgeber: erzeugt den Einladungscode. */
  async function host() {
    const conn = create();
    bind(conn.createDataChannel('eldoria', { ordered: true }));
    await conn.setLocalDescription(await conn.createOffer());
    await gathered(conn);
    if (pc !== conn) throw new Error('Abgebrochen.');
    return encode({ k: 'offer', sdp: conn.localDescription.sdp });
  }

  /** Gastgeber: nimmt den Antwortcode des Gasts an – danach baut sich die Verbindung auf. */
  async function accept(code) {
    const m = await decode(code);
    if (m.k !== 'answer') throw new Error(m.k === 'offer' ? 'Das ist dein eigener Einladungscode – du brauchst den Antwortcode.' : 'Unbekannter Code.');
    if (!pc) throw new Error('Keine offene Einladung.');
    await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
  }

  /** Gast: liest den Einladungscode und erzeugt den Antwortcode. */
  async function join(code) {
    const m = await decode(code);
    if (m.k !== 'offer') throw new Error(m.k === 'answer' ? 'Das ist ein Antwortcode – du brauchst den Einladungscode des Gastgebers.' : 'Unbekannter Code.');
    const conn = create();
    conn.ondatachannel = (e) => bind(e.channel);
    await conn.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await gathered(conn);
    if (pc !== conn) throw new Error('Abgebrochen.');
    return encode({ k: 'answer', sdp: conn.localDescription.sdp });
  }

  /* ------------------------------------------------------------ Raum */
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => { delete scripts[src]; reject(new Error('Die Online-Bausteine ließen sich nicht laden. Bist du online?')); };
        document.head.appendChild(el);
      });
    }
    return scripts[src];
  }

  function newCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
    return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }

  /** Raumcode aus einer Eingabe (Leerzeichen, Bindestriche und Kleinschreibung egal), sonst null. */
  function cleanCode(text) {
    const c = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
  }

  const prettyCode = (c) => `${c.slice(0, CODE_LEN / 2)}-${c.slice(CODE_LEN / 2)}`;

  /** Einladungslink: öffnet das Spiel und tritt dem Raum direkt bei. */
  const link = (c) => `${location.origin}${location.pathname}#spiel=${c}`;

  /**
   * Taugt die eigene Adresse für andere Geräte? Nicht bei file://, localhost oder ohne HTTPS –
   * ein anderes Gerät erreicht sie nicht (localhost wäre dort das Gerät selbst), und ohne sichere
   * Verbindung sperren Browser die Verschlüsselung, die der Verbindungsaufbau braucht.
   */
  function linkUsable() {
    if (location.protocol === 'file:' || !G.isSecureContext) return false;
    return !/^(localhost|127\.|\[::1\]$|0\.0\.0\.0$)/.test(location.hostname) && location.hostname !== '::1';
  }

  /** Raumcode aus der Adresse (Einladungslink), sonst null. */
  function codeFromLink() {
    const m = location.hash.match(/spiel=([A-Za-z0-9-]+)/);
    return m ? cleanCode(m[1]) : null;
  }

  /** Dem Raum beitreten; 'open' kommt, sobald der Mitspieler da ist. */
  async function enterRoom(c) {
    close();
    const token = {};
    enterRoom.token = token;
    await loadScript(`js/vendor/trystero.js?v=${BUILD}`);
    await leaving;
    if (enterRoom.token !== token) throw new Error('Abgebrochen.');
    const r = G.TrysteroLib.joinRoom({
      appId: APP_ID, password: c, rtcConfig: { iceServers: ICE },
      relayConfig: { warnOnRelayFailure: false }, // einzelne Relays fallen immer mal aus – es sind genug andere da
    }, c, {
      onJoinError: () => { if (room === r) handlers.error('Die Verbindung zum Mitspieler wurde abgelehnt.'); },
    });
    room = r;
    code = c;
    const act = r.makeAction('m');
    act.onMessage = (data, ctx) => { if (room === r && ctx.peerId === peer) handlers.message(data); };
    roomSend = (m) => act.send(m, { target: peer }).catch(() => {});
    r.onPeerJoin = (id) => {
      // Ein dritter Besucher wird ignoriert; meldet sich der Mitspieler neu an (Abriss nur bei ihm), geht es weiter
      if (room !== r || (peer && peer !== id)) return;
      peer = id;
      opened = true;
      handlers.open();
    };
    r.onPeerLeave = (id) => {
      if (room !== r || id !== peer) return;
      // Mitten in der Partie (Handy gesperrt, kurz kein Netz): im Raum bleiben und auf die Rückkehr warten
      if (handlers.drop()) { peer = null; opened = false; } else lost();
    };
  }

  /**
   * Nach einem Abriss: den Raum frisch betreten, damit beide sich über die Relays neu finden.
   * Die Handler bleiben; 'open' kommt, sobald der Mitspieler wieder da ist.
   */
  async function rejoin() {
    if (!room || peer) return;
    const c = code;
    try { await enterRoom(c); } catch (e) { /* nächster Versuch folgt */ }
  }

  async function qrSVG(text) {
    await loadScript(`js/vendor/qrcode.js?v=${BUILD}`);
    const qr = G.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  /** Schickt eine Nachricht; das Versprechen erfüllt sich, wenn sie unterwegs ist (oder es nicht geht). */
  function send(m) {
    if (roomSend) return peer ? roomSend(m) : Promise.resolve();
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(m));
      const d = dc;
      return new Promise((resolve) => {
        const t0 = Date.now();
        const check = () => (!d.bufferedAmount || d.readyState !== 'open' || Date.now() - t0 > 1000 ? resolve() : setTimeout(check, 30));
        check();
      });
    }
    return Promise.resolve();
  }

  /**
   * Letzte Nachricht (Abschied) und dann trennen – erst, wenn sie unterwegs ist, sonst geht sie beim
   * Schließen verloren. Bis dahin meldet die alte Verbindung nichts mehr; eine inzwischen neue bleibt unberührt.
   */
  function bye(m) {
    const was = { room, dc, pc };
    Object.assign(handlers, { message: () => {}, open: () => {}, close: () => {}, error: () => {}, drop: () => false });
    const sent = Promise.race([send(m), new Promise((resolve) => setTimeout(resolve, 600))]);
    return sent.then(() => { if (room === was.room && dc === was.dc && pc === was.pc) close(); });
  }

  CG.Net = {
    BUILD, host, accept, join, send, bye, close, rejoin,
    newCode, cleanCode, prettyCode, link, linkUsable, codeFromLink, enterRoom, qrSVG,
    get connected() { return opened; },
    on(event, fn) { handlers[event] = fn; },
  };
})(globalThis);
