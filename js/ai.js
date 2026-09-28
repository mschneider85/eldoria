/*
 * Computergegner: schätzt für jede Handkarte die Siegchance gegen die bekannten
 * Karten des Gegners und wägt Gewinn (eroberte Karten, Quartett-Fortschritt)
 * gegen Verlust (eigene Karte, zerstörter Quartett-Fortschritt) ab.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const Eng = CG.Engine;
  const { CARDS, STAT_IDS } = CG;

  const LOSS = [0, 1, 1.4, 2.0, 3.0];   // Verlust nach eigener Anzahl dieses Volkes (inkl. der Karte)
  const TUNE = { hornCost: 0.7 };      // gefühlter Preis eines Horneinsatzes (per Test abgestimmt)
  const GAIN = [1.2, 1.7, 2.4, 5.0];    // Gewinn nach eigener Anzahl vor der Eroberung (3 → Quartett!)

  /** Mögliche Gegenkarten mit Gewicht: alle bekannten Karten des Gegners, eine per Spion gesehene zählt stärker. */
  function opponentPool(s, p) {
    const pool = Eng.owned(s, 1 - p).map((id) => ({ id, w: 1 }));
    const seen = s.spyInfo && s.spyInfo[p];
    if (seen) pool.forEach((o) => { if (o.id === seen) o.w = pool.length / 2; });
    return pool;
  }

  function winChance(s, p, cardId, horn) {
    const pool = opponentPool(s, p);
    if (!pool.length) return 1;
    let score = 0;
    let total = 0;
    for (const o of pool) {
      const mine = { card: cardId, horn };
      const theirs = { card: o.id, horn: false };
      const r = Eng.duel(s, p === 0 ? [mine, theirs] : [theirs, mine]);
      score += o.w * (r.winner === p ? 1 : r.winner === -1 ? 0.5 : 0);
      total += o.w;
    }
    // Der Gegner spielt meist eine gute Karte – Chance daher abschwächen.
    return Math.pow(score / total, 1.8);
  }

  /** Wie sehr schmerzt es, diese Karte zu verlieren? Quartett-Fortschritt + Kartenstärke. */
  function lossValue(s, p, cardId) {
    const c = CARDS[cardId];
    if (c.ability === 'retreat' && !s.retreatUsed.includes(cardId)) return 0.2;
    const strength = Object.values(c.stats).reduce((a, b) => a + b, 0) / 400;
    return LOSS[Eng.factionCount(s, p, c.faction)] + strength;
  }

  function expectedValue(s, p, cardId, horn) {
    const opp = 1 - p;
    const pool = Eng.owned(s, opp);
    const pw = winChance(s, p, cardId, horn);
    const c = CARDS[cardId];
    let gain = 0;
    for (const oc of pool) {
      const of = CARDS[oc].faction;
      gain += GAIN[Eng.factionCount(s, p, of)] + 0.3 * Eng.factionCount(s, opp, of);
    }
    gain = pool.length ? gain / pool.length : 0;
    if (c.ability === 'plunder') gain *= 1.9;
    gain += s.pot.length * 1.2;
    let extra = 0;
    if (c.ability === 'spy') extra += 0.4;
    if (c.ability === 'runehorn' && !s.players[p].horn) extra += 1;
    const roundsLeft = s.maxRounds - s.round;
    // Das Horn lädt sich wieder auf – ein Einsatz kostet nur die Wartezeit bis zur nächsten Ladung
    const hornCost = horn ? (roundsLeft > Eng.HORN_RECHARGE ? TUNE.hornCost : 0.2) : 0;
    return pw * (gain + 1) - (1 - pw) * lossValue(s, p, cardId) + extra - hornCost;
  }

  function chooseCard(s, p) {
    const pl = s.players[p];
    if (pl.difficulty === 'easy' && Math.random() < 0.5) {
      return { card: CG.shuffle(pl.hand.slice())[0], horn: pl.horn && Math.random() < 0.1 };
    }
    let best = null;
    for (const card of pl.hand) {
      for (const horn of pl.horn ? [false, true] : [false]) {
        const ev = expectedValue(s, p, card, horn);
        if (!best || ev > best.ev) best = { card, horn, ev };
      }
    }
    return { card: best.card, horn: best.horn };
  }

  function chooseStat(s, p) {
    if (s.players[p].difficulty === 'easy' && Math.random() < 0.5) return CG.shuffle(STAT_IDS.slice())[0];
    let best = null;
    for (const stat of STAT_IDS) {
      const sim = Object.assign({}, s, { stat });
      const ev = Math.max(...s.players[p].hand.map((c) => expectedValue(sim, p, c, false)));
      if (!best || ev > best.ev) best = { stat, ev };
    }
    return best.stat;
  }

  CG.AI = { chooseCard, chooseStat, winChance, TUNE };
})(globalThis);
