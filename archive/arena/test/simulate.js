// Lässt viele KI-gegen-KI-Partien laufen und prüft Invarianten.
// Aufruf: node test/simulate.js [anzahl]
'use strict';
require('../js/cards.js');
require('../js/engine.js');
require('../js/ai.js');
const { Engine, AI, CLASSES } = globalThis.CG;

const games = Number(process.argv[2] || 200);
const classes = Object.keys(CLASSES);
const wins = Object.fromEntries(classes.map((c) => [c, { w: 0, g: 0 }]));
let totalTurns = 0;

function check(s) {
  for (const pl of s.players) {
    if (pl.hand.length > Engine.MAX_HAND) throw new Error('Hand zu groß');
    if (pl.board.length > Engine.MAX_BOARD) throw new Error('Brett zu voll');
    if (pl.mana < 0 || pl.mana > 10) throw new Error('Mana ungültig: ' + pl.mana);
    if (pl.board.some((m) => m.health <= 0)) throw new Error('Toter Diener auf dem Brett');
  }
}

for (let g = 0; g < games; g++) {
  const a = classes[g % classes.length];
  const b = classes[Math.floor(g / classes.length) % classes.length];
  const s = Engine.newGame({
    mode: 'pvc',
    players: [
      { name: 'A', classId: a, isAI: true, difficulty: g % 3 ? 'normal' : 'easy' },
      { name: 'B', classId: b, isAI: true },
    ],
  });
  let steps = 0;
  while (s.winner === null) {
    if (++steps > 5000) throw new Error('Partie endet nicht');
    const action = AI.decide(s, s.current);
    const res = Engine.apply(s, action);
    if (!res.ok) throw new Error('KI wählte ungültige Aktion: ' + JSON.stringify(action) + ' ' + res.error);
    s.events = [];
    check(s);
    if (s.turn > 200) throw new Error('Zu viele Züge');
  }
  totalTurns += s.turn;
  wins[a].g++; wins[b].g++;
  if (s.winner === 0) wins[a].w++;
  if (s.winner === 1) wins[b].w++;
}

console.log(`${games} Partien ok, Ø ${(totalTurns / games).toFixed(1)} Züge`);
for (const c of classes) console.log(`  ${CLASSES[c].name.padEnd(13)} ${((100 * wins[c].w) / wins[c].g).toFixed(0)}% Siege`);
