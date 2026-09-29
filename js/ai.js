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
  const TUNE = { rallyCost: 0, rallySamples: 12 }; // Schlachtruf: nötiger Vorteil der neuen Hand, Zahl der Probehände (per Test abgestimmt)
  const GAIN = [1.2, 1.7, 2.4, 5.0];    // Gewinn nach eigener Anzahl vor der Eroberung (3 → Quartett!)

  /** Mögliche Gegenkarten mit Gewicht: alle bekannten Karten des Gegners, eine per Spion gesehene zählt stärker. */
  function opponentPool(s, p) {
    const pool = Eng.owned(s, 1 - p).map((id) => ({ id, w: 1 }));
    const seen = s.spyInfo && s.spyInfo[p];
    if (seen) pool.forEach((o) => { if (o.id === seen) o.w = pool.length / 2; });
    return pool;
  }

  /**
   * Schwer: Karten, die offen unter den gegnerischen Stapel gewandert sind, können noch nicht auf
   * seiner Hand sein (Kartenzählen). Die übrigen werden danach gewichtet, wie gern der Gegner sie
   * spielen würde: Ist er gut, spielt er von seinen Handkarten die stärkste.
   */
  function hardPool(s, p) {
    const o = 1 - p;
    const known = s.known[o];
    const seen = s.spyInfo && s.spyInfo[p];
    const cand = Eng.owned(s, o).filter((id) => !known.includes(id));
    const h = Math.min(s.players[o].hand.length, cand.length);
    if (!h) return [];
    const mine = Eng.owned(s, p);
    const allies = alliesEstimate(s, p); // die gegnerische Hand kenne ich nicht
    // Wie stark ist jede Gegenkarte in diesem Duell – aus seiner Sicht gegen alles, was ich besitze?
    const strength = (id) => mine.reduce((sum, m) => {
      const r = Eng.duel(s, o === 0 ? [{ card: id }, { card: m }] : [{ card: m }, { card: id }], { allies });
      return sum + (r.winner === o ? 1 : r.winner === -1 ? 0.5 : 0);
    }, 0);
    // Eine per Spion gesehene Karte ist sicher auf der Hand: Er spielt sie oder eine bessere aus dem Rest.
    const rest = cand.filter((id) => id !== seen);
    const ranked = rest.map((id) => ({ id, v: strength(id) })).sort((a, b) => b.v - a.v);
    const slots = seen && cand.includes(seen) ? h - 1 : h;
    // P(Rang r wird gespielt) = P(r auf der Hand, alle besseren nicht) = C(n-1-r, slots-1) / C(n, slots)
    const n = ranked.length;
    const choose = (a, b) => { if (b < 0 || b > a) return 0; let x = 1; for (let i = 0; i < b; i++) x = (x * (a - i)) / (i + 1); return x; };
    const all = choose(n, slots);
    const pool = ranked.map((c, r) => ({ id: c.id, v: c.v, w: all ? choose(n - 1 - r, slots - 1) / all : 0 }));
    if (seen && cand.includes(seen)) {
      const sv = strength(seen);
      // Die gesehene Karte wird gespielt, wenn keine bessere unter den übrigen Handkarten ist
      const better = pool.filter((c) => c.v > sv).length;
      const pSeen = choose(n - better, slots) / (all || 1);
      pool.forEach((c) => { c.w = c.v > sv ? c.w : 0; });
      pool.push({ id: seen, w: pSeen });
    }
    return pool.filter((c) => c.w > 0);
  }

  /**
   * Erwartete Zahl der Verbündeten: für die eigene Karte aus der echten Hand, für die des Gegners
   * geschätzt – seine Hand ist unbekannt, nur welche Karten er besitzt und wie viele er hält.
   */
  function alliesEstimate(s, p) {
    return (i, c) => {
      const pl = s.players[i];
      if (i === p) return pl.hand.filter((id) => id !== c.id && CARDS[id].faction === c.faction).length;
      const others = Eng.owned(s, i).filter((id) => id !== c.id);
      if (!others.length) return 0;
      const same = others.filter((id) => CARDS[id].faction === c.faction).length;
      return (same * Math.max(0, pl.hand.length - 1)) / others.length;
    };
  }

  function winChance(s, p, cardId) {
    const hard = s.players[p].difficulty === 'hard';
    const pool = hard ? hardPool(s, p) : opponentPool(s, p);
    if (!pool.length) return 1;
    const allies = alliesEstimate(s, p);
    let score = 0;
    let total = 0;
    for (const o of pool) {
      const mine = { card: cardId };
      const theirs = { card: o.id };
      const r = Eng.duel(s, p === 0 ? [mine, theirs] : [theirs, mine], { allies });
      score += o.w * (r.winner === p ? 1 : r.winner === -1 ? 0.5 : 0);
      total += o.w;
    }
    // Schwer rechnet schon mit der wahrscheinlich gespielten Karte; sonst: Der Gegner spielt meist eine gute Karte – Chance abschwächen.
    return hard ? score / total : Math.pow(score / total, 1.8);
  }

  /** Wie sehr schmerzt es, diese Karte zu verlieren? Quartett-Fortschritt + Kartenstärke. */
  function lossValue(s, p, cardId) {
    const c = CARDS[cardId];
    if (c.ability === 'retreat' && !s.retreatUsed.includes(cardId)) return 0.2;
    const strength = Object.values(c.stats).reduce((a, b) => a + b, 0) / 400;
    return LOSS[Eng.factionCount(s, p, c.faction)] + strength;
  }

  function expectedValue(s, p, cardId) {
    const opp = 1 - p;
    const pool = Eng.owned(s, opp);
    const pw = winChance(s, p, cardId);
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
    if (c.ability === 'runehorn' && !s.players[p].rally) extra += 1;
    return pw * (gain + 1) - (1 - pw) * lossValue(s, p, cardId) + extra;
  }

  function chooseCard(s, p) {
    const pl = s.players[p];
    if (pl.difficulty === 'easy' && Math.random() < 0.5) {
      return { card: CG.shuffle(pl.hand.slice())[0] };
    }
    let best = null;
    for (const card of pl.hand) {
      const ev = expectedValue(s, p, card);
      if (!best || ev > best.ev) best = { card, ev };
    }
    return { card: best.card };
  }

  function chooseStat(s, p) {
    if (s.players[p].difficulty === 'easy' && Math.random() < 0.5) return CG.shuffle(STAT_IDS.slice())[0];
    let best = null;
    for (const stat of STAT_IDS) {
      const sim = Object.assign({}, s, { stat });
      const ev = bestEV(sim, p);
      if (!best || ev > best.ev) best = { stat, ev };
    }
    return best.stat;
  }

  const bestEV = (s, p) => Math.max(...s.players[p].hand.map((c) => expectedValue(s, p, c)));

  /**
   * Schlachtruf ausstoßen? Vergleicht die beste Karte der jetzigen Hand mit der besten Karte
   * zufällig neu gemischter Probehände – eine schwache Hand lohnt das Neuziehen, eine gute nicht.
   */
  function shouldRally(s, p) {
    const pl = s.players[p];
    if (!pl.rally || !pl.deck.length) return false;
    if (pl.difficulty === 'easy' && Math.random() < 0.5) return Math.random() < 0.2;
    const all = [...pl.hand, ...pl.deck];
    let sum = 0;
    for (let k = 0; k < TUNE.rallySamples; k++) {
      const mixed = CG.shuffle(all.slice());
      const players = s.players.slice();
      players[p] = Object.assign({}, pl, { hand: mixed.slice(0, pl.hand.length), deck: mixed.slice(pl.hand.length) });
      sum += bestEV(Object.assign({}, s, { players }), p);
    }
    return sum / TUNE.rallySamples - bestEV(s, p) > TUNE.rallyCost;
  }

  CG.AI = { chooseCard, chooseStat, shouldRally, winChance, TUNE };
})(globalThis);
