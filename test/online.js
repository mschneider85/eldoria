// Online-Partien im Gleichschritt: Host und Gast rechnen dieselbe Partie mit demselben Startwert,
// der Gast spiegelverkehrt. Die Züge kommen auf beiden Seiten in zufälliger Reihenfolge an –
// danach müssen beide Spielstände (gespiegelt) exakt übereinstimmen.
// Aufruf: node test/online.js [anzahl]
'use strict';
require('../js/cards.js');
require('../js/engine.js');
require('../js/ai.js');
const { Engine, AI } = globalThis.CG;

const games = Number(process.argv[2] || 300);

/** Das Wesentliche eines Spielstands aus Sicht des Hosts (beim Gast sind die Spieler vertauscht). */
function view(s, flip) {
  const P = flip ? [1, 0] : [0, 1];
  const m = (i) => (i === null || i < 0 ? i : flip ? 1 - i : i);
  return JSON.stringify({
    round: s.round, terrain: s.terrain.id, stat: s.stat, phase: s.phase, picker: m(s.picker), pot: s.pot,
    winner: s.winner === null ? null : m(s.winner), lastWinner: m(s.lastWinner), retreat: s.retreatUsed,
    players: P.map((p) => { const pl = s.players[p]; return [pl.hand, pl.deck, pl.quartets, pl.rally, pl.rallyCharge, pl.won]; }),
    spy: P.map((p) => s.spyInfo[p]), known: P.map((p) => s.known[p]),
  });
}

let failed = 0;
for (let g = 0; g < games; g++) {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const players = [{ name: 'A', isAI: true }, { name: 'B', isAI: true }];
  const host = Engine.newGame({ mode: 'online', players, seed });
  const guest = Engine.newGame({ mode: 'online', players, seed, flip: true });
  const sides = [[host, false], [guest, true]];
  // Ein Zug von Sitzplatz p (Host-Sicht) wird auf beiden Seiten angewendet – beim Gast als 1 - p.
  const apply = (fn, p, ...args) => sides.map(([s, flip]) => fn(s, flip ? 1 - p : p, ...args));
  try {
    while (host.phase !== 'over') {
      if (view(host, false) !== view(guest, true)) { const a = JSON.parse(view(host, false)), b = JSON.parse(view(guest, true)); throw new Error(`Runde ${host.round}: Spielstände weichen ab: ${Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k} ${JSON.stringify(a[k])} / ${JSON.stringify(b[k])}`).join("; ")}`); }
      if (host.phase === 'stat') apply(Engine.chooseStat, host.picker, AI.chooseStat(host, host.picker));
      // Jeder Sitzplatz entscheidet auf Grundlage des Stands, den er gerade selbst sieht
      // (beim Gast ist er selbst Spieler 0)
      const moves = [0, 1].flatMap((p) => (AI.shouldRally(p === 0 ? host : guest, 0) ? [[Engine.rally, p]] : []).concat([['choose', p]]));
      const pick = [null, null];
      // Reihenfolge pro Seite unterschiedlich mischen, aber die eigenen Züge jedes Spielers bleiben geordnet
      for (const [s, flip] of sides) {
        const queues = [moves.filter((m) => m[1] === 0), moves.filter((m) => m[1] === 1)];
        while (queues[0].length || queues[1].length) {
          const q = !queues[0].length ? 1 : !queues[1].length ? 0 : Math.random() < 0.5 ? 0 : 1;
          const [fn, p] = queues[q].shift();
          const lp = flip ? 1 - p : p;
          if (fn === 'choose') {
            // Wer zuerst dran ist, legt die Karte fest – die andere Seite muss sie dann auch auf der Hand haben
            const hand = s.players[lp].hand;
            const card = pick[p] || (pick[p] = hand[Math.floor(Math.random() * hand.length)]);
            const r = Engine.choose(s, lp, card);
            if (!r.ok) throw new Error(`choose: ${r.error}`);
          } else if (!fn(s, lp).ok) throw new Error('Schlachtruf ungültig');
        }
      }
      if (host.phase === 'result') { Engine.nextRound(host); Engine.nextRound(guest); }
    }
    if (view(host, false) !== view(guest, true)) throw new Error('Endstand weicht ab');
  } catch (e) {
    failed++;
    console.log(`Partie ${g} (Startwert ${seed}): ${e.message}`);
  }
}
console.log(`${games - failed} von ${games} Online-Partien synchron.`);
process.exit(failed ? 1 : 0);
