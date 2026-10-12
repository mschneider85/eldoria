// KI-gegen-KI-Partien: prüft Invarianten und zeigt Statistiken fürs Balancing.
// Bricht mit Fehler ab, wenn eine Invariante verletzt ist oder die Spielstärke der Stufen aus dem Rahmen fällt.
// Die drei Vergleiche laufen parallel in eigenen Prozessen. Jeder nimmt einen festen Startwert für Math.random
// (wird ausgegeben), damit sich eine fehlgeschlagene Serie nachspielen lässt.
// Aufruf: node test/simulate.js [anzahl] [--seed=N]   (nur eine Serie: --series=0|1|2)
'use strict';
const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a && a.slice(name.length + 3); };
const seed = opt('seed') !== undefined ? Number(opt('seed')) >>> 0 : (Math.random() * 2 ** 32) >>> 0;

/** mulberry32 – derselbe Startwert ergibt dieselben Partien (auch Engine.newGame zieht seinen Startwert hieraus). */
function seeded(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(seed);

require('../js/cards.js');
require('../js/engine.js');
require('../js/ai.js');
const { Engine, AI, CARDS } = globalThis.CG;

const games = Number(args.find((a) => !a.startsWith('--')) || 400);

function play(diffA, diffB) {
  const s = Engine.newGame({ mode: 'pvc', players: [{ name: 'A', isAI: true, difficulty: diffA }, { name: 'B', isAI: true, difficulty: diffB }] });
  for (let guard = 0; s.phase !== 'over'; guard++) {
    if (guard > 200) throw new Error('Partie endet nicht');
    if (s.phase === 'stat') {
      if (!Engine.chooseStat(s, s.picker, AI.chooseStat(s, s.picker)).ok) throw new Error('Statwahl ungültig');
    }
    for (const p of [0, 1]) {
      if (AI.shouldRally(s, p) && !Engine.rally(s, p).ok) throw new Error('Schlachtruf ungültig');
      if (s.players[p].hand.length !== Math.min(Engine.HAND_SIZE, s.players[p].hand.length + s.players[p].deck.length)) throw new Error('Hand unvollständig');
      const c = AI.chooseCard(s, p);
      const r = Engine.choose(s, p, c.card);
      if (!r.ok) throw new Error('Kartenwahl ungültig: ' + r.error);
    }
    const total = [0, 1].reduce((n, p) => n + Engine.owned(s, p).length + s.players[p].quartets.length * 4, 0) + s.pot.length;
    if (total !== Object.keys(CARDS).length) throw new Error('Kartenzahl stimmt nicht: ' + total);
    if (s.phase === 'result') Engine.nextRound(s);
  }
  return s;
}

/*
 * Erwartete Spielstärke: Anteil der Siege von A an den entschiedenen Partien, dazu höchstens so viele Partien bis zum
 * Rundenlimit. Geprüft wird mit 3 Standardfehlern Spielraum – bei 400 Partien etwa ±7,5 Prozentpunkte –,
 * damit nur echte Ausreißer anschlagen (z. B. eine Karte, die nach dem Balancen alles schlägt).
 */
const EXPECT = [
  { a: 'normal', b: 'normal', win: [0.5, 0.5], limit: 0.1 }, // gleich stark, Sitzplatz egal
  { a: 'normal', b: 'easy', win: [0.78, 1], limit: 0.1 },    // gemessen ~81 %
  { a: 'hard', b: 'normal', win: [0.74, 1], limit: 0.25 },   // gemessen ~78 %, Schwer zieht Partien in die Länge
];

let failed = 0;
function series({ a: diffA, b: diffB, win, limit }) {
  const stats = { wins: [0, 0, 0], rounds: 0, reasons: {}, quartets: 0 };
  for (let g = 0; g < games; g++) {
    const s = play(diffA, diffB);
    stats.wins[s.winner === -1 ? 2 : s.winner]++;
    stats.rounds += s.round;
    stats.reasons[s.endReason] = (stats.reasons[s.endReason] || 0) + 1;
    stats.quartets += s.players[0].quartets.length + s.players[1].quartets.length;
  }
  console.log(`${diffA} vs ${diffB}: A ${stats.wins[0]} / B ${stats.wins[1]} / Remis ${stats.wins[2]}, Ø ${(stats.rounds / games).toFixed(1)} Runden, Ø ${(stats.quartets / games).toFixed(1)} Quartette`);
  for (const [r, n] of Object.entries(stats.reasons)) console.log(`    ${r}: ${((100 * n) / games).toFixed(0)}%`);
  const decided = stats.wins[0] + stats.wins[1];
  const share = stats.wins[0] / decided;
  const slack = 3 * Math.sqrt(0.25 / decided);
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
  if (share < win[0] - slack || share > win[1] + slack) {
    failed++;
    console.log(`  ✗ A gewinnt ${pct(share)}, erwartet ${pct(Math.max(0, win[0] - slack))}–${pct(Math.min(1, win[1] + slack))}`);
  }
  const atLimit = (stats.reasons['Rundenlimit erreicht'] || 0) / games;
  if (atLimit > limit + slack) {
    failed++;
    console.log(`  ✗ ${pct(atLimit)} der Partien bis zum Rundenlimit, erwartet höchstens ${pct(limit + slack)}`);
  }
}

if (opt('series') !== undefined) {
  // Kindprozess: eine Serie spielen
  try {
    series(EXPECT[Number(opt('series'))]);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${e.message}`);
  }
  if (failed) console.log(`  Nachspielen: node test/simulate.js ${games} --seed=${seed} --series=${opt('series')}`);
  process.exit(failed ? 1 : 0);
} else {
  // Alle Serien parallel, Ausgabe in fester Reihenfolge; jede bekommt ihren eigenen Startwert
  const { execFile } = require('child_process');
  const runs = EXPECT.map((_, i) => new Promise((resolve) => {
    execFile(process.execPath, [__filename, String(games), `--seed=${(seed + i) >>> 0}`, `--series=${i}`], (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout + stderr });
    });
  }));
  Promise.all(runs).then((results) => {
    for (const r of results) process.stdout.write(r.out);
    const bad = results.filter((r) => !r.ok).length;
    if (bad) console.log(`${bad} Serie${bad === 1 ? '' : 'n'} fehlgeschlagen.`);
    process.exit(bad ? 1 : 0);
  });
}
