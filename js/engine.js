/*
 * Spiel-Engine (ohne DOM). Ablauf einer Runde:
 *   startRound → [chooseStat, falls Schlachtfeld „choice“] → choose (beide Spieler) → resolve → nextRound
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { CARDS, TERRAINS, FACTIONS, STAT_IDS, ABILITIES, shuffle } = CG;

  const HAND_SIZE = 3;
  const RALLY_RECHARGE = 2; // Runden im Rückstand, bis der Schlachtruf nach dem Einsatz wieder bereit ist
  const DEFAULTS = { maxRounds: 40, targetQuartets: 3 };

  const owned = (s, p) => [...s.players[p].hand, ...s.players[p].deck];
  /** Stärke im Spiel: Karten im Besitz, ein abgelegtes Quartett zählt wie seine 4 Karten. */
  const power = (s, p) => owned(s, p).length + 4 * s.players[p].quartets.length;
  const factionCount = (s, p, f) => owned(s, p).filter((id) => CARDS[id].faction === f).length;

  /** Verb passend zum Spieler („Du gewinnst“ / „Computer gewinnt“). */
  const verb = (pl, third, second) => (pl.name === 'Du' ? second : third);

  function log(s, text, kind = 'info') {
    s.log.push({ text, kind, round: s.round });
    if (s.log.length > 200) s.log.shift();
  }

  /**
   * Wertet ein Duell komplett aus – inklusive Fähigkeiten und Völkerbonus.
   * choices: [{ card }, { card }] für Spieler 0 und 1.
   * opts.allies(i, card) ersetzt die Zahl der Verbündeten auf der Hand von Spieler i
   * (für die KI, die die gegnerische Hand nicht kennen darf).
   * Rückgabe: { stat, low, values: [{ base, mods: [{ label, amount }], total }], winner, reason, notes }
   * winner: 0/1, -1 = Gleichstand. Die Beträge in mods sind so, wie sie den angezeigten Wert verändern.
   */
  function duel(s, choices, opts = {}) {
    const ids = choices.map((c) => c.card);
    const cards = ids.map((id) => CARDS[id]);
    const notes = [];

    // 1. Welche Eigenschaft zählt? Lenken beide um, heben sie sich auf.
    let stat = s.stat;
    const switchers = [0, 1].filter((i) => cards[i].ability === 'redirect');
    if (switchers.length === 2) {
      notes.push('🔀 Beide lenken um – die Effekte heben sich auf.');
    } else if (switchers.length === 1) {
      const c = cards[switchers[0]];
      if (c.stat !== stat) {
        stat = c.stat;
        notes.push(`${ABILITIES[c.ability].icon} ${c.name}: Jetzt zählt ${CG.STATS[stat].icon} ${CG.STATS[stat].name}!`);
      }
    }

    // 2. Gewinnt der höhere oder der niedrigere Wert?
    let low = !!s.terrain.lowWins;
    const traitors = cards.filter((c) => c.ability === 'treason');
    if (traitors.length % 2) {
      low = !low;
      notes.push(`🎭 ${traitors[0].name}: Verrat! Jetzt gewinnt der ${low ? 'niedrigere' : 'höhere'} Wert.`);
    }
    const dir = low ? -1 : 1;

    // 3. Grundwerte
    const best = (c) => (low ? Math.min : Math.max)(...Object.values(c.stats));
    const base = cards.map((c) => (c.ability === 'shift' ? best(c) : c.stats[stat]));
    for (const i of [0, 1]) if (cards[i].ability === 'mirror') base[i] = Math.max(0, base[1 - i] + 5 * dir);

    // 4. Vorteile (positiv = gut für den Besitzer)
    const adv = [[], []];
    for (const i of [0, 1]) {
      const c = cards[i];
      const o = 1 - i;
      const bonus = (s.terrain.bonus && s.terrain.bonus[c.faction]) || 0;
      if (bonus) adv[i].push(['Völkerbonus', bonus]);
      if (c.ability === 'allies') {
        const n = opts.allies
          ? opts.allies(i, c)
          : s.players[i].hand.filter((id) => id !== c.id && CARDS[id].faction === c.faction).length;
        if (n) adv[i].push(['Verbündete', c.amount * n]);
      }
      if (c.ability === 'rage' && s.lastWinner === o) adv[i].push(['Wut', c.amount]);
      if (c.ability === 'ambush' && dir * (base[o] - base[i]) > 0) adv[i].push(['Hinterhalt', 25]);
      if (c.ability === 'spy') adv[i].push(['Spion', 10]);
      if (cards[o].ability === 'weaken') adv[i].push(['Geschwächt', -cards[o].amount]);
    }
    const values = [0, 1].map((i) => {
      const mods = adv[i].map(([label, a]) => ({ label, amount: dir * a }));
      const total = Math.max(0, base[i] + mods.reduce((sum, m) => sum + m.amount, 0));
      return { base: base[i], mods, total };
    });

    // 5. Sieger
    let winner;
    let reason;
    if (values[0].total === values[1].total) {
      winner = -1; reason = 'tie';
    } else {
      winner = (values[0].total > values[1].total) === !low ? 0 : 1;
      reason = low ? 'low' : 'high';
    }
    return { stat, low, values, winner, reason, notes };
  }

  /** Füllt die Hand vom eigenen Stapel auf und gibt die gezogenen Karten zurück. */
  function refill(s, p) {
    const pl = s.players[p];
    const drawn = [];
    while (pl.hand.length < HAND_SIZE && pl.deck.length) {
      const id = pl.deck.pop();
      pl.hand.push(id);
      drawn.push(id);
    }
    s.known[p] = s.known[p].filter((id) => !drawn.includes(id));
    return drawn;
  }

  /** Legt vollständige Quartette ab und gibt die neuen Völker zurück. */
  function layQuartets(s, p) {
    const pl = s.players[p];
    const laid = [];
    for (const f of Object.keys(FACTIONS).map(Number)) {
      if (factionCount(s, p, f) === 4) {
        pl.hand = pl.hand.filter((id) => CARDS[id].faction !== f);
        pl.deck = pl.deck.filter((id) => CARDS[id].faction !== f);
        s.known[p] = s.known[p].filter((id) => CARDS[id].faction !== f);
        pl.quartets.push(f);
        laid.push(f);
        log(s, `${pl.name} ${verb(pl, 'legt', 'legst')} das Quartett der ${FACTIONS[f].name} ab!`, 'quartet');
      }
    }
    return laid;
  }

  function newGame(opts) {
    const cfg = Object.assign({}, DEFAULTS, opts);
    let decks;
    // So lange mischen, bis niemand schon beim Austeilen ein komplettes Quartett hat.
    for (;;) {
      const all = shuffle(Object.keys(CARDS));
      decks = [all.slice(0, 16), all.slice(16)];
      const full = decks.some((d) => Object.keys(FACTIONS).some((f) => d.filter((id) => CARDS[id].faction === Number(f)).length === 4));
      if (!full) break;
    }
    const s = {
      mode: cfg.mode, maxRounds: cfg.maxRounds, targetQuartets: cfg.targetQuartets,
      round: 0, terrain: null, stat: null, phase: 'idle', leader: Math.random() < 0.5 ? 0 : 1,
      terrainDeck: [], pot: [], choices: [null, null], result: null, winner: null, log: [],
      lastWinner: -1, spy: [false, false], spyInfo: [null, null], retreatUsed: [],
      // Karten, die offen unter einen Stapel gewandert und noch nicht wieder gezogen sind – das kann sich jeder merken
      known: [[], []],
      players: cfg.players.map((o, i) => ({
        idx: i, name: o.name, isAI: !!o.isAI, difficulty: o.difficulty || 'normal',
        deck: decks[i], hand: [], quartets: [], rally: true, rallyCharge: 0, won: 0,
      })),
    };
    for (const p of [0, 1]) refill(s, p);
    log(s, `${s.players[s.leader].name} ${verb(s.players[s.leader], 'ist', 'bist')} Anführer der ersten Runde.`, 'round');
    startRound(s);
    return s;
  }

  function startRound(s) {
    s.round++;
    if (!s.terrainDeck.length) s.terrainDeck = shuffle(TERRAINS.map((t) => t.id));
    const next = s.terrainDeck.pop();
    s.terrain = TERRAINS.find((t) => t.id === next);
    s.choices = [null, null];
    s.result = null;
    // Spion: eine zufällige Handkarte des Gegners wird für diese Runde sichtbar.
    s.spyInfo = [0, 1].map((p) => {
      if (!s.spy[p] || !s.players[1 - p].hand.length) return null;
      const hand = s.players[1 - p].hand;
      return hand[Math.floor(Math.random() * hand.length)];
    });
    s.spy = [false, false];
    log(s, `— Runde ${s.round}: ${s.terrain.name} —`, 'round');
    if (s.terrain.stat === 'choice') {
      s.stat = null;
      s.phase = 'stat';
    } else {
      s.stat = s.terrain.stat;
      s.phase = 'cards';
    }
  }

  function chooseStat(s, p, stat) {
    if (s.phase !== 'stat' || p !== s.leader || !STAT_IDS.includes(stat)) return { ok: false, error: 'Ungültige Wahl.' };
    s.stat = stat;
    s.phase = 'cards';
    log(s, `${s.players[p].name} ${verb(s.players[p], 'wählt', 'wählst')} ${CG.STATS[stat].name}.`);
    return { ok: true };
  }

  /**
   * Schlachtruf: Die Handkarten werden in den eigenen Stapel gemischt, dann werden neue gezogen.
   * Nur vor der Kartenwahl. Danach lädt er sich in Runden auf, in denen man zurückliegt.
   */
  function rally(s, p) {
    const pl = s.players[p];
    if (s.phase !== 'cards' || s.choices[p]) return { ok: false, error: 'Jetzt nicht möglich.' };
    if (!pl.rally) return { ok: false, error: 'Der Schlachtruf ist noch nicht bereit.' };
    if (!pl.deck.length) return { ok: false, error: 'Dein Stapel ist leer.' };
    const old = pl.hand.slice();
    pl.deck.push(...pl.hand);
    pl.hand = [];
    shuffle(pl.deck);
    s.known[p] = []; // nach dem Mischen weiß niemand mehr, wo welche Karte liegt
    s.spyInfo[1 - p] = null; // die per Spion gesehene Karte ist vielleicht nicht mehr auf der Hand
    pl.rally = false;
    pl.rallyCharge = 0;
    const drawn = refill(s, p);
    log(s, `📯 ${pl.name} ${verb(pl, 'stößt', 'stößt')} den Schlachtruf aus und ${verb(pl, 'zieht', 'ziehst')} ${drawn.length} neue Karten!`, 'horn');
    return { ok: true, old, drawn };
  }

  function choose(s, p, cardId) {
    const pl = s.players[p];
    if (s.phase !== 'cards' || s.choices[p]) return { ok: false, error: 'Jetzt nicht möglich.' };
    if (!pl.hand.includes(cardId)) return { ok: false, error: 'Karte nicht auf der Hand.' };
    s.choices[p] = { card: cardId };
    if (s.choices[0] && s.choices[1]) resolve(s);
    return { ok: true };
  }

  function resolve(s) {
    const ids = s.choices.map((c) => c.card);
    const d = duel(s, s.choices);
    s.choices.forEach((c, p) => {
      const pl = s.players[p];
      pl.hand.splice(pl.hand.indexOf(c.card), 1);
    });
    for (const n of d.notes) log(s, n, 'ability');
    const names = ids.map((id) => CARDS[id].name);
    log(s, `${names[0]} (${d.values[0].total}) gegen ${names[1]} (${d.values[1].total})`);

    const result = { ids, values: d.values, stat: d.stat, low: d.low, winner: d.winner, reason: d.reason,
      notes: d.notes.slice(), potTaken: 0, loot: 0, quartets: [[], []] };
    if (d.winner === -1) {
      s.pot.push(...ids);
      log(s, `Gleichstand! Beide Karten wandern in die Kriegsbeute (${s.pot.length}).`, 'tie');
    } else {
      const wi = d.winner;
      const li = 1 - wi;
      const w = s.players[wi];
      const l = s.players[li];
      const loot = [ids[wi], ...s.pot];
      const lost = CARDS[ids[li]];
      // Rückzug wirkt nur einmal pro Spiel – sonst könnte der Gegner dieses Volk nie zum Quartett machen
      if (lost.ability === 'retreat' && !s.retreatUsed.includes(lost.id)) {
        s.retreatUsed.push(lost.id);
        l.deck.unshift(lost.id); // unter den eigenen Stapel
        s.known[li].push(lost.id);
        result.notes.push(`↩️ ${lost.name} zieht sich zurück und bleibt bei ${l.name === 'Du' ? 'dir' : l.name} (Rückzug verbraucht).`);
      } else {
        loot.push(lost.id);
      }
      if (CARDS[ids[wi]].ability === 'plunder' && l.deck.length) {
        const stolen = l.deck.pop(); // die oberste Karte des Gegners
        s.known[li] = s.known[li].filter((id) => id !== stolen);
        loot.push(stolen);
        result.notes.push(`🏴‍☠️ Plündern: ${w.name} ${verb(w, 'erbeutet', 'erbeutest')} zusätzlich ${CARDS[stolen].name}.`);
      }
      result.potTaken = s.pot.length;
      result.loot = loot.length;
      s.pot = [];
      // Wie beim klassischen Quartett: Beute kommt unter den Stapel, gezogen wird von oben (Ende des Arrays).
      w.deck.unshift(...loot);
      s.known[wi].push(...loot);
      w.won++;
      s.leader = wi;
      const why = d.reason === 'low' ? ' (niedrigster Wert)' : '';
      log(s, `${w.name} ${verb(w, 'gewinnt', 'gewinnst')}${why} und ${verb(w, 'erobert', 'eroberst')} ${loot.length} Karte${loot.length === 1 ? '' : 'n'}.`, 'win');
      for (const n of result.notes.slice(d.notes.length)) log(s, n, 'ability');
      result.stolen = result.notes.some((n) => n.startsWith('🏴'));
      result.retreated = result.notes.some((n) => n.startsWith('↩️'));
      result.quartets[wi] = layQuartets(s, wi);
    }
    s.choices.forEach((c, p) => {
      const card = CARDS[c.card];
      const pl = s.players[p];
      if (card.ability === 'runehorn' && !pl.rally) {
        pl.rally = true;
        pl.rallyCharge = 0;
        result.notes.push(`📯 Runenhorn: ${pl.name === 'Du' ? 'Dein Schlachtruf ist' : `Der Schlachtruf von ${pl.name} ist`} sofort wieder bereit.`);
      } else if (!pl.rally && power(s, p) < power(s, 1 - p)) {
        // Der Schlachtruf lädt sich nur auf, solange man zurückliegt
        if (++pl.rallyCharge >= RALLY_RECHARGE) { pl.rally = true; pl.rallyCharge = 0; }
      }
      if (card.ability === 'spy') s.spy[p] = true;
    });
    s.lastWinner = d.winner;
    result.drawn = [0, 1].map((p) => refill(s, p));
    s.result = result;
    s.phase = 'result';
    checkEnd(s);
  }

  function checkEnd(s) {
    const [a, b] = s.players;
    const target = s.targetQuartets;
    let winner = null;
    let reason = '';
    if (a.quartets.length >= target || b.quartets.length >= target) {
      winner = a.quartets.length >= target ? 0 : 1;
      reason = `${target} Quartette gesammelt`;
    } else if (!a.hand.length || !b.hand.length) {
      winner = !a.hand.length && !b.hand.length ? score(s) : a.hand.length ? 0 : 1;
      const out = !a.hand.length ? a : b;
      reason = `${out.name} ${out.name === 'Du' ? 'hast' : 'hat'} keine Karten mehr`;
    } else if (s.round >= s.maxRounds) {
      winner = score(s);
      reason = 'Rundenlimit erreicht';
    }
    if (winner !== null) {
      s.winner = winner;
      s.endReason = reason;
      s.phase = 'over';
      log(s, winner === -1 ? 'Unentschieden!' : `${s.players[winner].name} ${verb(s.players[winner], 'gewinnt', 'gewinnst')} das Spiel! (${reason})`, 'end');
    }
  }

  /** Wertung bei Rundenlimit: mehr Quartette, dann mehr Karten. */
  function score(s) {
    const q = s.players.map((pl) => pl.quartets.length);
    if (q[0] !== q[1]) return q[0] > q[1] ? 0 : 1;
    const n = [0, 1].map((p) => owned(s, p).length);
    if (n[0] !== n[1]) return n[0] > n[1] ? 0 : 1;
    return -1;
  }

  function nextRound(s) {
    if (s.phase !== 'result') return;
    startRound(s);
  }

  CG.Engine = {
    HAND_SIZE, RALLY_RECHARGE,
    newGame, chooseStat, choose, rally, nextRound, duel, owned, power, factionCount,
    clone: (s) => structuredClone(s),
  };
})(globalThis);
