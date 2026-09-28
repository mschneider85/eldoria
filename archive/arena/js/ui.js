/*
 * Benutzeroberfläche: Menü, Rendering des Spielfelds, Eingaben, Animationen
 * und die Steuerung des Computergegners.
 */
(function () {
  'use strict';
  const { Engine, AI, CARDS, CLASSES } = window.CG;
  const E = Engine.E;

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CLASS_IDS = Object.keys(CLASSES);
  const NEUTRAL_COLOR = '#8b7355';

  const settings = { mode: 'pvc', picks: ['mage', 'random'], difficulty: 'normal' };
  let state = null;
  const ui = {
    viewer: 0,          // Spieler, der unten sitzt
    selected: null,     // { type: 'card'|'attack'|'power', uid, targets: Set }
    busy: false,        // Animation / KI läuft
    handHidden: false,  // Hot-Seat: Hand verdeckt bis "Bereit"
    known: new Set(),   // bereits gerenderte Diener (für Einblend-Animation)
    mouse: { x: 0, y: 0 },
  };

  /* =============================================================== Menü */
  function renderMenu() {
    document.querySelectorAll('.heroes').forEach((box) => {
      const p = Number(box.dataset.player);
      const options = [...CLASS_IDS, ...(p === 1 ? ['random'] : [])];
      box.innerHTML = options.map((id) => {
        const cls = CLASSES[id];
        const active = settings.picks[p] === id ? ' active' : '';
        if (!cls) {
          return `<button class="hero-pick${active}" data-pick="${id}" style="--cls:#555">
            <div class="face">🎲</div><div class="cname">Zufall</div><div class="pname">Überraschung</div></button>`;
        }
        return `<button class="hero-pick${active}" data-pick="${id}" style="--cls:${cls.color}" title="${cls.power.name}: ${cls.power.text}">
          <div class="face">${cls.portrait}</div><div class="cname">${cls.name}</div><div class="pname">${cls.power.icon} ${cls.power.name}</div></button>`;
      }).join('');
    });
    const pvc = settings.mode === 'pvc';
    $('#p1-label').textContent = pvc ? 'Dein Held' : 'Spieler 1';
    $('#p2-label').textContent = pvc ? 'Computergegner' : 'Spieler 2';
    $('#difficulty-row').classList.toggle('hidden', !pvc);
    document.querySelectorAll('#mode-select button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
    document.querySelectorAll('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === settings.difficulty));
  }

  function initMenu() {
    $('#mode-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.mode = b.dataset.mode; renderMenu();
    });
    $('#difficulty-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.difficulty = b.dataset.diff; renderMenu();
    });
    document.querySelectorAll('.heroes').forEach((box) => box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      settings.picks[Number(box.dataset.player)] = b.dataset.pick; renderMenu();
    }));
    $('#start-btn').addEventListener('click', startGame);
    $('#rules-btn').addEventListener('click', showRules);
    renderMenu();
  }

  /* =============================================================== Spielstart */
  function startGame() {
    const cls = (i) => (settings.picks[i] === 'random' ? E.random(CLASS_IDS) : settings.picks[i]);
    const pvc = settings.mode === 'pvc';
    const players = pvc
      ? [{ name: 'Du', classId: cls(0) }, { name: 'Computer', classId: cls(1), isAI: true, difficulty: settings.difficulty }]
      : [{ name: 'Spieler 1', classId: cls(0) }, { name: 'Spieler 2', classId: cls(1) }];
    state = Engine.newGame({ mode: settings.mode, players });
    ui.selected = null; ui.busy = false; ui.known = new Set();
    ui.viewer = pvc ? 0 : state.current;
    ui.handHidden = !pvc;
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    closeOverlay();
    render();
    onTurnStart();
  }

  function toMenu() {
    state = null;
    closeOverlay();
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
    renderMenu();
  }

  const isAITurn = () => state && state.winner === null && state.players[state.current].isAI;
  const isHumanTurn = () => state && state.winner === null && !state.players[state.current].isAI && state.current === ui.viewer && !ui.handHidden;

  function onTurnStart() {
    if (state.winner !== null) return;
    const pl = state.players[state.current];
    if (pl.isAI) { runAI(); return; }
    if (state.mode === 'pvp') {
      ui.viewer = state.current;
      ui.handHidden = true;
      render();
      showHandover();
    } else {
      banner('Dein Zug');
    }
  }

  function showHandover() {
    const pl = state.players[state.current];
    const cls = CLASSES[pl.classId];
    openOverlay(`<div class="modal">
      <div class="big-emoji">${cls.portrait}</div>
      <h2>${pl.name} ist am Zug</h2>
      <p>${cls.hero} (${cls.name})<br><span style="color:var(--muted)">Gib das Gerät weiter – der Gegner sollte nicht hinschauen.</span></p>
      <div class="buttons"><button class="btn-primary" id="ready-btn">Bereit</button></div></div>`);
    $('#ready-btn').addEventListener('click', () => {
      closeOverlay();
      ui.handHidden = false;
      render();
      banner(`${pl.name}: Dein Zug`);
    });
  }

  /* =============================================================== Aktionen */
  async function perform(action) {
    ui.busy = true;
    clearSelection();
    if (action.type === 'attack') await lunge(action.attacker);
    const before = state.current;
    const res = Engine.apply(state, action);
    if (!res.ok) {
      toast(res.error);
      ui.busy = false;
      render();
      return false;
    }
    await playEvents();
    ui.busy = false;
    render();
    if (state.winner !== null) { await sleep(600); showGameOver(); return true; }
    if (state.current !== before) onTurnStart();
    return true;
  }

  async function runAI() {
    ui.busy = true;
    render();
    await sleep(900);
    while (isAITurn()) {
      const p = state.current;
      const action = AI.decide(state, p);
      if (action.type === 'play') {
        const hc = state.players[p].hand.find((h) => h.uid === action.card);
        const target = action.target ? E.findChar(state, action.target) : null;
        await revealCard(CARDS[hc.id], target ? `→ ${target.name}` : '');
      } else if (action.type === 'power') {
        const el = document.querySelector(`[data-power="${p}"]`);
        if (el) { el.classList.add('flash'); await sleep(450); }
      }
      const ok = await perform(action);
      if (!ok) await perform({ type: 'end' }); // Sicherheitsnetz, sollte nie passieren
      if (action.type === 'end') break;
      ui.busy = true;
      await sleep(action.type === 'attack' ? 450 : 600);
    }
  }

  /* =============================================================== Eingabe */
  function select(sel, sourceEl) {
    ui.selected = sel;
    ui.selected.sourceEl = sourceEl;
    render();
  }

  function clearSelection() {
    ui.selected = null;
    $('#arrow').classList.add('hidden');
  }

  function onClick(e) {
    if (!state || ui.busy || $('#game').classList.contains('hidden')) return;
    if (e.target.closest('.sidebar')) return;
    if (!isHumanTurn()) return;
    const p = state.current;

    const charEl = e.target.closest('[data-uid]');
    // 1) Ziel für aktuelle Auswahl
    if (ui.selected && charEl && ui.selected.targets.has(charEl.dataset.uid)) {
      const t = charEl.dataset.uid;
      const s = ui.selected;
      if (s.type === 'card') perform({ type: 'play', card: s.uid, target: t });
      else if (s.type === 'attack') perform({ type: 'attack', attacker: s.uid, target: t });
      else if (s.type === 'power') perform({ type: 'power', target: t });
      return;
    }

    // 2) Handkarte
    const cardEl = e.target.closest('[data-hand]');
    if (cardEl) {
      const uid = cardEl.dataset.hand;
      if (ui.selected && ui.selected.uid === uid) { clearSelection(); render(); return; }
      const hc = state.players[p].hand.find((h) => h.uid === uid);
      const c = CARDS[hc.id];
      if (!Engine.canPlay(state, p, hc)) {
        if (c.cost > state.players[p].mana) toast('Nicht genug Mana.');
        else if (state.players[p].board.length >= Engine.MAX_BOARD) toast('Dein Spielfeld ist voll.');
        else toast('Kein gültiges Ziel vorhanden.');
        return;
      }
      const targets = Engine.playTargets(state, p, hc);
      if (targets.length) select({ type: 'card', uid, targets: new Set(targets.map((t) => t.uid)) }, cardEl);
      else perform({ type: 'play', card: uid });
      return;
    }

    // 3) Heldenfähigkeit
    const powerEl = e.target.closest('[data-power]');
    if (powerEl && Number(powerEl.dataset.power) === p) {
      if (ui.selected && ui.selected.type === 'power') { clearSelection(); render(); return; }
      if (!Engine.canUsePower(state, p)) {
        toast(state.players[p].powerUsed ? 'Heldenfähigkeit schon benutzt.' : 'Nicht genug Mana.');
        return;
      }
      const targets = Engine.powerTargets(state, p);
      if (CLASSES[state.players[p].classId].power.target) select({ type: 'power', uid: 'power', targets: new Set(targets.map((t) => t.uid)) }, powerEl);
      else perform({ type: 'power' });
      return;
    }

    // 4) Eigener Diener → Angriff
    if (charEl) {
      const m = state.players[p].board.find((x) => x.uid === charEl.dataset.uid);
      if (m) {
        if (ui.selected && ui.selected.uid === m.uid) { clearSelection(); render(); return; }
        if (Engine.canAttack(state, m)) {
          const targets = Engine.attackTargets(state, p);
          select({ type: 'attack', uid: m.uid, targets: new Set(targets.map((t) => t.uid)) }, charEl);
        } else if (m.frozen) toast(`${m.name} ist eingefroren.`);
        else if (m.sleeping && !m.charge) toast(`${m.name} muss einen Zug warten.`);
        else if (m.attack <= 0) toast(`${m.name} hat keinen Angriff.`);
        else toast(`${m.name} hat schon angegriffen.`);
        return;
      }
      if (ui.selected && ui.selected.type === 'attack') {
        const enemyTaunt = state.players[1 - p].board.some((x) => x.taunt);
        toast(enemyTaunt ? 'Ein Diener mit Spott steht im Weg!' : 'Ungültiges Ziel.');
        return;
      }
    }

    // 5) Irgendwo anders → Auswahl aufheben
    if (ui.selected) { clearSelection(); render(); }
  }

  function initInput() {
    document.addEventListener('click', onClick);
    document.addEventListener('contextmenu', (e) => {
      if (ui.selected) { e.preventDefault(); clearSelection(); render(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ui.selected) { clearSelection(); render(); }
    });
    document.addEventListener('mousemove', (e) => {
      ui.mouse = { x: e.clientX, y: e.clientY };
      updateArrow();
    });
    document.addEventListener('mouseover', onHover);
    $('#end-turn').addEventListener('click', () => {
      if (isHumanTurn() && !ui.busy) perform({ type: 'end' });
    });
    $('#menu-btn').addEventListener('click', () => {
      openOverlay(`<div class="modal"><h2>Spiel verlassen?</h2><p>Die aktuelle Partie geht verloren.</p>
        <div class="buttons"><button class="btn-secondary" data-close>Weiterspielen</button><button class="btn-primary" id="leave-btn">Zum Menü</button></div></div>`);
      $('#leave-btn').addEventListener('click', toMenu);
    });
    $('#help-btn').addEventListener('click', showRules);
    window.addEventListener('resize', updateArrow);
  }

  function updateArrow() {
    const arrow = $('#arrow');
    const s = ui.selected;
    if (!s || !s.sourceEl || !document.body.contains(s.sourceEl)) { arrow.classList.add('hidden'); return; }
    const r = s.sourceEl.getBoundingClientRect();
    const line = arrow.querySelector('line');
    line.setAttribute('x1', r.left + r.width / 2);
    line.setAttribute('y1', r.top + r.height / 2);
    line.setAttribute('x2', ui.mouse.x);
    line.setAttribute('y2', ui.mouse.y);
    arrow.classList.remove('hidden');
  }

  /* =============================================================== Vorschau */
  function onHover(e) {
    const prev = $('#preview');
    if (!state || $('#game').classList.contains('hidden')) { prev.classList.add('hidden'); return; }
    const powerEl = e.target.closest('[data-power]');
    const minEl = e.target.closest('.minion[data-uid]');
    if (powerEl) {
      const cls = CLASSES[state.players[Number(powerEl.dataset.power)].classId];
      const pw = cls.power;
      prev.innerHTML = cardHTML({ name: pw.name, cost: pw.cost, art: pw.icon, text: pw.text, type: 'spell', cls: cls.id }, { tag: 'Heldenfähigkeit' });
      prev.classList.remove('hidden');
    } else if (minEl) {
      const m = E.findChar(state, minEl.dataset.uid);
      if (!m) return;
      prev.innerHTML = cardHTML(CARDS[m.id], { minion: m });
      prev.classList.remove('hidden');
    } else {
      prev.classList.add('hidden');
    }
  }

  /* =============================================================== Rendering */
  function classColor(cls) { return CLASSES[cls] ? CLASSES[cls].color : NEUTRAL_COLOR; }

  function cardHTML(c, opt = {}) {
    const classes = ['card', 'card-' + c.type];
    if (opt.playable) classes.push('playable');
    if (opt.selected) classes.push('selected');
    const m = opt.minion;
    const atk = m ? m.attack : c.attack;
    const hp = m ? m.health : c.health;
    const stats = c.type === 'minion'
      ? `<div class="stat attack${m && m.attack > c.attack ? ' buffed' : ''}">${atk}</div>
         <div class="stat health${m && m.health < m.maxHealth ? ' damaged' : m && m.maxHealth > c.health ? ' buffed' : ''}">${hp}</div>`
      : `<div class="tag">${opt.tag || 'Zauber'}</div>`;
    const clsTag = CLASSES[c.cls] ? `<div class="cls-tag">${CLASSES[c.cls].name}</div>` : '';
    const style = opt.style ? ` ${opt.style}` : '';
    return `<div class="${classes.join(' ')}" ${opt.attrs || ''} style="--cls:${classColor(c.cls)};${style}">
      <div class="cost">${c.cost}</div>${clsTag}
      <div class="art">${c.art}</div>
      <div class="name">${c.name}</div>
      <div class="text${c.text ? '' : ' empty'}"><span>${c.text || ''}</span></div>
      ${stats}</div>`;
  }

  function targetClass(uid, ownerIsViewer) {
    const s = ui.selected;
    if (!s || !s.targets.has(uid)) return '';
    return ' targetable' + (ownerIsViewer ? ' friendly-target' : '');
  }

  function heroRowHTML(p) {
    const pl = state.players[p];
    const cls = CLASSES[pl.classId];
    const h = pl.hero;
    const mine = p === ui.viewer;
    const myTurn = isHumanTurn() && state.current === p;
    const powerUsable = myTurn && Engine.canUsePower(state, p);
    const powerSel = ui.selected && ui.selected.type === 'power' && mine;
    let crystals = '';
    for (let i = 0; i < Engine.MAX_MANA; i++) {
      crystals += `<span class="crystal ${i < pl.mana ? 'full' : i < pl.maxMana ? 'spent' : ''}"></span>`;
    }
    const heroHTML = `<div class="hero${h.frozen ? ' frozen' : ''}${targetClass(h.uid, mine)}" data-uid="${h.uid}" style="--cls:${cls.color}">
        <div class="portrait">${cls.portrait}</div>
        ${h.armor > 0 ? `<div class="stat armor">${h.armor}</div>` : ''}
        <div class="stat health${h.health < h.maxHealth ? ' damaged' : ''}">${h.health}</div>
        <div class="hero-name">${pl.name === 'Du' ? cls.hero : pl.name + ' · ' + cls.name}</div>
      </div>`;
    const powerHTML = `<div class="power${pl.powerUsed ? ' used' : ''}${powerUsable ? ' usable' : ''}${powerSel ? ' selected' : ''}" data-power="${p}">
        <div class="cost">${cls.power.cost}</div>${cls.power.icon}</div>`;
    const manaHTML = `<div class="mana-box">
        <div class="mana-text">💎 ${pl.mana}/${pl.maxMana}</div>
        <div class="crystals">${crystals}</div>
        <div class="deck-count">🂠 Deck: ${pl.deck.length} · ✋ ${pl.hand.length}</div>
      </div>`;
    return `${manaHTML}${heroHTML}${powerHTML}`;
  }

  function boardHTML(p) {
    const pl = state.players[p];
    const mine = p === ui.viewer;
    const myTurn = isHumanTurn() && state.current === p;
    return pl.board.map((m) => {
      const c = CARDS[m.id];
      const cl = ['minion'];
      if (m.taunt) cl.push('taunt');
      if (m.divineShield) cl.push('shield');
      if (m.frozen) cl.push('frozen');
      if (m.sleeping && !m.charge) cl.push('sleeping');
      if (myTurn && Engine.canAttack(state, m)) cl.push('can-attack');
      if (ui.selected && ui.selected.uid === m.uid) cl.push('selected');
      if (!ui.known.has(m.uid)) cl.push('enter');
      const badges = [
        m.sleeping && !m.charge && state.current === p ? '💤' : '',
        m.frozen ? '❄️' : '',
        m.windfury ? '🌀' : '',
        m.charge ? '⚡' : '',
        c.deathrattle ? '💀' : '',
        c.endOfTurn ? '⏳' : '',
      ].join('');
      return `<div class="${cl.join(' ')}${targetClass(m.uid, mine)}" data-uid="${m.uid}" style="--cls:${classColor(c.cls)}">
          <div class="badges">${badges}</div>
          <div class="art">${c.art}</div>
          <div class="stat attack${m.attack > c.attack ? ' buffed' : ''}">${m.attack}</div>
          <div class="stat health${m.health < m.maxHealth ? ' damaged' : m.maxHealth > c.health ? ' buffed' : ''}">${m.health}</div>
        </div>`;
    }).join('');
  }

  function myHandHTML(p) {
    const pl = state.players[p];
    const n = pl.hand.length;
    if (ui.handHidden) return pl.hand.map(() => '<div class="card-back"></div>').join('');
    const myTurn = isHumanTurn() && state.current === p;
    return pl.hand.map((hc, i) => {
      const off = i - (n - 1) / 2;
      const overlap = n > 6 ? -0.14 : n > 4 ? -0.07 : 0.02;
      const style = `--rot:${off * 3}deg;--lift:${Math.abs(off) * Math.abs(off) * 1.4}px;--overlap:${overlap};z-index:${i + 1}`;
      return cardHTML(CARDS[hc.id], {
        playable: myTurn && Engine.canPlay(state, p, hc),
        selected: ui.selected && ui.selected.uid === hc.uid,
        attrs: `data-hand="${hc.uid}"`,
        style,
      });
    }).join('');
  }

  function render() {
    if (!state) return;
    const me = ui.viewer;
    const op = 1 - me;
    $('#opp-hand').innerHTML = state.players[op].hand.map(() => '<div class="card-back"></div>').join('');
    $('#opp-hero-row').innerHTML = heroRowHTML(op);
    $('#opp-board').innerHTML = boardHTML(op);
    $('#my-board').innerHTML = boardHTML(me);
    $('#my-hero-row').innerHTML = heroRowHTML(me);
    const hand = $('#my-hand');
    hand.innerHTML = myHandHTML(me);
    hand.classList.toggle('hidden-hand', ui.handHidden);
    ui.known = new Set(E.allMinions(state).map((m) => m.uid));

    // Auswahl-Quelle nach dem Neuzeichnen wiederfinden (für den Zielpfeil)
    if (ui.selected) {
      const s = ui.selected;
      s.sourceEl = s.type === 'card' ? document.querySelector(`[data-hand="${s.uid}"]`)
        : s.type === 'power' ? document.querySelector(`[data-power="${me}"]`)
          : document.querySelector(`[data-uid="${s.uid}"]`);
    }
    updateArrow();
    renderSidebar();
  }

  function renderSidebar() {
    const btn = $('#end-turn');
    const human = isHumanTurn();
    btn.disabled = !human || ui.busy;
    btn.textContent = state.winner !== null ? 'Spiel vorbei' : human ? 'Zug beenden' : isAITurn() ? 'Gegner am Zug…' : 'Warte…';
    btn.classList.toggle('ready', human && !ui.busy && Engine.legalActions(state).length === 0);

    let hint = '';
    if (ui.selected) {
      hint = ui.selected.type === 'attack' ? '<b>Wähle ein Angriffsziel.</b><br>Rechtsklick/Esc: abbrechen' : '<b>Wähle ein Ziel.</b><br>Rechtsklick/Esc: abbrechen';
    } else if (human) {
      hint = 'Spiele Karten aus deiner Hand oder greife mit grün leuchtenden Dienern an.';
    } else if (isAITurn()) {
      hint = 'Der Computer denkt nach…';
    }
    $('#hint').innerHTML = hint;

    $('#log').innerHTML = state.log.slice(-60).reverse().map((l) => `<div class="log-${l.kind}">${escapeHTML(l.text)}</div>`).join('');
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /* =============================================================== Effekte */
  function elFor(uid) { return document.querySelector(`[data-uid="${uid}"]`); }

  function floatAt(el, text, kind) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = `float ${kind}`;
    f.textContent = text;
    f.style.left = r.left + r.width / 2 + 'px';
    f.style.top = r.top + r.height / 2 + 'px';
    $('#fx').appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  async function playEvents() {
    const evs = state.events.splice(0);
    let impact = false;
    let deaths = false;
    for (const ev of evs) {
      const el = ev.uid ? elFor(ev.uid) : null;
      switch (ev.type) {
        case 'damage':
          floatAt(el, `-${ev.amount}`, 'dmg');
          if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
          impact = true; break;
        case 'heal': floatAt(el, `+${ev.amount}`, 'heal'); impact = true; break;
        case 'shield': floatAt(el, 'Geblockt!', 'info'); impact = true; break;
        case 'armor': floatAt(el, `+${ev.amount} 🛡️`, 'info'); break;
        case 'freeze': floatAt(el, '❄️', 'info'); break;
        case 'death': case 'destroy': if (el) { el.classList.add('dying'); deaths = true; } break;
        default: break;
      }
    }
    if (deaths) await sleep(480);
    else if (impact) await sleep(260);
  }

  async function lunge(attackerUid) {
    const el = elFor(attackerUid);
    if (!el) return;
    const up = el.closest('#my-board') !== null;
    el.classList.add(up ? 'lunge-up' : 'lunge-down');
    await sleep(200);
    el.classList.remove('lunge-up', 'lunge-down');
  }

  async function revealCard(card, caption) {
    const div = document.createElement('div');
    div.className = 'reveal';
    div.innerHTML = cardHTML(card) + `<div class="caption">${caption || ''}</div>`;
    document.body.appendChild(div);
    await sleep(1150);
    div.remove();
  }

  function banner(text) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1450);
  }

  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  /* =============================================================== Overlays */
  function openOverlay(html) {
    const o = $('#overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
    o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
  }
  function closeOverlay() { $('#overlay').classList.add('hidden'); $('#overlay').innerHTML = ''; }

  function showRules() {
    openOverlay($('#rules-tpl').innerHTML);
  }

  function showGameOver() {
    const w = state.winner;
    let title, emoji, text;
    if (w === -1) { title = 'Unentschieden'; emoji = '🤝'; text = 'Beide Helden sind gefallen.'; }
    else if (state.mode === 'pvc') {
      const won = w === 0;
      title = won ? 'Sieg!' : 'Niederlage';
      emoji = won ? '🏆' : '💀';
      text = won ? 'Der Computer wurde besiegt.' : 'Der Computer war diesmal stärker.';
    } else {
      const pl = state.players[w];
      title = `${pl.name} gewinnt!`;
      emoji = CLASSES[pl.classId].portrait;
      text = `${CLASSES[pl.classId].hero} triumphiert.`;
    }
    openOverlay(`<div class="modal"><div class="big-emoji">${emoji}</div><h2>${title}</h2><p>${text}<br><span style="color:var(--muted)">Nach ${state.turn} Zügen</span></p>
      <div class="buttons"><button class="btn-secondary" id="go-menu">Hauptmenü</button><button class="btn-primary" id="go-again">Revanche</button></div></div>`);
    $('#go-menu').addEventListener('click', toMenu);
    $('#go-again').addEventListener('click', startGame);
    renderSidebar();
  }

  initMenu();
  initInput();
})();
