/*
 * Computergegner: gierige Ein-Schritt-Vorausschau.
 * Jede legale Aktion wird auf einer Kopie des Zustands simuliert und
 * mit einer Bewertungsfunktion verglichen; die beste Verbesserung wird gespielt.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const Eng = CG.Engine;
  const CARDS = CG.CARDS;

  function heroValue(h) {
    const eff = h.health + h.armor;
    return eff <= 0 ? -1000 : 5 * Math.sqrt(eff); // Leben ist wertvoller, je weniger man hat
  }

  function minionValue(m) {
    if (m.health <= 0) return 0;
    const c = CARDS[m.id];
    let v = 1 + m.attack * 1.3 + m.health;
    if (m.taunt) v += 1.5;
    if (m.divineShield) v += 1 + m.attack * 0.8;
    if (m.windfury) v += m.attack * 0.7;
    if (m.frozen) v -= m.attack * 0.5;
    if (c.deathrattle || c.endOfTurn) v += 1.5;
    return v;
  }

  function evaluate(s, p) {
    if (s.winner !== null) return s.winner === p ? 1e5 : s.winner === -1 ? -5e4 : -1e5;
    const me = s.players[p];
    const op = s.players[1 - p];
    let score = heroValue(me.hero) - heroValue(op.hero) * 1.1;
    for (const m of me.board) score += minionValue(m);
    for (const m of op.board) score -= minionValue(m) * 1.1 + m.attack * 1.2; // Bedrohung im nächsten Zug
    score += Math.min(me.hand.length, 10) * 1.2;
    return score;
  }

  function simulate(s, action) {
    const sim = Eng.clone(s);
    sim.events = [];
    const res = Eng.apply(sim, action);
    return res.ok ? sim : null;
  }

  function bestAction(s, p, allowCoin) {
    const base = evaluate(s, p);
    let best = null;
    let bestGain = 0.05;
    const candidates = [];
    for (const action of Eng.legalActions(s)) {
      const isCoin = action.type === 'play' && s.players[p].hand.find((h) => h.uid === action.card).id === 'coin';
      if (isCoin && !allowCoin) continue;
      const sim = simulate(s, action);
      if (!sim) continue;
      let gain = evaluate(sim, p) - base;
      if (isCoin) {
        // Münze nur, wenn sie eine bessere Folgeaktion ermöglicht.
        const now = bestAction(s, p, false);
        const after = bestAction(sim, p, false);
        gain = after.gain - now.gain - 0.5;
      }
      candidates.push({ action, gain });
      if (gain > bestGain) { bestGain = gain; best = action; }
    }
    return { action: best, gain: best ? bestGain : 0, candidates };
  }

  /** Liefert die nächste Aktion der KI für Spieler p. */
  function decide(s, p) {
    const difficulty = s.players[p].difficulty;
    const { action, candidates } = bestAction(s, p, true);
    if (!action) return { type: 'end' };
    if (difficulty === 'easy') {
      const good = candidates.filter((c) => c.gain > 0.05);
      if (Math.random() < 0.08) return { type: 'end' };
      if (Math.random() < 0.5 && good.length) return CG.shuffle(good)[0].action;
    }
    return action;
  }

  CG.AI = { decide, evaluate };
})(globalThis);
