/*
 * Spiel-Engine: reiner Spielzustand + Regeln, ohne DOM.
 * Der Zustand besteht nur aus einfachen Daten (klonbar per structuredClone),
 * Karten werden über ihre id in CG.CARDS nachgeschlagen.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const CARDS = CG.CARDS;
  const CLASSES = CG.CLASSES;

  const MAX_HAND = 10;
  const MAX_BOARD = 7;
  const MAX_MANA = 10;
  const HERO_HEALTH = 30;

  /* ------------------------------------------------------------ Hilfsfunktionen */
  const E = {};

  E.log = (s, text, kind = 'info') => {
    s.log.push({ text, kind, turn: s.turn });
    if (s.log.length > 150) s.log.shift();
  };
  E.event = (s, ev) => s.events.push(ev);
  E.newUid = (s) => 'u' + s.nextUid++;
  E.random = (arr) => arr[Math.floor(Math.random() * arr.length)];

  E.hero = (s, p) => s.players[p].hero;
  E.friendlyMinions = (s, p) => s.players[p].board;
  E.enemyMinions = (s, p) => s.players[1 - p].board;
  E.allMinions = (s) => [...s.players[0].board, ...s.players[1].board];
  E.friendlyChars = (s, p) => [s.players[p].hero, ...s.players[p].board];
  E.enemyChars = (s, p) => E.friendlyChars(s, 1 - p);
  E.allChars = (s) => [...E.friendlyChars(s, 0), ...E.friendlyChars(s, 1)];
  E.findChar = (s, uid) => E.allChars(s).find((c) => c.uid === uid) || null;
  E.randomAliveEnemy = (s, p) => {
    const alive = E.enemyChars(s, p).filter((c) => c.health > 0);
    return alive.length ? E.random(alive) : null;
  };

  E.damage = (s, target, amount) => {
    if (!target || amount <= 0) return 0;
    if (target.kind === 'minion' && target.divineShield) {
      target.divineShield = false;
      E.event(s, { type: 'shield', uid: target.uid });
      return 0;
    }
    let dmg = amount;
    if (target.kind === 'hero' && target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.health -= dmg;
    E.event(s, { type: 'damage', uid: target.uid, amount });
    return amount;
  };

  E.heal = (s, target, amount) => {
    if (!target || target.health <= 0) return 0;
    const healed = Math.min(amount, target.maxHealth - target.health);
    if (healed > 0) {
      target.health += healed;
      E.event(s, { type: 'heal', uid: target.uid, amount: healed });
    }
    return healed;
  };

  E.destroy = (s, minion) => {
    if (!minion || minion.kind !== 'minion') return;
    minion.health = 0;
    E.event(s, { type: 'destroy', uid: minion.uid });
  };

  E.buff = (s, minion, atk, hp) => {
    minion.attack += atk;
    minion.health += hp;
    minion.maxHealth += hp;
    E.event(s, { type: 'buff', uid: minion.uid });
  };

  E.giveShield = (s, minion) => {
    if (!minion) return;
    minion.divineShield = true;
    E.event(s, { type: 'buff', uid: minion.uid });
  };

  E.freeze = (s, target) => {
    if (!target || target.health <= 0) return;
    target.frozen = true;
    E.event(s, { type: 'freeze', uid: target.uid });
  };

  E.addArmor = (s, p, n) => {
    s.players[p].hero.armor += n;
    E.event(s, { type: 'armor', uid: s.players[p].hero.uid, amount: n });
  };

  E.gainMana = (s, p, n) => {
    const pl = s.players[p];
    pl.mana = Math.min(MAX_MANA, pl.mana + n);
  };

  E.draw = (s, p, n = 1) => {
    const pl = s.players[p];
    for (let i = 0; i < n; i++) {
      if (!pl.deck.length) {
        pl.fatigue++;
        E.log(s, `${pl.name} hat keine Karten mehr – Erschöpfung: ${pl.fatigue} Schaden.`, 'bad');
        E.damage(s, pl.hero, pl.fatigue);
        continue;
      }
      const id = pl.deck.pop();
      if (pl.hand.length >= MAX_HAND) {
        E.log(s, `${pl.name}: Hand voll – ${CARDS[id].name} wurde verbrannt.`, 'bad');
        continue;
      }
      pl.hand.push({ uid: E.newUid(s), id });
      E.event(s, { type: 'draw', player: p });
    }
  };

  E.makeMinion = (s, p, cardId) => {
    const c = CARDS[cardId];
    const kw = new Set(c.keywords);
    return {
      uid: E.newUid(s), kind: 'minion', owner: p, id: cardId, name: c.name,
      attack: c.attack, health: c.health, maxHealth: c.health,
      taunt: kw.has('taunt'), charge: kw.has('charge'), divineShield: kw.has('divineShield'), windfury: kw.has('windfury'),
      frozen: false, sleeping: !kw.has('charge'), attacksMade: 0,
    };
  };

  E.summon = (s, p, cardId) => {
    const board = s.players[p].board;
    if (board.length >= MAX_BOARD) return null;
    const m = E.makeMinion(s, p, cardId);
    board.push(m);
    E.event(s, { type: 'summon', uid: m.uid });
    return m;
  };

  /* ---------------------------------------------------------------- Regeln */
  function validTargets(s, p, type, filter) {
    let list;
    switch (type) {
      case 'any': list = E.allChars(s); break;
      case 'minion': list = E.allMinions(s); break;
      case 'enemyMinion': list = E.enemyMinions(s, p).slice(); break;
      case 'friendlyMinion': list = E.friendlyMinions(s, p).slice(); break;
      case 'enemy': list = E.enemyChars(s, p); break;
      case 'friendly': list = E.friendlyChars(s, p); break;
      default: return [];
    }
    return list.filter((t) => t.health > 0 && (!filter || filter(t)));
  }

  function cardDef(handCard) { return CARDS[handCard.id]; }

  /** Muss für diese Karte ein Ziel gewählt werden? */
  function needsTarget(s, p, card) {
    if (!card.target) return false;
    if (card.type === 'spell') return true;
    return validTargets(s, p, card.target, card.targetFilter).length > 0; // Kampfschrei ohne Ziel verfällt
  }

  function canPlay(s, p, handCard) {
    if (s.winner !== null || s.current !== p) return false;
    const c = cardDef(handCard);
    const pl = s.players[p];
    if (c.cost > pl.mana) return false;
    if ((c.type === 'minion' || c.needsBoardSpace) && pl.board.length >= MAX_BOARD) return false;
    if (c.type === 'spell' && c.target && !validTargets(s, p, c.target, c.targetFilter).length) return false;
    return true;
  }

  function playTargets(s, p, handCard) {
    const c = cardDef(handCard);
    return needsTarget(s, p, c) ? validTargets(s, p, c.target, c.targetFilter) : [];
  }

  function canUsePower(s, p) {
    if (s.winner !== null || s.current !== p) return false;
    const pl = s.players[p];
    const pw = CLASSES[pl.classId].power;
    if (pl.powerUsed || pl.mana < pw.cost) return false;
    if (pw.needsBoardSpace && pl.board.length >= MAX_BOARD) return false;
    return true;
  }

  function powerTargets(s, p) {
    const pw = CLASSES[s.players[p].classId].power;
    return pw.target ? validTargets(s, p, pw.target) : [];
  }

  function canAttack(s, m) {
    if (!m || m.kind !== 'minion' || s.winner !== null || s.current !== m.owner) return false;
    return m.health > 0 && m.attack > 0 && !m.frozen && (!m.sleeping || m.charge) && m.attacksMade < (m.windfury ? 2 : 1);
  }

  function attackTargets(s, p) {
    const enemies = E.enemyChars(s, p).filter((c) => c.health > 0);
    const taunts = enemies.filter((c) => c.kind === 'minion' && c.taunt);
    return taunts.length ? taunts : enemies;
  }

  function resolveDeaths(s) {
    for (let guard = 0; guard < 50; guard++) {
      const dead = [];
      for (const p of [s.current, 1 - s.current]) for (const m of s.players[p].board) if (m.health <= 0) dead.push(m);
      if (!dead.length) break;
      for (const m of dead) {
        const board = s.players[m.owner].board;
        board.splice(board.indexOf(m), 1);
        E.event(s, { type: 'death', uid: m.uid });
        E.log(s, `${m.name} stirbt.`, 'death');
      }
      for (const m of dead) {
        const c = CARDS[m.id];
        if (c.deathrattle) c.deathrattle({ state: s, me: m.owner, self: m, target: null, E });
      }
    }
    checkWinner(s);
  }

  function checkWinner(s) {
    if (s.winner !== null) return;
    const d0 = s.players[0].hero.health <= 0;
    const d1 = s.players[1].hero.health <= 0;
    if (d0 && d1) s.winner = -1;
    else if (d0) s.winner = 1;
    else if (d1) s.winner = 0;
    if (s.winner !== null) E.log(s, s.winner === -1 ? 'Unentschieden!' : `${s.players[s.winner].name} gewinnt!`, 'win');
  }

  /* --------------------------------------------------------------- Aktionen */
  function fail(error) { return { ok: false, error }; }

  function playCard(s, p, handUid, targetUid) {
    const pl = s.players[p];
    const idx = pl.hand.findIndex((h) => h.uid === handUid);
    if (idx < 0) return fail('Karte nicht auf der Hand.');
    const hc = pl.hand[idx];
    const c = cardDef(hc);
    if (!canPlay(s, p, hc)) return fail('Karte kann nicht gespielt werden.');
    let target = null;
    if (needsTarget(s, p, c)) {
      target = validTargets(s, p, c.target, c.targetFilter).find((t) => t.uid === targetUid);
      if (!target) return fail('Ungültiges Ziel.');
    }
    pl.mana -= c.cost;
    pl.hand.splice(idx, 1);
    E.event(s, { type: 'play', player: p, cardId: c.id });
    const onTarget = target ? ` auf ${target.name}` : '';
    if (c.type === 'minion') {
      const m = E.summon(s, p, c.id);
      E.log(s, `${pl.name} beschwört ${c.name}${onTarget}.`, 'play');
      if (c.battlecry) c.battlecry({ state: s, me: p, self: m, target, E });
    } else {
      E.log(s, `${pl.name} wirkt ${c.name}${onTarget}.`, 'spell');
      c.spell({ state: s, me: p, self: null, target, E });
    }
    resolveDeaths(s);
    return { ok: true };
  }

  function usePower(s, p, targetUid) {
    if (!canUsePower(s, p)) return fail('Heldenfähigkeit nicht verfügbar.');
    const pl = s.players[p];
    const pw = CLASSES[pl.classId].power;
    let target = null;
    if (pw.target) {
      target = powerTargets(s, p).find((t) => t.uid === targetUid);
      if (!target) return fail('Ungültiges Ziel.');
    }
    pl.mana -= pw.cost;
    pl.powerUsed = true;
    E.event(s, { type: 'power', player: p });
    E.log(s, `${pl.name} nutzt ${pw.name}${target ? ` auf ${target.name}` : ''}.`, 'spell');
    pw.effect({ state: s, me: p, self: null, target, E });
    resolveDeaths(s);
    return { ok: true };
  }

  function attack(s, p, attackerUid, targetUid) {
    const attacker = s.players[p].board.find((m) => m.uid === attackerUid);
    if (!canAttack(s, attacker)) return fail('Dieser Diener kann nicht angreifen.');
    const target = attackTargets(s, p).find((t) => t.uid === targetUid);
    if (!target) {
      const blocked = E.enemyChars(s, p).some((t) => t.uid === targetUid);
      return fail(blocked ? 'Ein Diener mit Spott steht im Weg!' : 'Ungültiges Ziel.');
    }
    attacker.attacksMade++;
    E.event(s, { type: 'attack', from: attacker.uid, to: target.uid });
    E.log(s, `${attacker.name} greift ${target.name} an.`, 'attack');
    const counter = target.kind === 'minion' ? target.attack : 0;
    E.damage(s, target, attacker.attack);
    if (counter > 0) E.damage(s, attacker, counter);
    resolveDeaths(s);
    return { ok: true };
  }

  function startTurn(s) {
    const pl = s.players[s.current];
    pl.maxMana = Math.min(MAX_MANA, pl.maxMana + 1);
    pl.mana = pl.maxMana;
    pl.powerUsed = false;
    for (const m of pl.board) { m.sleeping = false; m.attacksMade = 0; }
    E.log(s, `— Zug ${s.turn}: ${pl.name} —`, 'turn');
    E.draw(s, s.current, 1);
    resolveDeaths(s);
  }

  function endTurn(s, p) {
    if (s.winner !== null || s.current !== p) return fail('Nicht am Zug.');
    const pl = s.players[p];
    for (const m of pl.board.slice()) {
      const c = CARDS[m.id];
      if (c.endOfTurn && m.health > 0) c.endOfTurn({ state: s, me: p, self: m, target: null, E });
    }
    resolveDeaths(s);
    if (s.winner !== null) return { ok: true };
    // Eingefrorene Charaktere tauen am Ende des eigenen Zuges auf (sie haben ihren Angriff verpasst).
    for (const c of E.friendlyChars(s, p)) c.frozen = false;
    s.current = 1 - p;
    s.turn++;
    startTurn(s);
    return { ok: true };
  }

  /** Einheitlicher Einstieg für UI und KI. */
  function apply(s, action) {
    const p = s.current;
    switch (action.type) {
      case 'play': return playCard(s, p, action.card, action.target);
      case 'power': return usePower(s, p, action.target);
      case 'attack': return attack(s, p, action.attacker, action.target);
      case 'end': return endTurn(s, p);
      default: return fail('Unbekannte Aktion.');
    }
  }

  /** Alle legalen Aktionen des aktuellen Spielers (ohne Zugende). */
  function legalActions(s) {
    const p = s.current;
    const pl = s.players[p];
    const out = [];
    if (s.winner !== null) return out;
    for (const hc of pl.hand) {
      if (!canPlay(s, p, hc)) continue;
      const c = cardDef(hc);
      if (needsTarget(s, p, c)) validTargets(s, p, c.target, c.targetFilter).forEach((t) => out.push({ type: 'play', card: hc.uid, target: t.uid }));
      else out.push({ type: 'play', card: hc.uid });
    }
    if (canUsePower(s, p)) {
      if (CLASSES[pl.classId].power.target) powerTargets(s, p).forEach((t) => out.push({ type: 'power', target: t.uid }));
      else out.push({ type: 'power' });
    }
    for (const m of pl.board) {
      if (!canAttack(s, m)) continue;
      attackTargets(s, p).forEach((t) => out.push({ type: 'attack', attacker: m.uid, target: t.uid }));
    }
    return out;
  }

  function makeHero(p, classId) {
    const cls = CLASSES[classId];
    return { uid: 'h' + p, kind: 'hero', owner: p, name: cls.hero, health: HERO_HEALTH, maxHealth: HERO_HEALTH, armor: 0, attack: 0, frozen: false };
  }

  /**
   * opts: { mode: 'pvc'|'pvp', players: [{ name, classId, isAI, difficulty }, …] }
   */
  function newGame(opts) {
    const s = {
      mode: opts.mode, turn: 1, current: 0, winner: null, nextUid: 1, log: [], events: [],
      players: opts.players.map((o, i) => ({
        idx: i, name: o.name, classId: o.classId, isAI: !!o.isAI, difficulty: o.difficulty || 'normal',
        hero: makeHero(i, o.classId), maxMana: 0, mana: 0, deck: CG.buildDeck(o.classId), hand: [], board: [], fatigue: 0, powerUsed: false,
      })),
    };
    const first = Math.random() < 0.5 ? 0 : 1;
    s.current = first;
    E.draw(s, first, 3);
    E.draw(s, 1 - first, 4);
    s.players[1 - first].hand.push({ uid: E.newUid(s), id: 'coin' });
    E.log(s, `${s.players[first].name} beginnt. ${s.players[1 - first].name} erhält die Münze.`, 'turn');
    s.events = [];
    startTurn(s);
    s.events = [];
    return s;
  }

  CG.Engine = {
    E, MAX_BOARD, MAX_HAND, MAX_MANA,
    newGame, apply, legalActions, validTargets, needsTarget, canPlay, playTargets,
    canUsePower, powerTargets, canAttack, attackTargets, clone: (s) => structuredClone(s),
  };
})(globalThis);
