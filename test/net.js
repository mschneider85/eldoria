// Raum-Verbindung (js/net.js) mit nachgebautem Trystero: Nach einem Abriss bekommt nur der bisherige Mitspieler
// den Platz zurück (Fremde mit dem Einladungslink dürfen sich nur melden), und ein gescheiterter Wiederbeitritt
// verhindert keine weiteren Versuche.
// Aufruf: node test/net.js
'use strict';
const assert = require('assert');
globalThis.location = { hash: '', href: 'http://x/' };
globalThis.document = { head: { appendChild: (el) => setTimeout(el.onload) }, createElement: () => ({}) };
let rooms = [], failNext = 0;
globalThis.TrysteroLib = {
  joinRoom(cfg, c) {
    if (failNext) { failNext--; throw new Error('relay down'); }
    const act = { sent: [], send(m, o) { act.sent.push([m, o.target]); return Promise.resolve(); } };
    const r = { code: c, act, makeAction: () => act, leave: () => Promise.resolve() };
    rooms.push(r);
    return r;
  },
};
require('../js/net.js');
const Net = globalThis.CG.Net;
const ev = [];
Net.on('open', () => ev.push('open'));
Net.on('message', (m) => ev.push('msg:' + m.t));
Net.on('drop', () => { ev.push('drop'); return true; });
Net.on('close', () => ev.push('close'));
Net.on('stranger', (m, reply) => { ev.push('stranger:' + m.t); reply({ t: 'full' }); });
(async () => {
  await Net.enterRoom('ABC');
  let r = rooms.at(-1);
  r.onPeerJoin('A'); assert.deepEqual(ev, ['open']);
  r.onPeerJoin('B'); r.act.onMessage({ t: 'hello' }, { peerId: 'B' });
  assert.deepEqual(ev, ['open', 'stranger:hello']); assert.deepEqual(r.act.sent.at(-1), [{ t: 'full' }, 'B']);
  r.onPeerLeave('A'); assert.equal(ev.at(-1), 'drop');
  // während des Wartens: Fremder bekommt den Platz nicht
  r.onPeerJoin('B'); assert.equal(ev.filter((e) => e === 'open').length, 1);
  r.act.onMessage({ t: 'resume' }, { peerId: 'B' }); assert.equal(ev.at(-1), 'stranger:resume');
  // Wiederbeitritt scheitert einmal, der nächste klappt mit demselben Code
  failNext = 1; await Net.rejoin(); const n = rooms.length;
  await Net.rejoin(); assert.equal(rooms.length, n + 1); r = rooms.at(-1); assert.equal(r.code, 'ABC');
  r.onPeerJoin('B'); assert.equal(ev.filter((e) => e === 'open').length, 1);
  r.onPeerJoin('A'); assert.equal(ev.filter((e) => e === 'open').length, 2);
  r.act.onMessage({ t: 'ping' }, { peerId: 'A' }); assert.equal(ev.at(-1), 'msg:ping');
  // Nach close() ist alles vergessen: neuer Raum, beliebiger erster Besucher
  Net.close(); await Net.rejoin(); assert.equal(rooms.length, n + 1);
  await Net.enterRoom('XYZ'); rooms.at(-1).onPeerJoin('C'); assert.equal(ev.filter((e) => e === 'open').length, 3);
  console.log('Raum-Verbindung: Platz bleibt beim Mitspieler, Wiederbeitritt klappt.');
})().catch((e) => { console.error(e); process.exit(1); });
