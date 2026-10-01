// Balance-Analyse: viele KI-gegen-KI-Partien mit ausführlicher Statistik.
// Aufruf: node test/balance.js [anzahl]
'use strict';
require('../js/cards.js');
require('../js/engine.js');
require('../js/ai.js');
const { Engine, AI, CARDS, FACTIONS, ABILITIES, TERRAINS } = globalThis.CG;

const GAMES = Number(process.argv[2] || 3000);
const START_BUCKETS = [-400, -150, 150, 400, Infinity]; // Grenzen für den Vorsprung der Startkarten (Summe aller Werte)
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '–');
const bar = (x) => '█'.repeat(Math.round(x * 20)).padEnd(20, '·');

// ---------------------------------------------------------------- Strategien
// Schlachtruf: klug (KI entscheidet), nie, oder blind, sobald er bereit ist
const rallyWith = (mode) => (s, p) => {
  if (mode === 'always' ? s.players[p].rally && s.players[p].deck.length : mode === 'smart' && AI.shouldRally(s, p)) Engine.rally(s, p);
};
const withRally = (mode, pick) => (s, p) => { rallyWith(mode)(s, p); return pick(s, p); };
const pickSmart = (s, p) => AI.chooseCard(s, p);
const pickGreedy = (s, p) => {
  const v = (id) => (s.terrain.lowWins ? -1 : 1) * CARDS[id].stats[s.stat];
  return { card: s.players[p].hand.reduce((a, b) => (v(b) > v(a) ? b : a)) };
};
const smart = withRally('smart', pickSmart);
const greedy = pickGreedy;
const greedyRally = withRally('always', pickGreedy);
const random = (s, p) => ({ card: s.players[p].hand[Math.floor(Math.random() * s.players[p].hand.length)] });

function play(strategies, hooks = {}) {
  const s = Engine.newGame({ mode: 'pvc', players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  hooks.start && hooks.start(s);
  while (s.phase !== 'over') {
    if (s.phase === 'stat') Engine.chooseStat(s, s.picker, AI.chooseStat(s, s.picker));
    for (const p of [0, 1]) if (s.players[p].rally) hooks.rallyReady && hooks.rallyReady();
    const before = { terrain: s.terrain.id, stat: s.stat, picker: s.picker, owned: [0, 1].map((p) => Engine.owned(s, p).length), quartets: s.players.map((pl) => pl.quartets.length) };
    for (const p of [0, 1]) {
      const ready = s.players[p].rally;
      const c = strategies[p](s, p);
      if (ready && !s.players[p].rally) hooks.rallied && hooks.rallied(s, p);
      Engine.choose(s, p, c.card);
    }
    hooks.round && hooks.round(s, before);
    if (s.phase === 'result') Engine.nextRound(s);
  }
  hooks.end && hooks.end(s);
  return s;
}

// ---------------------------------------------------------------- Datensammlung (Normal gegen Normal)
const st = {
  wins: [0, 0, 0], picker: { duels: 0, won: 0 }, rounds: [], reasons: {},
  card: {}, ability: {}, terrainFaction: {}, faction: {}, rally: { used: 0, won: 0, ready: 0, pending: [false, false] },
  startSets: {}, comeback: { behind: 0, behindWon: 0 }, quartetFaction: {},
};
for (const id of Object.keys(CARDS)) st.card[id] = { played: 0, won: 0, startOwnerWins: 0, startOwned: 0 };
for (const f of Object.keys(FACTIONS)) st.quartetFaction[f] = 0;

for (let g = 0; g < GAMES; g++) {
  let startOwn;
  let snapshot8 = null;
  const s = play([smart, smart], {
    rallyReady() { st.rally.ready++; },
    rallied(s, p) { st.rally.used++; st.rally.pending[p] = true; },
    start(s) {
      startOwn = [0, 1].map((p) => Engine.owned(s, p).slice());
    },
    round(s, before) {
      const r = s.result;
      if (before.picker !== null) { st.picker.duels++; if (r.winner === before.picker) st.picker.won++; }
      r.ids.forEach((id, p) => {
        const c = st.card[id];
        c.played++;
        if (r.winner === p) c.won++;
        const a = CARDS[id].ability || '–';
        st.ability[a] = st.ability[a] || { played: 0, won: 0 };
        st.ability[a].played++;
        if (r.winner === p) st.ability[a].won++;
        const f = CARDS[id].faction;
        const key = `${before.terrain}|${f}`;
        st.terrainFaction[key] = st.terrainFaction[key] || { played: 0, won: 0 };
        st.terrainFaction[key].played++;
        if (r.winner === p) st.terrainFaction[key].won++;
        if (st.rally.pending[p]) {
          st.rally.pending[p] = false;
          if (r.winner === p) st.rally.won++;
        }
      });
      r.quartets.forEach((qs) => qs.forEach((f) => st.quartetFaction[f]++));
      if (s.round === 8 && !snapshot8) snapshot8 = s.players.map((pl, p) => pl.quartets.length * 4 + Engine.owned(s, p).length);
    },
  });
  st.wins[s.winner === -1 ? 2 : s.winner]++;
  st.rounds.push(s.round);
  st.reasons[s.endReason.replace(/^(A|B) /, '')] = (st.reasons[s.endReason.replace(/^(A|B) /, '')] || 0) + 1;
  // Startglück: Wie viel stärker waren die eigenen 16 Karten (Summe aller Werte) als die des Gegners?
  // (Fast fertige Völker taugen dafür nicht: Wer 3 von 4 hat, lässt dem Gegner 1 – beide haben stets gleich viele.)
  const sum = (ids) => ids.reduce((n, id) => n + Object.values(CARDS[id].stats).reduce((a, b) => a + b, 0), 0);
  for (const p of [0, 1]) {
    const diff = sum(startOwn[p]) - sum(startOwn[1 - p]);
    const k = START_BUCKETS.findIndex((b) => diff < b);
    st.startSets[k] = st.startSets[k] || { games: 0, won: 0 };
    st.startSets[k].games++;
    if (s.winner === p) st.startSets[k].won++;
    startOwn[p].forEach((id) => { st.card[id].startOwned++; if (s.winner === p) st.card[id].startOwnerWins++; });
  }
  if (snapshot8 && snapshot8[0] !== snapshot8[1] && s.winner !== -1) {
    const behind = snapshot8[0] < snapshot8[1] ? 0 : 1;
    st.comeback.behind++;
    if (s.winner === behind) st.comeback.behindWon++;
  }
}

// ---------------------------------------------------------------- Strategievergleiche
function duelOf(a, b, n) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const swap = i % 2; // Seiten abwechseln
    const s = play(swap ? [b, a] : [a, b]);
    if (s.winner === (swap ? 1 : 0)) w++;
  }
  return w / n;
}
function levels(a, b, n) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const s = Engine.newGame({ mode: 'pvc', players: [{ name: 'A', isAI: true, difficulty: a }, { name: 'B', isAI: true, difficulty: b }] });
    while (s.phase !== 'over') {
      if (s.phase === 'stat') Engine.chooseStat(s, s.picker, AI.chooseStat(s, s.picker));
      for (const p of [0, 1]) { if (AI.shouldRally(s, p)) Engine.rally(s, p); Engine.choose(s, p, AI.chooseCard(s, p).card); }
      if (s.phase === 'result') Engine.nextRound(s);
    }
    if (s.winner === 0) w++;
  }
  return w / n;
}

