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

  /** Verb passend zum Spieler („Du gewinnst“ / „Computer gewinnt“). you = der Spieler an diesem Gerät. */
  const verb = (pl, third, second) => (pl.you ? second : third);

  /*
   * Zufall mit Startwert: In einer Online-Partie rechnen beide Geräte dieselbe Partie und tauschen nur
   * die Züge aus. Dafür muss jeder Zufall auf beiden Seiten gleich ausfallen – auch wenn die Züge in
   * anderer Reihenfolge ankommen. Deshalb getrennte Ströme: 'shared' für alles, was beide gleichzeitig
   * erleben (Austeilen, Schlachtfeld, Los), und je einer pro Sitzplatz (Schlachtruf, Spion).
   * Der Gast sitzt spiegelverkehrt (flip): Er ist bei sich Spieler 0, auf dem Sitzplatz des Hosts aber 1.
   */
  const seat = (s, p) => (s.flip ? 1 - p : p);
  function rand(s, stream) {
    // mulberry32 – der Zustand liegt als Zahl im Spielzustand, damit clone() ihn mitnimmt
    let a = (s.rng[stream] = (s.rng[stream] + 0x6d2b79f5) | 0);
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }
  const rng = (s, stream) => () => rand(s, stream);
  const seatRng = (s, p) => rng(s, `seat${seat(s, p)}`);

  function log(s, text, kind = 'info') {
    s.log.push({ text, kind, round: s.round });
    if (s.log.length > 200) s.log.shift();
  }

  /**
   * Wertet ein Duell komplett aus – inklusive Fähigkeiten und Völkerbonus.
   * choices: [{ card }, { card }] für Spieler 0 und 1.
   * opts.allies(i, card) ersetzt die Zahl der Verbündeten auf der Hand von Spieler i
   * (für die KI, die die gegnerische Hand nicht kennen darf).
   * Rückgabe: { stat, low, values: [{ raw, via, base, mods: [{ label, amount }], total }], winner, reason, notes,
   *   start, switchers, traitors } – start: Eigenschaft vor dem Umlenken, raw: Kartenwert darin,
   *   via: 'shift'/'mirror', wenn die Fähigkeit den Grundwert ersetzt; switchers/traitors: wer umlenkt/verrät (für die Animation).
   * winner: 0/1, -1 = Gleichstand. Die Beträge in mods sind so, wie sie den angezeigten Wert verändern.
   * Fähigkeiten und Boni wirken immer wörtlich (Wut +20 heißt +20) – auch wo der niedrigere Wert gewinnt,
   * dann schaden sie eben dem Besitzer.
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
    const traitors = [0, 1].filter((i) => cards[i].ability === 'treason');
    if (traitors.length % 2) {
      low = !low;
      notes.push(`🎭 ${cards[traitors[0]].name}: Verrat! Jetzt gewinnt der ${low ? 'niedrigere' : 'höhere'} Wert.`);
    }

    // 3. Grundwerte
    const best = (c) => Math.max(...Object.values(c.stats));
    const base = cards.map((c) => (c.ability === 'shift' ? best(c) : c.stats[stat]));
    for (const i of [0, 1]) if (cards[i].ability === 'mirror') base[i] = base[1 - i] + 5;

    // 4. Zu- und Abschläge auf den eigenen Wert
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
      if (cards[o].ability === 'weaken') adv[i].push(['Geschwächt', -cards[o].amount]);
    }
    const values = [0, 1].map((i) => {
      const mods = adv[i].map(([label, amount]) => ({ label, amount }));
      const total = Math.max(0, base[i] + mods.reduce((sum, m) => sum + m.amount, 0));
      const via = cards[i].ability === 'shift' || cards[i].ability === 'mirror' ? cards[i].ability : null;
      return { raw: cards[i].stats[s.stat], via, base: base[i], mods, total };
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
    return { stat, low, values, winner, reason, notes, start: s.stat, switchers, traitors };
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
    const seed = cfg.seed === undefined ? Math.floor(Math.random() * 2 ** 32) : cfg.seed;
    const s0 = { flip: !!cfg.flip, rng: { shared: seed | 0, seat0: (seed ^ 0x5bd1e995) | 0, seat1: (seed ^ 0x1b873593) | 0 } };
    let decks;
    // So lange mischen, bis niemand schon beim Austeilen ein komplettes Quartett hat.
    for (;;) {
      const all = shuffle(Object.keys(CARDS), rng(s0, 'shared'));
      decks = s0.flip ? [all.slice(16), all.slice(0, 16)] : [all.slice(0, 16), all.slice(16)];
      const full = decks.some((d) => Object.keys(FACTIONS).some((f) => d.filter((id) => CARDS[id].faction === Number(f)).length === 4));
      if (!full) break;
    }
    const s = {
      ...s0, mode: cfg.mode, maxRounds: cfg.maxRounds, targetQuartets: cfg.targetQuartets,
      // picker: wer auf einem Wahlfeld die Eigenschaft bestimmt – wird dort jedes Mal ausgelost
      round: 0, terrain: null, stat: null, phase: 'idle', picker: null,
      terrainDeck: [], pot: [], choices: [null, null], result: null, winner: null, log: [],
      // spyInfo[p]: eine Handkarte des Gegners, die p per Spion kennt – gilt, bis sie die Hand verlässt
      lastWinner: -1, spyInfo: [null, null], retreatUsed: [],
      // Karten, die offen unter einen Stapel gewandert und noch nicht wieder gezogen sind – das kann sich jeder merken
      known: [[], []],
      players: cfg.players.map((o, i) => ({
        idx: i, name: o.name, you: !!o.you, isAI: !!o.isAI, difficulty: o.difficulty || 'normal',
        deck: decks[i], hand: [], quartets: [], rally: true, rallyCharge: 0, won: 0,
      })),
    };
    for (const p of [0, 1]) refill(s, p);
    startRound(s);
    return s;
  }

  function startRound(s) {
    s.round++;
    if (!s.terrainDeck.length) s.terrainDeck = shuffle(TERRAINS.map((t) => t.id), rng(s, 'shared'));
    const next = s.terrainDeck.pop();
    s.terrain = TERRAINS.find((t) => t.id === next);
    s.choices = [null, null];
    s.result = null;
    log(s, `— Runde ${s.round}: ${s.terrain.name} —`, 'round');
    if (s.terrain.stat === 'choice') {
      s.stat = null;
      s.picker = seat(s, rand(s, 'shared') < 0.5 ? 0 : 1);
      s.phase = 'stat';
      const pl = s.players[s.picker];
      log(s, `🪙 Das Los fällt auf ${pl.you ? 'dich' : pl.name}.`);
    } else {
      s.picker = null;
      s.stat = s.terrain.stat;
      s.phase = 'cards';
    }
  }

  /** Spion: eine zufällige Handkarte des Gegners, bevorzugt eine, die p noch nicht kennt. */
  function spyOn(s, p) {
    const hand = s.players[1 - p].hand;
    const fresh = hand.filter((id) => id !== s.spyInfo[p]);
    const pool = fresh.length ? fresh : hand;
    return pool.length ? pool[Math.floor(seatRng(s, p)() * pool.length)] : null;
  }

  function chooseStat(s, p, stat) {
    if (s.phase !== 'stat' || p !== s.picker || !STAT_IDS.includes(stat)) return { ok: false, error: 'Ungültige Wahl.' };
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
    shuffle(pl.deck, seatRng(s, p));
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
      start: d.start, switchers: d.switchers, traitors: d.traitors,
      notes: d.notes.slice(), potTaken: 0, loot: 0, quartets: [[], []] };
    if (d.winner === -1) {
      s.pot.push(...(s.flip ? ids.slice().reverse() : ids)); // in Sitzplatz-Reihenfolge, damit Host und Gast gleich stapeln
      log(s, `Gleichstand! Beide Karten wandern in die Kriegsbeute (${s.pot.length}).`, 'tie');
    } else {
      const wi = d.winner;
      const li = 1 - wi;
      const w = s.players[wi];
      const l = s.players[li];
      const loot = [ids[wi], ...s.pot];
      const lost = CARDS[ids[li]];
      if (CARDS[ids[wi]].ability === 'plunder' && l.deck.length) {
        // vor dem Rückzug: sonst läge die zurückgezogene Karte bei leerem Stapel oben und würde gleich geplündert
        const stolen = l.deck.pop(); // die oberste Karte des Gegners
        s.known[li] = s.known[li].filter((id) => id !== stolen);
        loot.push(stolen);
        result.stolenId = stolen;
        result.notes.push(`🏴‍☠️ Plündern: ${w.name} ${verb(w, 'erbeutet', 'erbeutest')} zusätzlich ${CARDS[stolen].name}.`);
      }
      // Rückzug wirkt nur einmal pro Spiel – sonst könnte der Gegner dieses Volk nie zum Quartett machen
      if (lost.ability === 'retreat' && !s.retreatUsed.includes(lost.id)) {
        s.retreatUsed.push(lost.id);
        l.deck.unshift(lost.id); // unter den eigenen Stapel
        s.known[li].push(lost.id);
        result.notes.push(`↩️ ${lost.name} zieht sich zurück und bleibt bei ${l.you ? 'dir' : l.name} (Rückzug verbraucht).`);
      } else {
        loot.splice(1 + s.pot.length, 0, lost.id); // Reihenfolge wie bisher: eigene Karte, Kriegsbeute, Verlierer, Geplündertes
      }
      result.potTaken = s.pot.length;
      result.loot = loot.length;
      s.pot = [];
      // Wie beim klassischen Quartett: Beute kommt unter den Stapel, gezogen wird von oben (Ende des Arrays).
      w.deck.unshift(...loot);
      s.known[wi].push(...loot);
      w.won++;
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
        result.notes.push(`📯 Runenhorn: ${pl.you ? 'Dein Schlachtruf ist' : `Der Schlachtruf von ${pl.name} ist`} sofort wieder bereit.`);
      } else if (!pl.rally && power(s, p) < power(s, 1 - p)) {
        // Der Schlachtruf lädt sich nur auf, solange man zurückliegt
        if (++pl.rallyCharge >= RALLY_RECHARGE) { pl.rally = true; pl.rallyCharge = 0; }
      }
    });
    // Spion: Beim Aufdecken wird eine der verbliebenen Handkarten des Gegners ausgespäht (vor dem Nachziehen).
    // Bekanntes Wissen verfällt, sobald die Karte die Hand verlassen hat.
    result.spied = [false, false];
    for (const p of [0, 1]) {
      if (s.spyInfo[p] && !s.players[1 - p].hand.includes(s.spyInfo[p])) s.spyInfo[p] = null;
      if (CARDS[ids[p]].ability !== 'spy') continue;
      const seen = spyOn(s, p);
      if (!seen) continue;
      s.spyInfo[p] = seen;
      result.spied[p] = true;
      const pl = s.players[p];
      const note = `🕵️ Spion: ${pl.name} ${verb(pl, 'späht', 'spähst')} ${CARDS[seen].name} aus.`;
      result.notes.push(note);
      log(s, note, 'ability');
    }
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
      // Wer blank ist, verliert nicht automatisch – etwa wenn das letzte Quartett gerade alle Karten gebunden hat
      winner = score(s);
      const out = !a.hand.length ? a : b;
      reason = `${out.name} ${out.you ? 'hast' : 'hat'} keine Karten mehr, es zählen die Quartette`;
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

  /** Wertung bei Rundenlimit oder leerer Hand: mehr Quartette, dann mehr Karten. */
  function score(s) {
    const q = s.players.map((pl) => pl.quartets.length);
    if (q[0] !== q[1]) return q[0] > q[1] ? 0 : 1;
    const n = [0, 1].map((p) => owned(s, p).length);
    if (n[0] !== n[1]) return n[0] > n[1] ? 0 : 1;
    return -1;
  }

  /**
   * Prüfsumme des Spielstands in Sitzplatz-Reihenfolge: Host und Gast müssen nach jedem Duell dieselbe haben
   * (Online-Partien vergleichen sie, damit unterschiedliche Spielversionen auffallen).
   */
  function digest(s) {
    const seats = [0, 1].map((k) => seat(s, k));
    const w = (i) => (i < 0 ? i : seat(s, i));
    const str = JSON.stringify([
      s.round, s.phase, s.terrain && s.terrain.id, s.stat, s.picker === null ? null : w(s.picker), s.pot, s.retreatUsed, w(s.lastWinner), s.winner === null ? null : w(s.winner),
      seats.map((p) => { const pl = s.players[p]; return [pl.hand, pl.deck, pl.quartets, pl.rally, pl.rallyCharge, s.spyInfo[p], s.known[p]]; }),
      s.rng,
    ]);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  function nextRound(s) {
    if (s.phase !== 'result') return;
    startRound(s);
  }

  CG.Engine = {
    HAND_SIZE, RALLY_RECHARGE,
    newGame, chooseStat, choose, rally, nextRound, duel, owned, power, factionCount, digest,
    clone: (s) => structuredClone(s),
  };
})(globalThis);
