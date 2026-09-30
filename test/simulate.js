// KI-gegen-KI-Partien: prüft Invarianten und zeigt Statistiken fürs Balancing.
// Aufruf: node test/simulate.js [anzahl]
'use strict';
require('../js/cards.js');
require('../js/engine.js');
require('../js/ai.js');
const { Engine, AI, CARDS } = globalThis.CG;

const games = Number(process.argv[2] || 500);

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

function series(diffA, diffB) {
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
}

series('normal', 'normal');
series('normal', 'easy');
series('hard', 'normal');