// ---------------------------------------------------------------- Ausgabe
const line = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`);
const avg = st.rounds.reduce((a, b) => a + b, 0) / st.rounds.length;
const sorted = st.rounds.slice().sort((a, b) => a - b);

line(`Grunddaten (${GAMES} Partien, Normal gegen Normal)`);
console.log(`Spieler A ${pct(st.wins[0], GAMES)} · Spieler B ${pct(st.wins[1], GAMES)} · Remis ${pct(st.wins[2], GAMES)}`);
console.log(`Wahlfeld: Wer die Eigenschaft wählt, gewinnt das Duell: ${pct(st.picker.won, st.picker.duels)}`);
console.log(`Runden: Ø ${avg.toFixed(1)}, Median ${sorted[Math.floor(sorted.length / 2)]}, 10–90 %: ${sorted[Math.floor(sorted.length * 0.1)]}–${sorted[Math.floor(sorted.length * 0.9)]}`);
Object.entries(st.reasons).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  Ende: ${r.padEnd(34)} ${pct(n, GAMES)}`));

line('Startglück: Wertesumme der eigenen Startkarten gegenüber dem Gegner');
const bucketName = (k) => (k === 0 ? `unter ${START_BUCKETS[0]}` : k === START_BUCKETS.length - 1 ? `über +${START_BUCKETS[k - 1]}` : `${START_BUCKETS[k - 1]} bis ${START_BUCKETS[k]}`);
Object.keys(st.startSets).map(Number).sort((a, b) => a - b).forEach((k) => {
  const v = st.startSets[k];
  console.log(`  ${bucketName(k).padEnd(14)} ${pct(v.won, v.games).padStart(4)} Siege  (${v.games} Fälle)`);
});

line('Aufholjagd');
console.log(`Wer nach Runde 8 zurückliegt, gewinnt noch: ${pct(st.comeback.behindWon, st.comeback.behind)} (${st.comeback.behind} Partien)`);

line('Strategien');
console.log(`Überlegte KI gegen „immer höchste Karte“: ${pct(duelOf(smart, greedy, 800) * 800, 800)}`);
console.log(`Überlegte KI gegen „höchste Karte + Ruf“: ${pct(duelOf(smart, greedyRally, 800) * 800, 800)}`);
console.log(`Schlachtruf klug gegen nie:               ${pct(duelOf(smart, pickSmart, 800) * 800, 800)}`);
console.log(`Schlachtruf klug gegen blind (sofort):    ${pct(duelOf(smart, withRally('always', pickSmart), 800) * 800, 800)}`);
console.log(`„Immer höchste Karte“ gegen Zufall:       ${pct(duelOf(greedy, random, 800) * 800, 800)}`);
console.log(`Leichter Computer gegen normalen:         ${pct(levels('easy', 'normal', 800) * 800, 800)}`);
console.log(`Schwerer Computer gegen normalen:         ${pct(levels('hard', 'normal', 400) * 400, 400)}`);

line('Völker: Duell-Siegquote und abgelegte Quartette');
for (const [f, fac] of Object.entries(FACTIONS)) {
  const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === Number(f));
  const played = ids.reduce((a, id) => a + st.card[id].played, 0);
  const won = ids.reduce((a, id) => a + st.card[id].won, 0);
  const sum = ids.reduce((a, id) => a + Object.values(CARDS[id].stats).reduce((x, y) => x + y, 0), 0);
  console.log(`  ${fac.name.padEnd(11)} ${bar(won / played)} ${pct(won, played).padStart(4)}  Quartette ${String(st.quartetFaction[f]).padStart(5)}  Wertesumme ${sum}`);
}

line('Karten: Duell-Siegquote (gespielt) – Ausreißer');
const cards = Object.entries(st.card).map(([id, c]) => ({ id, rate: c.won / c.played, played: c.played }));
cards.sort((a, b) => b.rate - a.rate);
console.log('  stärkste: ' + cards.slice(0, 6).map((c) => `${c.id} ${CARDS[c.id].name} ${pct(c.rate * 100, 100)}`).join(' · '));
console.log('  schwächste: ' + cards.slice(-6).map((c) => `${c.id} ${CARDS[c.id].name} ${pct(c.rate * 100, 100)}`).join(' · '));
const spread = cards.map((c) => c.rate);
console.log(`  Spanne: ${pct(Math.min(...spread) * 100, 100)} – ${pct(Math.max(...spread) * 100, 100)}`);

line('Karten: Einfluss auf den Partiesieg (Besitz zu Spielbeginn)');
const own = Object.entries(st.card).map(([id, c]) => ({ id, rate: c.startOwnerWins / c.startOwned }));
own.sort((a, b) => b.rate - a.rate);
console.log('  am wertvollsten: ' + own.slice(0, 5).map((c) => `${c.id} ${pct(c.rate * 100, 100)}`).join(' · '));
console.log('  am wenigsten:    ' + own.slice(-5).map((c) => `${c.id} ${pct(c.rate * 100, 100)}`).join(' · '));
console.log(`  Spanne: ${pct(own[own.length - 1].rate * 100, 100)} – ${pct(own[0].rate * 100, 100)}`);

line('Fähigkeiten: Duell-Siegquote');
Object.entries(st.ability).sort((a, b) => b[1].won / b[1].played - a[1].won / a[1].played).forEach(([a, v]) => {
  console.log(`  ${(ABILITIES[a] ? ABILITIES[a].name : a).padEnd(14)} ${bar(v.won / v.played)} ${pct(v.won, v.played).padStart(4)}`);
});

line('Schlachtruf');
console.log(`Ausgestoßen: ${(st.rally.used / GAMES / 2).toFixed(1)}× pro Spieler und Partie, in ${pct(st.rally.used, st.rally.ready)} der Runden, in denen er bereit war`);
console.log(`Duelle direkt nach dem Schlachtruf gewonnen: ${pct(st.rally.won, st.rally.used)}`);

line('Schlachtfelder mit Völkerbonus: Siegquote des begünstigten Volkes');
for (const t of TERRAINS.filter((t) => t.bonus)) {
  for (const f of Object.keys(t.bonus)) {
    const here = st.terrainFaction[`${t.id}|${f}`] || { played: 0, won: 0 };
    let elsewhere = { played: 0, won: 0 };
    for (const t2 of TERRAINS) {
      if (t2.id === t.id) continue;
      const v = st.terrainFaction[`${t2.id}|${f}`];
      if (v) { elsewhere.played += v.played; elsewhere.won += v.won; }
    }
    console.log(`  ${t.name.padEnd(20)} ${FACTIONS[f].name.padEnd(11)} dort ${pct(here.won, here.played).padStart(4)} · sonst ${pct(elsewhere.won, elsewhere.played).padStart(4)}`);
  }
}
