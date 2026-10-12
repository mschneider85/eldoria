/*
 * Oberfläche und Spielablauf-Steuerung (Menü, Runden, Karten, Animationen, Fenster).
 * Ausgelagert: Kartenbild-Effekte (art-fx.js), Duell (ui-duel.js), Eingaben (ui-input.js), Online (ui-online.js).
 */
(function () {
  'use strict';
  const { Engine, AI, CARDS, FACTIONS, STATS, STAT_IDS, TERRAINS, ABILITIES } = window.CG;
  const Snd = window.CG.Audio;
  const Net = window.CG.Net;
  const ArtFX = window.CG.ArtFX;

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`eq-${k}`); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`eq-${k}`, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } },
  };
  const settings = { mode: store.get('mode', 'pvc') === 'online' ? 'online' : 'pvc', difficulty: store.get('difficulty', 'normal') };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Bewegte Bildeffekte: bei Ruckeln stufenweise weniger (watchFrames) – 0 alle Teilchen, 1 halb so viele, 2 keine
  let fxAuto = store.get('fx-auto', 0);
  const fxLevel = () => (reducedMotion ? 2 : fxAuto);
  let s = null;
  let pendingInvite = null; // Einladungslink, der während einer Partie kam – öffnet sich im Menü
  const ui = {
    chooser: null,     // 0, sobald deine Hand offen liegt und du wählen kannst (null: noch nicht/gerade nicht)
    selected: null,    // gewählte Handkarte
    rallying: false,   // Schlachtruf läuft gerade (Karten fliegen in den Stapel und zurück)
    revealed: false,   // Karten im Schlachtfeld aufgedeckt
    showResult: false, // Werte / Sieger anzeigen
    fly: null,         // Karten fliegen gerade zum Stapel
    deckBefore: [0, 0],// Stapelgrößen vor dem Duell (bis die Beute sichtbar ankommt)
    deckShown: null,   // angezeigte Stapelgrößen während der Animationen
    pendingDraw: [[], []], // nachgezogene Karten, die noch ins Blatt fliegen sollen
    oppOrder: [],      // Reihenfolge der verdeckten Gegnerkarten, wie sie gerade angezeigt werden
    oppIncoming: new Set(), // Gegnerkarten, die noch vom Stapel unterwegs sind
    potShown: null,    // angezeigte Kriegsbeute während der Animationen
    choosing: false,   // eigene Karte fliegt gerade aufs Spielfeld
    tossing: false,    // Münzwurf auf einem Wahlfeld läuft noch
    presenting: false, // Ergebnis wird noch vorgeführt (Quartett-Tafeln) – „Weiter“ wartet
    duel: null,        // Duell Schritt für Schritt: { steps, k (so viele gezeigt), done, skip }
    hoverHold: false,  // Maus liegt auf dem Schlachtfeld oder dem Ergebnis – der Countdown wartet
    autoOff: false,    // nach dem Duell irgendwo geklickt oder getippt – kein automatisches „Weiter“ in dieser Runde
    stall: null,       // online: so viele Sekunden lässt der Gegner schon auf seinen Zug warten (ab dem Hinweis)
    silent: null,      // online: so viele Sekunden ist die Verbindung schon gestört (nichts kommt an, in eine der Richtungen)
    message: '',
    token: 0,          // bricht laufende Abläufe ab, wenn ein neues Spiel startet
  };

  const pvc = () => s.mode === 'pvc';
  const online = () => s.mode === 'online';
  const isAI = (p) => s.players[p].isAI;
  const isRemote = (p) => online() && p === 1;
  /** „Der Computer“ oder der Name des Online-Gegners. */
  const oppName = () => (pvc() ? 'Der Computer' : escapeHTML(s.players[1].name));

  /* =============================================================== Menü */
  function renderMenu() {
    document.querySelectorAll('#mode-select button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
    document.querySelectorAll('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === settings.difficulty));
    $('#difficulty-row').classList.toggle('hidden', settings.mode !== 'pvc');
    $('#names-row').classList.toggle('hidden', settings.mode !== 'online');
  }

  /** Menü-Schaufenster: der Dunkelwald als fester Hintergrund, bei jedem Besuch drei andere Karten. */
  function renderMenuShowcase() {
    const pick = (arr, n) => CG_shuffle(arr.slice()).slice(0, n);
    $('#menu-bg').style.backgroundImage = 'url(art/terrains/forest.menu.webp)';
    const ids = pick(Object.keys(CARDS), 3);
    $('#menu-cards').innerHTML = ids.map((id) => cardHTML(id, { neutral: true, thumb: true })).join('');
  }
  const CG_shuffle = window.CG.shuffle;

  /**
   * Glühwürmchen im Menü: jedes mit eigener Größe, Flugbahn, Geschwindigkeit und eigenem Leuchtrhythmus.
   * Nur im oberen Teil – unten auf der Lichtung grast das Reh (js/deer.js).
   */
  function createFireflies(count = 60) {
    const box = $('#fireflies');
    if (!box || box.childElementCount) return;
    const r = (a, b) => a + Math.random() * (b - a);
    const html = [];
    for (let i = 0; i < count; i++) {
      const near = Math.random() < 0.18; // einige wirken näher: größer und unscharf
      const size = near ? r(12, 18) : r(3.5, 7);
      html.push(`<span class="fly${near ? ' near' : ''}" style="--x:${r(2, 98).toFixed(1)}%; --y:${r(6, 66).toFixed(1)}%; --s:${size.toFixed(1)}px;
        --dx1:${r(-90, 90).toFixed(0)}px; --dy1:${r(-70, 50).toFixed(0)}px; --dx2:${r(-90, 90).toFixed(0)}px; --dy2:${r(-90, 40).toFixed(0)}px;
        --move:${r(14, 26).toFixed(1)}s; --glow:${r(2.2, 4.8).toFixed(1)}s; --delay:${r(-26, 0).toFixed(1)}s"></span>`);
    }
    box.innerHTML = html.join('');
  }

  function initMenu() {
    $('#mode-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.mode = b.dataset.mode; store.set('mode', settings.mode); renderMenu();
    });
    $('#difficulty-select').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      settings.difficulty = b.dataset.diff; store.set('difficulty', settings.difficulty); renderMenu();
    });
    // Einladungslink (…#spiel=CODE): nach dem Betreten gleich die Lobby zum Beitreten öffnen
    let invite = Net.codeFromLink();
    const clearLink = () => history.replaceState(null, '', location.pathname + location.search);
    if (invite) {
      clearLink();
      settings.mode = 'online';
      $('#intro-btn').textContent = 'Einladung annehmen';
    }
    $('#intro-btn').addEventListener('click', () => {
      Snd.unlock();
      $('#menu').classList.remove('intro-open');
      setTimeout(() => $('#intro').remove(), 700); // nach dem Ausblenden
      if (invite) { UI.openLobby(invite); invite = null; }
    });
    // Link in einem schon offenen Tab eingefügt: Die Seite lädt dann nicht neu
    window.addEventListener('hashchange', () => {
      const code = Net.codeFromLink();
      if (!code) return;
      clearLink();
      if ($('#intro')) { invite = code; return; }
      if (s) {
        // Mitten in einer Partie nicht einfach wechseln – die Einladung gilt, sobald man im Menü ist
        pendingInvite = code;
        toast('Einladung erhalten – sie öffnet sich, sobald du im Hauptmenü bist.');
        return;
      }
      settings.mode = 'online';
      renderMenu();
      UI.openLobby(code);
    });
    $('#start-btn').addEventListener('click', startGame);
    $('#rules-btn').addEventListener('click', showRules);
    $('#gallery-btn').addEventListener('click', () => showGallery('cards'));
    renderMenuShowcase();
    createFireflies();
    const name = store.get('name', null) || (store.get('names', null) || [])[0]; // 'names': früher eine Liste (zwei Spieler an einem Gerät)
    if (name) $('#name1').value = name;
    // Alle Bilder im Hintergrund vorladen, damit beim ersten Aufdecken nichts nachlädt
    setTimeout(() => {
      [...Object.keys(CARDS).flatMap((id) => [`art/cards/${id}.webp`, `art/cards/${id}.thumb.webp`]),
        ...TERRAINS.flatMap((t) => [`art/terrains/${t.id}.webp`, `art/terrains/${t.id}.thumb.webp`])]
        .forEach((src) => { const img = new Image(); img.decoding = 'async'; img.src = src; });
    }, 300);
    renderMenu();
  }

  /* =============================================================== Ablauf */
  function startGame() {
    if (settings.mode === 'online') { store.set('name', $('#name1').value.trim()); UI.openLobby(); return; }
    launch({ mode: 'pvc', players: [{ name: 'Du', you: true }, { name: 'Computer', isAI: true, difficulty: settings.difficulty }] });
  }

  function launch(opts) {
    s = Engine.newGame(opts);
    ui.token++;
    UI.wakeRemote();
    clearEffects();
    ui.pendingDraw = s.players.map((pl) => pl.hand.slice());
    // Reste einer abgebrochenen Partie (laufende Flüge schreiben sonst in die neue)
    Object.assign(ui, { deckShown: null, potShown: null, choosing: false, hoverHold: false, oppIncoming: new Set() });
    closeAllOverlays();
    $('#menu').classList.add('hidden');
    $('#game').classList.remove('hidden');
    if (online()) UI.watchStall(ui.token);
    beginRound();
  }

  /** Laufende Flüge und Einblendungen beenden (beim Verlassen oder Neustart einer Partie). */
  function clearEffects() {
    document.querySelectorAll('.ghost, .quartet-show, .coin-toss, .toast').forEach((el) => el.remove());
  }

  function toMenu() {
    if (s && online()) Net.bye({ t: 'bye' });
    ui.token++;
    UI.wakeRemote();
    clearEffects();
    renderMenuShowcase();
    Snd.setMood('menu');
    s = null;
    closeAllOverlays();
    $('#game').classList.add('hidden');
    $('#menu').classList.remove('hidden');
    // Glühwürmchen neu anlegen: Ihre Animationen blieben nach dem ausgeblendeten Menü teils stehen (Safari)
    $('#fireflies').replaceChildren();
    createFireflies();
    if (pendingInvite) {
      const code = pendingInvite;
      pendingInvite = null;
      settings.mode = 'online';
      renderMenu();
      UI.openLobby(code);
    }
  }

  function resetRoundUI() {
    Object.assign(ui, { chooser: null, selected: null, rallying: false, revealed: false, showResult: false, presenting: false, duel: null, fly: null, tossing: false, message: '', aiWaiting: false, stall: null, silent: null });
  }

  async function beginRound() {
    const token = ui.token;
    resetRoundUI();
    ui.deckShown = null;
    ui.deckBefore = s.players.map((pl) => pl.deck.length);
    document.querySelectorAll('.slot').forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    render();
    Snd.play('terrain');
    Snd.setMood(s.terrain.id);
    if (ui.pendingDraw[1].length) {
      const ids = ui.pendingDraw[1];
      ui.pendingDraw[1] = [];
      ids.forEach((id) => ui.oppIncoming.add(id));
      $('#opp-hand')._html = null;
      render();
      drawOpp(ids);
    }
    if (s.phase === 'stat') {
      const picker = s.picker;
      ui.tossing = true;
      ui.chooser = 0; // eigene Hand schon zeigen (gesperrt)
      render();
      await tossCoin(picker);
      if (token !== ui.token) return;
      ui.tossing = false;
      if (isAI(picker)) {
        ui.message = 'Der Computer überlegt…';
        render();
        await sleep(1100);
        if (!(await waitForOverlays(token))) return;
        Engine.chooseStat(s, picker, AI.chooseStat(s, picker));
        ui.message = `Der Computer wählt ${statLabel(s.stat)}.`;
        cardPhase();
      } else if (isRemote(picker)) {
        ui.message = `${oppName()} überlegt…`;
        render();
        const m = await UI.nextRemote(token, ['stat']);
        if (!m || !(await waitForOverlays(token))) return;
        if (!Engine.chooseStat(s, picker, m.stat).ok) { UI.outOfSync(); return; }
        ui.message = `${oppName()} wählt ${statLabel(s.stat)}.`;
        cardPhase();
      } else {
        ui.message = '';
        render();
      }
    } else {
      cardPhase();
    }
  }

  function onStatChosen(stat) {
    const picker = s.picker;
    if (!Engine.chooseStat(s, picker, stat).ok) return;
    if (online()) UI.sendMove({ t: 'stat', r: s.round, stat });
    ui.message = `Du wählst ${statLabel(stat)}.`; // wählen kann hier nur, wer an diesem Gerät sitzt
    cardPhase();
  }

  /** Kartenwahl: Du wählst unten, der Gegner (Computer oder online) legt verdeckt. */
  async function cardPhase() {
    const token = ui.token;
    ui.chooser = 0;
    render();
    if (online()) { remotePlays(token); return; }
    await sleep(700 + Math.random() * 900);
    if (!(await waitForOverlays(token))) return;
    if (AI.shouldRally(s, 1)) {
      await animateRally(1);
      await sleep(900);
      if (!(await waitForOverlays(token))) return;
    }
    // Kennt der Computer per Spion eine deiner Karten, legt er erst nach dir – so bleibt Zeit für den Schlachtruf als Konter
    if (s.spyInfo[1] && !s.choices[0]) {
      ui.aiWaiting = true;
      ui.message = 'Der Computer lauert…';
      render();
      return;
    }
    if (await aiPlays(token)) afterChoice();
  }

  /** Der Computer wählt und legt seine Karte. false, wenn die Partie inzwischen verlassen wurde. */
  async function aiPlays(token) {
    ui.aiWaiting = false;
    const c = AI.chooseCard(s, 1);
    await flyOppToSlot(c.card);
    if (token !== ui.token) return false;
    Engine.choose(s, 1, c.card);
    return true;
  }

  /** Online: Schlachtruf und Karte des Gegners kommen übers Netz und werden wie beim Computer gezeigt. */
  async function remotePlays(token) {
    for (;;) {
      const m = await UI.nextRemote(token, ['rally', 'choose']);
      if (!m || !(await waitForOverlays(token))) return;
      if (m.t === 'rally') {
        if (!(await animateRally(1))) { if (token === ui.token) UI.outOfSync(); return; }
        continue;
      }
      if (!s.players[1].hand.includes(m.card)) { UI.outOfSync(); return; }
      await flyOppToSlot(m.card);
      if (token !== ui.token) return;
      if (!Engine.choose(s, 1, m.card).ok) { UI.outOfSync(); return; }
      afterChoice();
      return;
    }
  }

  /** Der lauernde Computer ist dran, nachdem du gespielt oder den Schlachtruf ausgestoßen hast. */
  async function aiAfterWaiting(token) {
    ui.aiWaiting = false; // nur einmal – Schlachtruf und Ausspielen können kurz nacheinander kommen
    ui.message = '';
    render();
    await sleep(500 + Math.random() * 500);
    if (token !== ui.token || !(await waitForOverlays(token))) return false;
    return aiPlays(token);
  }

  async function confirmChoice() {
    const p = ui.chooser;
    if (p === null || !ui.selected || s.phase !== 'cards' || s.choices[p] || ui.choosing || ui.rallying) return;
    const token = ui.token;
    const id = ui.selected;
    ui.choosing = id; // diese Karte ist unterwegs und wird nicht mehr in der Hand gezeigt
    await flyHandToSlot(p, id);
    ui.choosing = false;
    if (token !== ui.token) return;
    ui.selected = null;
    const r = Engine.choose(s, p, id);
    if (!r.ok) { render(); toast(r.error); return; }
    if (online()) UI.sendMove({ t: 'choose', r: s.round, card: id });
    if (pvc() && ui.aiWaiting && !(await aiAfterWaiting(token))) return;
    afterChoice();
  }

  function afterChoice() {
    if (s.phase === 'cards') { render(); return; }
    if (online()) UI.sendSum();
    reveal();
  }

  async function reveal() {
    const token = ui.token;
    ui.chooser = 0;
    ui.message = 'Aufdecken!';
    render();
    await sleep(350);
    if (token !== ui.token) return;
    document.querySelectorAll('.slot .flipper').forEach((f) => f.classList.add('revealed'));
    ui.revealed = true;
    Snd.play('reveal');
    const r = s.result;
    const steps = UI.duelSteps(r);
    await sleep(800);
    if (token !== ui.token) return;
    ui.showResult = true;
    ui.presenting = true;
    ui.message = '';
    ui.duel = { steps, k: 0, done: !steps.length, skip: false, after: UI.afterLines(r), afterShown: false };
    ui.autoOff = false;
    render();
    if (steps.length) {
      await UI.playDuel(token);
      if (token !== ui.token) return;
      UI.stopCount();
      Object.assign(ui.duel, { done: true, k: steps.length });
      render();
    }
    if (r.winner === -1) Snd.play('tie');
    else Snd.play(r.winner === 1 ? 'lose' : 'win');
    // Was erst nach dem Duell wirkt (Plündern, Rückzug, Spion, Runenhorn), erscheint kurz nach dem Sieg unter der Karte
    if (ui.duel.after.some(Boolean)) {
      await sleep(600);
      if (token !== ui.token) return;
      ui.duel.afterShown = true;
      render();
      Snd.play('magic');
    }
    for (const p of [0, 1]) {
      for (const f of r.quartets[p]) {
        await sleep(400);
        if (token !== ui.token) return;
        Snd.play('quartet');
        await showQuartet(p, f);
      }
    }
    if (token !== ui.token) return;
    ui.presenting = false;
    UI.autoAdvance(token);
  }


  /* =============================================================== Stapel-Animationen */
  /*
   * Karten fliegen als „Geister“: eine feste Kopie mit Vorder- und Rückseite, die im Bogen fliegt,
   * sich dabei umdreht und passgenau auf dem Ziel landet. Erst dann erscheint die echte Karte.
   */
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

  function makeGhost(frontHTML, base) {
    const g = document.createElement('div');
    g.className = 'ghost';
    Object.assign(g.style, { left: `${base.left}px`, top: `${base.top}px`, width: `${base.width}px`, height: `${base.height}px` });
    g.style.setProperty('--qw', `${base.width}px`);
    g.innerHTML = `<div class="ghost-inner"><div class="gface gfront">${frontHTML || ''}</div>
      <div class="gface gback"><div class="card-back"></div></div></div>`;
    document.body.appendChild(g);
    return g;
  }

  /**
   * Flug von „from“ nach „to“ (Rechtecke), relativ zur Ausgangsgröße „base“ des Geistes.
   * ry0/ry1: Drehung um die Hochachse (0 = Vorderseite, 180 = Rückseite), spin: Neigung im Flug, lift: Bogenhöhe.
   */
  function fly(g, base, from, to, o = {}) {
    const [bx, by] = center(base);
    const tf = (r, ry, rz, lift = 0) => {
      const [cx, cy] = center(r);
      return `translate(${cx - bx}px, ${cy - by - lift}px) scale(${r.width / base.width}) rotateZ(${rz}deg) rotateY(${ry}deg)`;
    };
    const mid = { left: (from.left + to.left) / 2, top: (from.top + to.top) / 2, width: (from.width + to.width) / 2 };
    mid.height = mid.width * 1.5;
    const ry0 = o.ry0 || 0;
    const ry1 = o.ry1 === undefined ? 180 : o.ry1;
    const frames = [
      { transform: tf(from, ry0, 0), offset: 0 },
      { transform: tf(mid, (ry0 + ry1) / 2, o.spin || 0, o.lift || 0), offset: 0.5 },
      { transform: tf(to, ry1, 0), offset: 1 },
    ];
    const duration = reducedMotion ? 160 : o.duration || 680;
    const delay = reducedMotion ? 0 : o.delay || 0;
    return g.querySelector('.ghost-inner')
      .animate(frames, { duration, delay, easing: 'cubic-bezier(.45, .05, .35, 1)', fill: 'both' })
      .finished.catch(() => {});
  }

  /** Oberste Karte eines Stapels (auf dem Handy, ohne sichtbaren Stapel: die Spielerleiste). */
  function deckRect(p) {
    const pile = $(`#deck-${p} .pile`);
    const r = pile && pile.getBoundingClientRect();
    if (r && r.width) return r;
    const [cx, cy] = center($(`#bar-${p}`).getBoundingClientRect());
    return { left: cx - 15, top: cy - 22, width: 30, height: 45 };
  }

  /** Mitte der Arena (Kriegsbeute bei Gleichstand). */
  function potRect() {
    const pile = $('#pot .pile');
    const r = pile && pile.getBoundingClientRect();
    if (r && r.width) return r;
    const [cx, cy] = center($('#terrain-box').getBoundingClientRect());
    return { left: cx - 20, top: cy - 30, width: 40, height: 60 };
  }

  /** Kriegsbeute: kleiner verdeckter Stapel am Schlachtfeld (nur sichtbar, wenn etwas darin liegt). */
  function potCount() {
    if (ui.potShown !== null) return ui.potShown;
    if (s.result && !ui.fly) return s.result.winner === -1 ? s.pot.length - 2 : s.result.potTaken;
    return s.pot.length;
  }
  function potHTML() {
    const n = potCount();
    let pile = '';
    for (let i = 0; i < Math.min(3, Math.max(1, Math.ceil(n / 2))); i++) pile += `<div class="card-back" style="transform: translate(${i * -2}px, ${i * -2}px) rotate(${(i % 2 ? 4 : -3)}deg)"></div>`;
    return `<div class="pile${n ? '' : ' empty-pot'}">${pile}</div><div class="count" data-tip="Kriegsbeute: geht an den nächsten Rundensieger">💰 ${n}</div>`;
  }
  function setPot(n) {
    ui.potShown = n;
    setHTML('#pot', potHTML());
    $('#pot').classList.toggle('has-cards', n > 0);
  }

  const TUCK_X = 1.08; // Abstand neben dem Stapel in Kartenbreiten
  const TUCK_Y = 0.04;

  /** Landeplatz neben dem Stapel – von dort schiebt sich die Karte darunter. */
  function besideDeck(p, from) {
    const r = deckRect(p);
    const side = center(from)[0] >= center(r)[0] ? 1 : -1;
    // ganz neben dem Stapel (ohne Überlappung), leicht tiefer – die fliegende Karte liegt über allem
    return { left: r.left + side * r.width * TUCK_X, top: r.top + r.height * TUCK_Y, width: r.width, height: r.height, side };
  }

  /** Eine verdeckte Karte schiebt sich von der Seite unter den Stapel. */
  function tuckUnder(p, side) {
    const pile = $(`#deck-${p} .pile`);
    if (!pile || !pile.offsetWidth) return Promise.resolve();
    const empty = pile.querySelector('.empty');
    if (empty) empty.remove();
    const w = pile.offsetWidth;
    const h = pile.offsetHeight;
    const el = document.createElement('div');
    el.className = 'card-back';
    pile.prepend(el); // zuerst im DOM = ganz unten
    return el.animate(
      [
        { transform: `translate(${side * w * TUCK_X}px, ${h * TUCK_Y}px)` },
        { transform: 'none' },
      ],
      { duration: 380, easing: 'cubic-bezier(.35, .1, .25, 1)', fill: 'forwards' },
    ).finished.catch(() => {});
  }

  /** Flug einer Karte unter einen Stapel: im Bogen neben den Stapel, dann darunterschieben. */
  function flyUnder(g, base, from, p, opts) {
    const to = besideDeck(p, from);
    return fly(g, base, from, to, opts).then(() => {
      g.remove();
      Snd.play('place');
      return tuckUnder(p, to.side);
    }).then(() => {
      setDeck(p, ui.deckShown[p] + 1);
      bumpDeck(p);
    });
  }

  /** Nur die Zahl aktualisieren – der Stapel selbst wird erst am Ende neu aufgebaut (laufende Animationen bleiben). */
  function setDeck(p, n) {
    if (!ui.deckShown) return; // Flug aus einer abgebrochenen Partie
    ui.deckShown[p] = n;
    const deck = $(`#deck-${p}`);
    const count = deck && deck.querySelector('.count');
    if (count) count.textContent = n;
    if (deck) deck._html = null; // beim nächsten render() sauber neu aufbauen
  }

  function bumpDeck(p) {
    const d = $(`#deck-${p}`);
    if (!d) return;
    d.classList.remove('bump');
    void d.offsetWidth;
    d.classList.add('bump');
  }

  /** Nach dem Duell: Karten drehen sich um und schieben sich unter den Stapel des Siegers (Rückzug: unter den eigenen). */
  async function animateLoot() {
    const r = s.result;
    ui.deckShown = ui.deckBefore.slice();
    ui.potShown = r.winner === -1 ? s.pot.length - 2 : r.potTaken;
    const flights = [];
    [0, 1].forEach((p, i) => {
      const slot = $(`#slot-${p}`);
      const cardEl = slot.querySelector('.face.front .qcard');
      if (!cardEl) return;
      const from = cardEl.getBoundingClientRect();
      const dest = r.winner === -1 ? null : p !== r.winner && r.retreated ? p : r.winner;
      const g = makeGhost(cardHTML(r.ids[p], { stat: r.stat }), from);
      slot.classList.add('emptying');
      const target = dest === null ? potRect() : deckRect(dest);
      const dir = center(target)[0] < center(from)[0] ? -1 : 1;
      const opts = { ry0: 0, ry1: 180 * dir, spin: 14 * dir, lift: from.height * 0.28, delay: i * 180 };
      setTimeout(() => Snd.play('flip'), i * 180 + 120);
      flights.push(dest === null
        ? fly(g, from, from, target, opts).then(() => { g.remove(); Snd.play('place'); if (ui.potShown !== null) setPot(ui.potShown + 1); })
        : flyUnder(g, from, from, dest, opts));
    });
    if (r.winner !== -1) {
      const w = r.winner;
      // Kriegsbeute aus der Mitte
      for (let k = 0; k < r.potTaken; k++) {
        const from = potRect();
        const g = makeGhost('', from);
        setTimeout(() => { if (ui.potShown !== null) setPot(Math.max(0, ui.potShown - 1)); }, 420 + k * 140);
        flights.push(flyUnder(g, from, from, w, { ry0: 180, ry1: 180, spin: 10, lift: from.height * 0.4, delay: 420 + k * 140, duration: 560 }));
      }
      // Plündern: oberste Karte des Verlierers wandert hinüber
      if (r.stolen) {
        const l = 1 - w;
        const from = deckRect(l);
        const g = makeGhost('', from);
        flights.push(sleep(380).then(() => {
          setDeck(l, ui.deckShown[l] - 1);
          return flyUnder(g, from, from, w, { ry0: 180, ry1: 180 + 360, spin: 0, lift: from.height * 0.9, duration: 760 });
        }));
      }
    }
    await Promise.all(flights);
    // Endstand (berücksichtigt auch abgelegte Quartette), noch vor dem Nachziehen
    ui.deckShown = [0, 1].map((p) => s.players[p].deck.length + r.drawn[p].length);
    ui.potShown = null;
    render();
    await sleep(220);
  }

  /** Gezogene Karten heben vom Stapel ab, drehen sich im Flug auf und landen in der Hand. */
  function animateDraw(p) {
    const ids = ui.pendingDraw[p];
    if (!ids.length) return;
    ui.pendingDraw[p] = [];
    const from = deckRect(p);
    ids.forEach((id, i) => {
      const el = document.querySelector(`#hand [data-card="${id}"]`);
      if (!el) return;
      const to = el.getBoundingClientRect();
      el.style.visibility = 'hidden';
      const g = makeGhost(cardHTML(id), to);
      g.dataset.kind = 'draw';
      setTimeout(() => Snd.play('draw'), i * 200);
      fly(g, to, from, to, { ry0: 180, ry1: 360, spin: -10, lift: to.height * 0.22, delay: i * 200, duration: 700 })
        .then(() => { el.style.visibility = ''; g.remove(); });
    });
  }

  /** Der Computer zieht: verdeckte Karten heben von seinem Stapel ab und landen in seiner Hand. */
  function drawOpp(ids) {
    const from = deckRect(1);
    ids.forEach((id, i) => {
      const el = document.querySelector(`#opp-hand [data-i="${ui.oppOrder.indexOf(id)}"]`);
      if (!el) { ui.oppIncoming.delete(id); return; }
      const to = el.getBoundingClientRect();
      const g = makeGhost('', from);
      g.dataset.kind = 'draw';
      setTimeout(() => Snd.play('draw'), i * 200);
      fly(g, from, from, to, { ry0: 180, ry1: 180, spin: 10, lift: from.height * 0.45, delay: i * 200, duration: 620 }).then(() => {
        g.remove();
        ui.oppIncoming.delete(id);
        setHTML('#opp-hand', oppHandHTML()); // neu zeichnen – die Hand kann sich inzwischen geändert haben
      });
    });
  }

  /**
   * Schlachtruf: Die Handkarten fliegen in den Stapel, er wird gemischt, dann werden neue gezogen.
   * Offene Hand (unten) oder verdeckte Hand des Computers (oben).
   */
  async function animateRally(p) {
    const token = ui.token;
    const open = ui.chooser === p;
    // Nur der eigene Schlachtruf sperrt die Hand – der des Online-Gegners kann gleichzeitig laufen
    if (open) { ui.rallying = true; ui.selected = null; }
    Snd.play('horn');
    const to = deckRect(p);
    const els = open ? [...document.querySelectorAll('#hand [data-card]')] : [...document.querySelectorAll('#opp-hand .ob')];
    await Promise.all(els.map((el, i) => {
      const from = el.getBoundingClientRect();
      const g = makeGhost(open ? cardHTML(el.dataset.card) : '', from);
      el.style.visibility = 'hidden';
      setTimeout(() => Snd.play('whoosh'), i * 120);
      return fly(g, from, from, to, { ry0: open ? 0 : 180, ry1: 180, spin: 8, lift: from.height * 0.3, delay: i * 120, duration: 560 })
        .then(() => g.remove());
    }));
    if (token !== ui.token) return false;
    const r = Engine.rally(s, p);
    if (r.ok && open && online()) UI.sendMove({ t: 'rally', r: s.round });
    bumpDeck(p);
    await sleep(250);
    if (open) ui.rallying = false;
    if (!r.ok) { render(); toast(r.error); return false; }
    if (open) {
      ui.pendingDraw[p] = r.drawn;
      render();
    } else {
      r.drawn.forEach((id) => ui.oppIncoming.add(id));
      $('#opp-hand')._html = null;
      render();
      drawOpp(r.drawn);
    }
    return true;
  }

  /** Der Computer legt eine verdeckte Karte aus seiner Hand auf sein Feld. */
  async function flyOppToSlot(id) {
    const el = document.querySelector(`#opp-hand [data-i="${ui.oppOrder.indexOf(id)}"]`);
    const slot = $('#slot-1');
    if (!el || !slot) return;
    const from = el.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    el.style.visibility = 'hidden';
    // Eine per Spion bekannte Karte wird offen ausgespielt
    const g = makeGhost('', to);
    Snd.play('whoosh');
    await fly(g, to, from, to, { ry0: 180, ry1: 180, spin: -8, lift: to.height * 0.15, duration: 560 });
    Snd.play('place');
    g.remove();
  }

  /** Deine gewählte Karte dreht sich um und fliegt verdeckt auf dein Feld. */
  async function flyHandToSlot(p, id) {
    const el = document.querySelector(`#hand [data-card="${id}"]`);
    const slot = $(`#slot-${p}`);
    if (!el || !slot) return;
    const from = el.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    el.style.visibility = 'hidden';
    const g = makeGhost(cardHTML(id), to);
    Snd.play('flip');
    await fly(g, to, from, to, { ry0: 0, ry1: -180, spin: -6, lift: to.height * 0.12, duration: 600 });
    Snd.play('place');
    g.remove();
  }

  /** Verdeckte Hand des Gegners (oben neben seiner Leiste). Die per Spion gesehene Karte liegt offen. */
  function oppHandHTML() {
    const p = 1;
    let ids = s.players[p].hand.slice();
    if (s.result) ids = ids.filter((id) => !s.result.drawn[p].includes(id));
    else if (s.choices[p]) ids = ids.filter((id) => id !== s.choices[p].card);
    ui.oppOrder = ids;
    // Die ausgespähte Karte bleibt markiert, bis sie die Hand verlässt – frisch ausgespäht erst, wenn der Spion aufgedeckt ist
    const seen = s.result && s.result.spied[0] && !ui.revealed ? null : s.spyInfo[0];
    const n = ids.length;
    return ids.map((id, i) => {
      const off = i - (n - 1) / 2;
      const style = `--r:${off * 7}deg; --y:${Math.abs(off) * 3}px`;
      const incoming = ui.oppIncoming.has(id) ? ' incoming' : '';
      if (id === seen) {
        return `<div class="ob spied${incoming}" data-i="${i}" style="${style}">
          ${spiedHTML(id, true)}</div>`;
      }
      return `<div class="ob card-back${incoming}" data-i="${i}" style="${style}"></div>`;
    }).join('');
  }

  function resultMessage() {
    const r = s.result;
    const cards = r.ids.map((id) => CARDS[id]);
    // Nur der Satz: Fähigkeiten stehen unter den Karten, der Nebel auf dem Schlachtfeld (so bleibt die Zeile kurz und das Spielfeld ruhig)
    if (r.winner === -1) return '⚖️ Gleichstand – beide Karten wandern in die Kriegsbeute!';
    const who = r.winner === 0 ? 'Du eroberst' : `${oppName()} erobert`;
    const own = r.loot - 1; // die eigene Karte kommt zurück, der Rest ist Beute
    if (own <= 0) {
      const text = r.winner === 0 ? 'Du gewinnst das Duell, erbeutest aber nichts.' : `${oppName()} gewinnt das Duell, erbeutet aber nichts.`;
      return `<span class="big">${text}</span>`;
    }
    // Eine einzelne eroberte Karte beim Namen nennen – hat sich die gegnerische zurückgezogen, ist es die geplünderte
    const single = r.retreated ? r.stolenId && CARDS[r.stolenId] : cards[1 - r.winner];
    const what = own === 1 && r.potTaken === 0 && single ? single.name : `${own} Karten`;
    return `<span class="big">${who} ${what}!</span>`;
  }

  /** Ist gerade eine Einblendung zu sehen (Dialog, Regeln, Übersicht, Quartett-Tafel)? */
  function overlayOpen() {
    return !$('#overlay').classList.contains('hidden') || !!document.querySelector('.quartet-show');
  }

  /**
   * Wartet, bis keine Einblendung mehr zu sehen ist, und lässt danach kurz Zeit zum Hinschauen.
   * Liefert false, wenn inzwischen ein neues Spiel begonnen wurde oder das Spiel verlassen wurde.
   */
  async function waitForOverlays(token) {
    if (token !== ui.token) return false;
    if (!overlayOpen()) return true;
    while (overlayOpen()) {
      await sleep(150);
      if (token !== ui.token) return false;
    }
    await sleep(700 + Math.random() * 500);
    return token === ui.token;
  }

  /* =============================================================== Rendering */
  function statLabel(stat) { return `${STATS[stat].icon} ${STATS[stat].name}`; }
  function escapeHTML(t) { return String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }


  /** Illustration mit Emoji als Rückfall, falls die Bilddatei fehlt. */
  function artImg(src, emoji) {
    return `<span class="fallback">${emoji}</span><img src="${src}" alt="" draggable="false" decoding="async" onerror="this.remove()">`;
  }

  /**
   * Boni, die schon vor dem Aufdecken feststehen (Völkerbonus, Verbündete, Wut).
   * Sie gelten wörtlich, auch wo der niedrigere Wert gewinnt – so wie die Engine sie verrechnet.
   */
  function knownMods(p, id) {
    const c = CARDS[id];
    const out = [];
    const terrain = (s.terrain.bonus && s.terrain.bonus[c.faction]) || 0;
    if (terrain) out.push(['Völkerbonus', terrain]);
    if (c.ability === 'allies') {
      const n = s.players[p].hand.filter((h) => h !== id && CARDS[h].faction === c.faction).length;
      if (n) out.push(['Verbündete', c.amount * n]);
    }
    if (c.ability === 'rage' && s.lastWinner === 1 - p) out.push(['Wut', c.amount]);
    return out.map(([label, amount]) => ({ label, amount }));
  }

  function cardHTML(id, opt = {}) {
    const c = CARDS[id];
    const f = FACTIONS[c.faction];
    const live = s && !opt.neutral; // im Spiel: aktuelle Eigenschaft hervorheben
    const stat = live ? opt.stat || s.stat : null;
    // Bekannte Boni am aktiven Wert: auf der Hand alle vorab feststehenden, sonst nur der Völkerbonus
    let mods = [];
    if (live && stat && opt.owner !== undefined) mods = knownMods(opt.owner, id);
    else if (live && s.terrain && s.terrain.bonus && s.terrain.bonus[c.faction]) mods = [{ label: 'Völkerbonus', amount: s.terrain.bonus[c.faction] }];
    const sum = mods.reduce((a, m) => a + m.amount, 0);
    const bonusHTML = mods.length
      ? `<span class="bonus${(sum > 0) === !!s.terrain.lowWins ? ' bad' : ''}" data-tip="${mods.map((m) => `${m.label} ${m.amount > 0 ? '+' : '−'}${Math.abs(m.amount)}`).join(' · ')}">${sum > 0 ? '+' : '−'}${Math.abs(sum)}</span>`
      : '';
    const rows = STAT_IDS.map((st) => {
      const active = stat === st;
      const cls = active ? ' active' : stat ? ' dim' : '';
      return `<div class="row${cls}"><span>${STATS[st].icon}</span>
        <span class="lbl">${STATS[st].name}<span class="bar"><i style="width:${c.stats[st]}%"></i></span></span>
        <span class="num">${c.stats[st]}${active ? bonusHTML : ''}</span></div>`;
    }).join('');
    const ab = ABILITIES[c.ability];
    const used = c.ability === 'retreat' && live && s.retreatUsed.includes(id);
    const abText = ab ? `${ab.name}: ${ab.text(c)}${used ? ' (bereits verbraucht)' : ''}` : '';
    const abHTML = ab ? `<div class="ability${used ? ' used' : ''}"><b>${ab.icon} ${ab.name}${used ? ' (verbraucht)' : ''}</b><span class="atext">${ab.text(c)}</span></div>` : '';
    const fx = fxLevel() === 2 ? '' : ArtFX.html(c.id, opt.thumb, fxLevel());
    return `<div class="qcard${opt.selected ? ' selected' : ''}${opt.exposed ? ' exposed' : ''}" ${opt.attrs || ''} style="--fc:${f.color}">
      ${opt.exposed ? '<span class="exposed-mark" data-tip="Der Gegner kennt diese Karte (Spion)">🕵️</span>' : ''}
      <div class="frame">
        <div class="head"><span class="code">${c.id}</span><span>${f.icon} ${f.one}</span></div>
        <div class="art">${artImg(`art/cards/${c.id}${opt.thumb ? '.thumb' : ''}.webp`, c.art)}${fx}</div>
        <div class="name${c.name.length > 20 ? ' xlong' : c.name.length > 15 ? ' long' : ''}">${c.name}</div>
        ${abHTML}
        <div class="stats">${rows}</div>
      </div>
    </div>`;
  }

  function terrainHTML(t = s.terrain, live = true, thumb = false) {
    const counts = t.stat === 'choice'
      ? (live && s.stat ? statLabel(s.stat) : live && s.picker !== null && !ui.tossing ? `${pickerName()} die Eigenschaft…` : '🪙 Das Los entscheidet…')
      : `${statLabel(t.stat)}${t.lowWins ? ' ↓' : ''}`;
    return `<div class="terrain${t.lowWins ? ' low' : ''}${t.stat === 'choice' ? ' choice' : ''}"><div class="frame">
      <div class="head"><span class="kicker">Schlachtfeld</span></div>
      <div class="art">${artImg(`art/terrains/${t.id}${thumb ? '.thumb' : ''}.webp`, t.art)}</div>
      <div class="tname${t.name.length > 16 ? ' xlong' : t.name.length > 13 ? ' long' : ''}">${t.name}</div>
      <div class="body">
        <div class="counts">${counts}</div>
        ${t.text ? `<div class="ttext">${t.text}</div>` : ''}
      </div>
    </div></div>`;
  }

  const avatarOf = (p) => (s.players[p].isAI ? '🤖' : p === 0 ? '🧑' : '🧙');
  /** „Du wählst“ / „Der Computer wählt“ / „Anna wählt“ (online) für den ausgelosten Spieler. */
  function pickerName() {
    return s.picker === 0 ? 'Du wählst' : `${oppName()} wählt`;
  }

  function playerBarHTML(p) {
    const pl = s.players[p];
    const avatar = avatarOf(p);
    const slots = [];
    for (let i = 0; i < s.targetQuartets; i++) {
      const f = pl.quartets[i];
      slots.push(f ? `<span class="qslot filled" data-tip="${FACTIONS[f].name}">${FACTIONS[f].icon}</span>` : '<span class="qslot"></span>');
    }
    // Zusätzliche Quartette über dem Ziel (kann bei Rundenlimit-Wertung nicht passieren, schadet aber nicht)
    for (let i = s.targetQuartets; i < pl.quartets.length; i++) slots.push(`<span class="qslot filled">${FACTIONS[pl.quartets[i]].icon}</span>`);
    return `<span class="avatar" style="--pc:var(--p${p})">${avatar}</span>
      <span class="pname">${escapeHTML(pl.name)}</span>${s.picker === p && !ui.tossing ? '<span class="pick-mark" data-tip="Per Los bestimmt: wählt auf diesem Schlachtfeld die Eigenschaft">🪙</span>' : ''}
      <span class="chip total-chip" data-tip="Karten insgesamt (Hand + Stapel)">🂠 <b>${Engine.owned(s, p).length}</b><span class="unit"> Karten</span></span>
      <span class="quartet-slots" data-tip="Quartette">${slots.join('')}</span>
      ${rallyHTML(pl)}
`;
  }

  /** Schlachtruf in der Spielerleiste: bereit, oder mit Ladepunkten. */
  function rallyHTML(pl) {
    if (pl.rally) return '<span class="horn ready" data-tip="Schlachtruf bereit: Handkarten in den Stapel mischen und neu ziehen">📯</span>';
    const pips = Array.from({ length: Engine.RALLY_RECHARGE }, (_, i) => `<i class="${i < pl.rallyCharge ? 'on' : ''}"></i>`).join('');
    const wait = Engine.RALLY_RECHARGE - pl.rallyCharge;
    return `<span class="horn charging" data-tip="Schlachtruf lädt: noch ${wait} Runde${wait === 1 ? '' : 'n'} im Rückstand">📯<span class="pips">${pips}</span></span>`;
  }

  function slotHTML(p) {
    const pl = s.players[p];
    const who = `<div class="who">${escapeHTML(pl.name)}</div>`;
    if (s.result) {
      const id = s.result.ids[p];
      const view = ui.showResult ? UI.duelView() : null;
      let value = '';
      if (view) {
        const d = ui.duel;
        const shown = d ? d.steps.slice(0, d.k) : [];
        const after = d && d.afterShown && d.after[p];
        const lines = shown.map((st, k) => st.lines[p] && `<li class="${st.lines[p].cls}${!d.done && k === d.k - 1 ? ' new' : ''}">${escapeHTML(st.lines[p].text)}</li>`).filter(Boolean).join('')
          + (after ? `<li class="${after.cls} new">${escapeHTML(after.text)}</li>` : '');
        value = `<div class="value"><b class="num">${view.vals[p]}</b>${lines ? `<ul class="steps">${lines}</ul>` : ''}</div>`;
      }
      return `${who}<div class="flipper${ui.revealed ? ' revealed' : ''}">
        <div class="face back"><div class="card-back"></div></div>
        <div class="face front">${cardHTML(id, { attrs: `data-zoom="${id}"`, stat: view ? view.stats[p] : null })}</div></div>${value}`;
    }
    if (s.phase === 'cards' && s.choices[p]) {
      // Eine per Spion bekannte Gegnerkarte liegt offen – du hast sie ja schon gesehen
      const id = s.choices[p].card;
      if (p === 1 && s.spyInfo[0] === id) {
        return `${who}<div class="spied">${spiedHTML(id)}</div>`;
      }
      return `${who}<div class="flipper"><div class="face back"><div class="card-back"></div></div></div>`;
    }
    return `${who}<div class="placeholder"></div>`;
  }

  /** Per Spion ausgespähte Karte: verdeckt mit Späher-Siegel, beim Überfahren dreht sie sich um (ohne Tooltip – sie zeigt ja selbst, was sie ist). */
  function spiedHTML(id, mini) {
    return `<div class="flipper"><div class="face back"><div class="card-back"><span class="spy-seal">🕵️</span></div></div>
      <div class="face front">${cardHTML(id, { neutral: true, thumb: mini, attrs: `data-zoom="${id}"` })}</div></div>`;
  }

  function slotClass(p) {
    const cl = ['slot'];
    if (ui.showResult && s.result && s.result.winner !== -1 && (!ui.duel || ui.duel.done)) cl.push(s.result.winner === p ? 'win' : 'lose');
    if (ui.fly) cl.push('emptying'); // die Karten sind gerade als Geister unterwegs
    return cl.join(' ');
  }

  function deckHTML(p) {
    const n = ui.deckShown ? ui.deckShown[p] : s.result ? ui.deckBefore[p] : s.players[p].deck.length;
    const layers = Math.min(4, Math.ceil(n / 4));
    let pile = '';
    for (let i = 0; i < layers; i++) pile += `<div class="card-back" style="transform: translate(${i * -2}px, ${i * -2}px)"></div>`;
    return `      <div class="pile">${n ? pile : '<div class="empty">leer</div>'}</div>
      <div class="count" data-tip="Karten im Nachziehstapel">${n}</div>`;
  }

  function centerHTML() {
    return `<div class="message">${ui.message}</div>${stallHTML()}`;
  }

  /** Online: Der Gegner lässt auf sich warten – Zähler, nach einer Weile mit Ausweg. */
  function stallHTML() {
    if (UI.net.drop && s && online()) {
      const secs = Math.floor((Date.now() - UI.net.drop.since) / 1000);
      return `<div class="stall">🔌 Verbindung zu ${oppName()} unterbrochen – warte… <b aria-hidden="true">${Math.max(0, UI.DROP_WAIT_S - secs)} s</b>
        <button class="btn-small" id="stall-leave">Partie verlassen</button></div>`;
    }
    const leaveBtn = '<button class="btn-small" id="stall-leave">Partie verlassen</button>';
    if (ui.silent !== null && s && online()) {
      const secs = ui.silent;
      return `<div class="stall">🔌 Verbindung zu ${oppName()} gestört – warte… <b aria-hidden="true">${secs} s</b>${secs >= 30 ? leaveBtn : ''}</div>`;
    }
    if (ui.stall === null) return '';
    const time = `${Math.floor(ui.stall / 60)}:${String(ui.stall % 60).padStart(2, '0')}`;
    const leave = ui.stall >= UI.STALL_LEAVE_S ? leaveBtn : '';
    const why = UI.net.away ? 'hat das Spiel gerade im Hintergrund…' : 'lässt sich Zeit…';
    return `<div class="stall">${UI.net.away ? '💤' : '⏳'} ${oppName()} ${why} <b aria-hidden="true">${time}</b>${leave}</div>`;
  }

  /** Hand plus Titel- und Aktionszeile darunter (Ergebnis, Weiter, Statwahl, Ausspielen). */
  function handHTML() {
    const p = ui.chooser;
    if (ui.showResult) {
      // Frisch gezogene Karten erst nach „Weiter“ zeigen – sie fliegen dann vom Stapel ins Blatt
      const cards = p === null ? '' : s.players[p].hand.filter((id) => !s.result.drawn[p].includes(id)).map((id) => cardHTML(id, { attrs: `data-zoom="${id}"` })).join('');
      // Das Ergebnis erscheint erst, wenn das Duell vorgeführt ist
      const running = ui.duel && !ui.duel.done;
      // (leere Zeile hält den Platz, damit das Spielfeld nicht springt, wenn das Ergebnis erscheint)
      const title = `<div class="result-line">${running ? '&nbsp;' : resultMessage()}</div>`;
      return { title, cards, locked: true,
        actions: `<button class="btn-primary" id="next-btn">${s.phase === 'over' ? 'Ergebnis ▸' : 'Weiter ▸'}</button>` };
    }
    if (p === null) return { title: '', cards: '', actions: '' };
    const pl = s.players[p];
    if (s.phase === 'stat' && p === s.picker && !ui.tossing && !isAI(p)) {
      return { title: 'Wähle die Eigenschaft', locked: true,
        cards: pl.hand.map((id) => cardHTML(id, { attrs: `data-zoom="${id}"` })).join(''), // nicht wählbar, aber groß zu zeigen
        actions: `<div class="stat-choice">${STAT_IDS.map((st) => `<button data-stat="${st}">${statLabel(st)}</button>`).join('')}</div>` };
    }
    const canChoose = s.phase === 'cards' && !s.choices[p];
    const seen = s.spyInfo && s.spyInfo[p];
    const seenPlayed = seen && s.choices[1 - p] && s.choices[1 - p].card === seen;
    // Sobald der Gegner die Karte gespielt hat, liegt sie offen auf seinem Feld – dann braucht es keinen Hinweis mehr
    // Umgekehrt: Welche eigene Karte kennt der Gegner? (Konter: Schlachtruf mischt sie weg)
    const exposed = s.result && s.result.spied[1 - p] && !ui.revealed ? null : s.spyInfo[1 - p];
    const spy = (canChoose && seen && !seenPlayed
      ? `<div class="spy-line">🕵️ Spion: Der Gegner hat <b>${CARDS[seen].id} ${CARDS[seen].name}</b> auf der Hand.</div>` : '')
      + (canChoose && exposed
        ? `<div class="spy-line exposed">🕵️ Der Gegner kennt deine <b>${CARDS[exposed].id} ${CARDS[exposed].name}</b>.</div>` : '');
    const title = canChoose
      ? spy + 'Wähle deine Karte'
      : s.phase === 'cards' ? 'Warte auf den Gegner…' : '';
    // Ausgespielte Karte liegt auf dem Feld; frisch gezogene erscheinen erst nach „Weiter“
    const played = s.choices[p] ? s.choices[p].card : ui.choosing;
    const hand = s.result ? pl.hand.filter((id) => !s.result.drawn[p].includes(id)) : pl.hand.filter((id) => id !== played);
    const cards = hand.map((id, i) => cardHTML(id, { selected: ui.selected === id, owner: p, exposed: id === exposed, attrs: `data-card="${id}" data-key="${i + 1}" tabindex="0" role="button" aria-pressed="${ui.selected === id}" aria-label="${escapeHTML(CARDS[id].name)} (Taste ${i + 1})"` })).join('');
    let actions = '';
    if (canChoose) {
      const tip = pl.rally ? 'Handkarten in den Stapel mischen und neu ziehen' : 'Lädt sich auf, solange du zurückliegst';
      actions = `<button class="horn-toggle" id="rally-btn" ${pl.rally && pl.deck.length && !ui.rallying ? '' : 'disabled'} data-tip="${tip}">📯 Schlachtruf</button>
        <button class="btn-primary" id="play-btn" ${ui.selected ? '' : 'disabled'}>Karte ausspielen</button>`;
    }
    return { title, cards, actions, locked: !canChoose };
  }

  function overviewHTML() {
    const owner = {};
    for (const p of [0, 1]) {
      for (const id of Engine.owned(s, p)) owner[id] = `own-${p}`;
      for (const f of s.players[p].quartets) for (const id of Object.keys(CARDS)) if (CARDS[id].faction === f) owner[id] = `laid-${p}`;
    }
    for (const id of s.pot) owner[id] = 'in-pot';
    return Object.entries(FACTIONS).map(([f, fac]) => {
      const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === Number(f));
      const done = ids.every((id) => (owner[id] || '').startsWith('laid'));
      const cells = ids.map((id) => `<span class="cell ${owner[id] || ''}" data-tip="${CARDS[id].name}">${id}</span>`).join('');
      return `<div class="ov-row${done ? ' done' : ''}"><span class="fname">${fac.icon} ${fac.name}</span>${cells}</div>`;
    }).join('');
  }

  function legendHTML() {
    const n = s.players.map((pl) => escapeHTML(pl.name));
    return `<span><i class="own-0"></i>${n[0]}</span><span><i class="own-1"></i>${n[1]}</span>
      <span><i class="in-pot"></i>Kriegsbeute</span><span><i class="laid-0"></i>Quartett</span>`;
  }

  /** Setzt HTML nur, wenn es sich geändert hat – so bleiben Karten und Bilder unangetastet. */
  function setHTML(sel, html) {
    const el = $(sel);
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  function render() {
    if (!s) return;
    setHTML('#round-info', `<span>Runde ${s.round} / ${s.maxRounds}</span>${s.pot.length ? `<span class="pot">💰 Kriegsbeute: ${s.pot.length} Karten</span>` : ''}`);
    setHTML('#bar-0', playerBarHTML(0));
    setHTML('#bar-1', playerBarHTML(1));
    setHTML('#opp-hand', oppHandHTML());
    for (const p of [0, 1]) {
      $(`#slot-${p}`).className = slotClass(p);
      setHTML(`#slot-${p}`, slotHTML(p));
      setHTML(`#deck-${p}`, deckHTML(p));
    }
    setHTML('#terrain-box', terrainHTML());
    setHTML('#pot', potHTML());
    $('#pot').classList.toggle('has-cards', potCount() > 0);
    setHTML('#center-rest', centerHTML());
    const h = handHTML();
    setHTML('#hand-title', h.title);
    setHTML('#hand', h.cards);
    if (ui.chooser !== null && !ui.showResult) animateDraw(ui.chooser);
    $('#hand').classList.toggle('locked', !!h.locked);
    setHTML('#hand-actions', h.actions);
    setHTML('#legend', legendHTML());
    setHTML('#overview', overviewHTML());
    setHTML('#log', s.log.slice(-80).reverse().map((l) => `<div class="log-${l.kind}">${escapeHTML(l.text)}</div>`).join(''));
  }

  /* =============================================================== Eingabe */
  function canSelect(id) {
    const p = ui.chooser;
    return p !== null && s.phase === 'cards' && !s.choices[p] && !ui.choosing && !ui.rallying && s.players[p].hand.includes(id);
  }
  /** Wählt die Karte aus; erneutes Wählen hebt die Auswahl auf, außer mit keep (Großansicht per langem Drücken). */
  function selectCard(id, keep = false) {
    if (!canSelect(id)) return;
    if (keep && ui.selected === id) return;
    ui.selected = ui.selected === id ? null : id;
    Snd.play('select');
    // Einmalig auf Touch: wie man eine Handkarte groß sieht (Antippen wählt sie ja aus)
    if (ui.selected && ui.lastPointer === 'touch' && !store.get('zoom-tip', false)) {
      store.set('zoom-tip', true);
      toast('Tipp: Karte gedrückt halten zeigt sie groß');
    }
    // Nur Klassen umschalten statt die Hand neu aufzubauen.
    document.querySelectorAll('#hand [data-card]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.card === ui.selected);
      el.setAttribute('aria-pressed', el.dataset.card === ui.selected);
    });
    const btn = $('#play-btn');
    if (btn) btn.disabled = !ui.selected;
  }

  async function rallyNow() {
    const p = ui.chooser;
    if (p === null || s.phase !== 'cards' || s.choices[p] || ui.choosing || ui.rallying || !s.players[p].rally) return;
    const token = ui.token;
    await animateRally(p);
    // Der Konter hat gegriffen: Der Computer weiß nichts mehr über deine Hand und legt jetzt
    if (token === ui.token && pvc() && ui.aiWaiting && !s.spyInfo[1] && (await aiAfterWaiting(token))) afterChoice();
  }

  /* =============================================================== Overlays & Effekte */
  // Nur ein Overlay sichtbar; eines über einem anderen (z. B. Regeln über dem Spielende) stellt dieses danach wieder her.
  let overlayStack = [];
  let focusBefore = null; // Fokus vor dem Öffnen – kommt beim Schließen zurück
  let galleryRO = null;   // passt die Galerie an die Fenstergröße an, solange sie offen ist
  let moodBeforeZoom = null; // Musik vor der Großansicht eines Schlachtfelds
  function openOverlay(html, opts = {}) {
    const o = $('#overlay');
    if (!o.classList.contains('hidden')) overlayStack.push(Array.from(o.childNodes));
    // Große Fenster (Galerie) bekommen einen deckenden Hintergrund – durchscheinend wäre jedes Neuzeichnen teuer
    if (opts.solid) o.classList.add('solid');
    if (o.classList.contains('hidden')) focusBefore = document.activeElement;
    o.innerHTML = html;
    o.classList.remove('hidden');
    document.body.classList.add('overlay-open'); // Menü-Hintergrund pausiert, solange etwas darüber liegt
    // Dahinter ist nichts erreichbar (Tab, Vorlesen, Enter auf einem Knopf öffnet es nicht noch einmal)
    ['#game', '#menu'].forEach((sel) => { $(sel).inert = true; });
    o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
    focusOverlay();
  }
  /** Fokus auf den Hauptknopf des Fensters (sonst den ersten), damit Tastatur und Vorlesen dort weitermachen. */
  function focusOverlay() {
    const o = $('#overlay');
    const modal = o.querySelector('.modal, .zoom');
    if (modal) {
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const h = modal.querySelector('h2');
      if (h) { h.id = h.id || 'overlay-title'; modal.setAttribute('aria-labelledby', h.id); }
    }
    // Zuerst der harmlose Ausweg (Schließen, Weiterspielen), sonst der Hauptknopf
    const target = o.querySelector('[data-close]') || o.querySelector('.btn-primary:not(:disabled)') || o.querySelector('button:not(:disabled), [tabindex]') || modal;
    if (target) {
      if (!target.matches('button, [tabindex]')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }
  function closeOverlay() {
    if (moodBeforeZoom) { Snd.setMood(moodBeforeZoom); moodBeforeZoom = null; }
    const o = $('#overlay');
    const prev = overlayStack.pop();
    if (prev) { o.replaceChildren(...prev); focusOverlay(); return; }
    o.classList.add('hidden');
    o.classList.remove('solid');
    o.innerHTML = '';
    document.body.classList.remove('overlay-open');
    ['#game', '#menu'].forEach((sel) => { $(sel).inert = false; });
    if (galleryRO) { galleryRO.disconnect(); galleryRO = null; }
    const f = focusBefore;
    focusBefore = null;
    if (f && f.isConnected && !f.closest('[inert], .hidden')) f.focus({ preventScroll: true });
  }
  function closeAllOverlays() { overlayStack = []; moodBeforeZoom = null; closeOverlay(); }
  function showRules() {
    openOverlay($('#rules-tpl').innerHTML);
  }

  /* =============================================================== Zoom & Galerie */
  function showZoom(html) {
    openOverlay(`<div class="zoom" data-close>${html}<p class="zoom-hint">${tapWord()} zum Schließen</p></div>`);
  }

  function zoomCard(id) {
    const c = CARDS[id];
    const ab = ABILITIES[c.ability];
    const text = ab ? `<p class="zoom-note">${ab.icon} <b>${ab.name}:</b> ${ab.text(c)}</p>` : '';
    showZoom(cardHTML(id, { neutral: true }) + text);
  }

  /** Großansicht eines Schlachtfelds spielt dessen Musik; beim Schließen kehrt die vorherige zurück. */
  function zoomTerrain(tid) {
    showZoom(terrainHTML(TERRAINS.find((t) => t.id === tid), false));
    moodBeforeZoom = Snd.pendingMood();
    Snd.setMood(tid);
  }

  /** Goldener Pfeil im Medaillon mit Perlrand; zeigt nach rechts, der linke wird per CSS gespiegelt. */
  function pagerArrowSVG() {
    const beads = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return `<circle cx="${(32 + Math.cos(a) * 27.5).toFixed(2)}" cy="${(32 + Math.sin(a) * 27.5).toFixed(2)}" r="1.3"/>`;
    }).join('');
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="pg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff0b8"/><stop offset=".3" stop-color="#e2b85a"/><stop offset=".55" stop-color="#8a5d17"/>
          <stop offset=".8" stop-color="#f2d27a"/><stop offset="1" stop-color="#6e4a12"/></linearGradient>
        <radialGradient id="pg-core" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4a3018"/><stop offset="1" stop-color="#140c05"/></radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30.5" fill="url(#pg-gold)" stroke="#3a2608" stroke-width="1.2"/>
      <g fill="#fff3c8" opacity=".75">${beads}</g>
      <circle cx="32" cy="32" r="24" fill="url(#pg-core)" stroke="#3a2608" stroke-width="1.5"/>
      <circle cx="32" cy="32" r="21.5" fill="none" stroke="#e2b85a" stroke-width=".7" opacity=".6"/>
      <g fill="url(#pg-gold)" stroke="#3a2608" stroke-width="1" stroke-linejoin="round">
        <path d="M13.5 32 l4 -3.2 l4 3.2 l-4 3.2 z"/>
        <path d="M21 30.4 h11 v3.2 h-11 z"/>
        <path d="M27 18.5 Q35 25 47 32 Q35 39 27 45.5 Q31.5 39 31.5 32 Q31.5 25 27 18.5 z"/>
        <path d="M31 24 q-4 -1 -5.5 -4.5 q3.5 .5 5.5 4.5 z M31 40 q-4 1 -5.5 4.5 q3.5 -.5 5.5 -4.5 z"/>
      </g>
    </svg>`;
  }

  /** Galerie in Seiten: So viele Karten, wie ins Fenster passen; unten blättern goldene Pfeile (auch ← / →). */
  function showGallery(tab) {
    const items = tab === 'cards'
      ? Object.keys(CARDS).map((id) => cardHTML(id, { neutral: true, thumb: true, attrs: `data-zoom-card="${id}"` }))
      : TERRAINS.map((t) => `<div data-zoom-terrain="${t.id}">${terrainHTML(t, false, true)}</div>`);
    const arrow = pagerArrowSVG();
    openOverlay(`<div class="modal gallery">
      <h2>Kartengalerie</h2>
      <div class="seg gallery-tabs"><button data-tab="cards" class="${tab === 'cards' ? 'active' : ''}">Helden (32)</button>
        <button data-tab="terrains" class="${tab === 'terrains' ? 'active' : ''}">Schlachtfelder (${TERRAINS.length})</button></div>
      <div class="gallery-grid"></div>
      <nav class="gallery-pager">
        <button class="pager-arrow prev" aria-label="Vorherige Seite">${arrow}</button>
        <span class="pager-info"></span>
        <button class="pager-arrow next" aria-label="Nächste Seite">${arrow}</button>
      </nav>
      <div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`, { solid: true });
    const o = $('#overlay');
    const grid = o.querySelector('.gallery-grid');
    const pager = o.querySelector('.gallery-pager');
    const prev = pager.querySelector('.prev'), next = pager.querySelector('.next');
    let perPage = 0, first = 0; // „first“ = erste sichtbare Karte, damit man beim Umbrechen an derselben Stelle bleibt

    function render() {
      const pages = Math.ceil(items.length / perPage);
      const page = Math.floor(first / perPage);
      first = page * perPage;
      grid.innerHTML = items.slice(first, first + perPage).join('');
      pager.querySelector('.pager-info').textContent = `Seite ${page + 1} von ${pages}`;
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      pager.classList.toggle('single', pages <= 1);
    }
    function layout() {
      const w = grid.clientWidth, h = grid.clientHeight;
      if (!w || !h) return; // gerade von der Großansicht verdeckt
      const cs = getComputedStyle(grid);
      const qw = parseFloat(cs.getPropertyValue('--qw'));
      const gap = parseFloat(cs.columnGap) || 0;
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const cols = Math.max(1, Math.floor((w + gap) / (qw * 1.22 + gap)));
      const rows = Math.max(1, Math.floor((h - padY + gap) / (qw * 1.5 + gap)));
      if (cols * rows === perPage) return;
      perPage = cols * rows;
      render();
    }
    prev.addEventListener('click', () => { first = Math.max(0, first - perPage); render(); });
    next.addEventListener('click', () => { if (first + perPage < items.length) { first += perPage; render(); } });
    if (galleryRO) galleryRO.disconnect(); // das alte Raster (anderer Reiter) ist schon ersetzt
    galleryRO = new ResizeObserver(layout);
    galleryRO.observe(grid);
    layout();
    o.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); showGallery(b.dataset.tab); }));
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-zoom-card]'), terrain = e.target.closest('[data-zoom-terrain]');
      if (card) zoomCard(card.dataset.zoomCard);
      else if (terrain) zoomTerrain(terrain.dataset.zoomTerrain);
    });
  }

  /** Quartett-Präsentation: abgedunkeltes Spielfeld, Tafel mit Titel und den vier aufgefächerten Karten. */
  function showQuartet(p, f) {
    return new Promise((resolve) => {
      const fac = FACTIONS[f];
      const ids = Object.keys(CARDS).filter((id) => CARDS[id].faction === f);
      const who = p === 0 ? 'Du legst ein Quartett ab!' : `${oppName()} legt ein Quartett ab!`;
      const count = s.players[p].quartets.length;
      const el = document.createElement('div');
      el.className = 'quartet-show';
      el.innerHTML = `<div class="q-plaque" style="--fc:${fac.color}">
          <div class="q-kicker">${who}</div>
          <div class="q-title">${fac.icon} Quartett der ${fac.name}</div>
          <div class="q-cards">${ids.map((id, i) => `<div class="q-card" style="--i:${i}">${cardHTML(id, { neutral: true, thumb: true })}</div>`).join('')}</div>
          <div class="q-sub">${count} von ${s.targetQuartets} Quartetten${count >= s.targetQuartets ? ' – Sieg!' : ''}</div>
          <div class="q-hint">${tapWord()} zum Fortfahren</div>
        </div>`;
      document.body.appendChild(el);
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        el.classList.add('leaving');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      };
      el.addEventListener('click', close);
      setTimeout(close, 5500);
    });
  }

  /**
   * Münzwurf auf einem Wahlfeld: Die Münze mit beiden Spielern wirbelt hoch und landet auf dem
   * Gesicht dessen, der die Eigenschaft wählt. Klicken überspringt.
   */
  function tossCoin(p) {
    return new Promise((resolve) => {
      const spins = reducedMotion ? 0 : 6;
      const who = p === 0 ? 'Du wählst die Eigenschaft!' : `${oppName()} wählt die Eigenschaft.`;
      const face = (i) => `<div class="coin-face side-${i}" style="--pc:var(--p${i})"><span>${avatarOf(i)}</span></div>`;
      const el = document.createElement('div');
      el.className = `coin-toss${reducedMotion ? ' landed' : ''}`;
      el.style.setProperty('--win', `var(--p${p})`);
      el.innerHTML = `<div class="coin-kicker">${escapeHTML(s.terrain.name)}</div>
        <div class="coin-air"><div class="coin" style="--end:${spins * 360 + (p ? 180 : 0)}deg">${face(0)}${face(1)}</div></div>
        <div class="coin-result">${who}</div>`;
      document.body.appendChild(el);
      const timers = [];
      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        el.classList.add('leaving');
        setTimeout(() => { el.remove(); resolve(); }, 350);
      };
      const land = () => { el.classList.add('landed'); Snd.play('coin'); };
      if (reducedMotion) { Snd.play('coin'); timers.push(setTimeout(close, 2400)); }
      else {
        Snd.play('whoosh');
        timers.push(setTimeout(land, 1450), setTimeout(close, 3600));
      }
      el.addEventListener('click', () => { if (!el.classList.contains('landed')) land(); close(); });
    });
  }

  /** Auf Touch-Geräten wird getippt, nicht geklickt. */
  const tapWord = () => (window.matchMedia && window.matchMedia('(hover: none)').matches ? 'Tippen' : 'Klicken');

  function toast(text) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  function showGameOver() {
    const w = s.winner;
    Snd.play(w === -1 ? 'tie' : w === 1 ? 'defeat' : 'victory');
    let title, emoji;
    if (w === -1) { title = 'Unentschieden'; emoji = '⚖️'; }
    else { title = w === 0 ? 'Sieg!' : 'Niederlage'; emoji = w === 0 ? '🏆' : '🏳️'; }
    const score = [0, 1].map((p) => {
      const pl = s.players[p];
      const q = pl.quartets.map((f) => `<span data-tip="${FACTIONS[f].name}">${FACTIONS[f].icon}</span>`).join('') || '–';
      return `<div><span class="fs-name">${escapeHTML(pl.name)}</span><b>${q}</b>
        <span class="fs-line">${pl.quartets.length} Quartett${pl.quartets.length === 1 ? '' : 'e'} · ${pl.won} Duelle gewonnen</span>
        <span class="fs-line">${Engine.owned(s, p).length} Karten übrig</span></div>`;
    }).join('');
    openOverlay(`<div class="modal"><div class="big-emoji">${emoji}</div><h2>${title}</h2>
      <p>${escapeHTML(s.endReason)} · nach ${s.round} Runden</p>
      <div class="final-score">${score}</div>
      <div class="buttons"><button class="btn-secondary" id="go-menu">Hauptmenü</button><button class="btn-primary" id="go-again">Revanche</button></div></div>`);
    $('#go-menu').addEventListener('click', toMenu);
    $('#go-again').addEventListener('click', () => (online() ? UI.askRematch() : startGame()));
    if (online()) {
      // Was der Gegner schon gesagt hat, während das letzte Ergebnis noch zu sehen war
      if (UI.net.gone) UI.goneNote();
      else if (UI.net.rematch[1]) UI.rematchNote(`${UI.net.oppName} möchte eine Revanche!`);
    }
  }


  /* =============================================================== Ton */
  function updateAudioButtons() {
    document.querySelectorAll('.sfx-toggle').forEach((b) => {
      b.classList.toggle('off', !Snd.settings.sfx);
      b.firstChild.textContent = Snd.settings.sfx ? '🔊' : '🔇';
    });
    document.querySelectorAll('.music-toggle').forEach((b) => b.classList.toggle('off', !Snd.settings.music));
  }
  function initAudio() {
    // Browser erlauben Ton erst nach einer Nutzeraktion – bei Touch zählt erst das Loslassen (pointerup)
    document.addEventListener('pointerdown', () => Snd.unlock(), true);
    document.addEventListener('pointerup', () => Snd.unlock(), true);
    document.addEventListener('keydown', () => Snd.unlock(), true);
    document.querySelectorAll('.sfx-toggle').forEach((b) => {
      // Emoji als eigener Textknoten, damit der Rest der Beschriftung erhalten bleibt
      const label = b.textContent.replace('🔊', '').trim();
      b.textContent = '🔊';
      if (label) b.append(` ${label}`);
      b.addEventListener('click', () => { Snd.setSfx(!Snd.settings.sfx); updateAudioButtons(); Snd.play('click'); });
    });
    document.querySelectorAll('.music-toggle').forEach((b) => b.addEventListener('click', () => { Snd.setMusic(!Snd.settings.music); updateAudioButtons(); }));
    // Einheitliches Klick-Geräusch für alle Knöpfe (der Effekte-Schalter klickt selbst)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('sfx-toggle')) return;
      Snd.play('click');
    });
    updateAudioButtons();
  }

  /* =============================================================== Kartenanimationen */
  /** Nach einem Wechsel der Stufe: Effekte sofort entfernen bzw. die Karten neu zeichnen */
  function applyFx() {
    document.documentElement.dataset.fx = fxLevel(); // weniger Glühwürmchen, stiller Nebel (style.css)
    if (fxLevel() === 2) document.querySelectorAll('.qcard .fx').forEach((el) => el.remove());
    if (s) render();
  }
  /**
   * Automatik: misst die Zeit zwischen zwei Bildern, solange Effekte zu sehen sind. Geht in drei
   * Messfenstern (je 3 s) hintereinander mehr als ein Viertel der Zeit in zu langen Bildern (> 45 ms) auf,
   * gibt es eine Stufe weniger Effekte. Gleichmäßige 30 Bilder/s (iPhone im Stromsparmodus) zählen nicht,
   * einzelne lange Hänger (Bilder laden, Partie aufbauen) auch nicht – Ruckeln durch die Effekte ist stetig.
   */
  function watchFrames() {
    let last = 0, settle = 0, total = 0, slow = 0, bad = 0;
    const visibleFx = () => document.querySelector('.screen:not(.hidden) .fx i, #overlay .fx i');
    const tick = (t) => {
      if (fxLevel() === 2) return;
      requestAnimationFrame(tick);
      const dt = t - last;
      last = t;
      // Hänger und Pausen (Tab im Hintergrund, Gerät gesperrt) und die Zeit kurz danach zählen nicht
      if (document.hidden || dt > 250 || !visibleFx()) { settle = t + 1000; return; }
      if (t < settle) return;
      total += dt;
      if (dt > 45) slow += dt;
      if (total < 3000) return;
      bad = slow / total > .25 ? bad + 1 : 0;
      total = slow = 0;
      if (bad < 3) return;
      bad = 0;
      settle = t + 3000;
      store.set('fx-auto', ++fxAuto);
      applyFx();
    };
    settle = performance.now() + 3000; // die ersten Sekunden lädt noch alles
    document.documentElement.dataset.fx = fxLevel();
    requestAnimationFrame(tick);
  }

  /* =============================================================== Vollbild */
  // iPhone-Safari kennt keine Vollbild-API für Seiten – dort bleibt der Knopf versteckt
  function initFullscreen() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!request || !exit || document.fullscreenEnabled === false || document.webkitFullscreenEnabled === false) return;
    const current = () => document.fullscreenElement || document.webkitFullscreenElement;
    const icon = (on) => `<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${on
      ? 'M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6'
      : 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6'}"/></svg>`;
    const update = () => document.querySelectorAll('.fs-toggle').forEach((b) => {
      b.innerHTML = icon(!!current());
      b.setAttribute('aria-pressed', current() ? 'true' : 'false');
    });
    const toggle = () => {
      try {
        const p = current() ? exit.call(document) : request.call(root);
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* vom Browser abgelehnt */ }
    };
    document.querySelectorAll('.fs-toggle').forEach((b) => { b.hidden = false; b.addEventListener('click', toggle); });
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
      toggle();
    });
    update();
  }

  /* =============================================================== Tooltips */
  // Eigene Tooltips statt der nativen: Elemente mit data-tip="…" (Teile mit „ · “ werden zu Zeilen).
  function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
    let target = null;
    let timer = null;
    const hide = () => {
      clearTimeout(timer);
      tip.classList.remove('show');
      target = null;
    };
    const show = (el) => {
      if (!document.body.contains(el) || !el.dataset.tip) return;
      tip.innerHTML = el.dataset.tip.split(' · ').map((t) => `<div>${escapeHTML(t)}</div>`).join('');
      tip.classList.remove('below');
      tip.style.left = '0px';
      tip.style.top = '0px';
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const cx = r.left + r.width / 2;
      const left = Math.max(8, Math.min(innerWidth - w - 8, cx - w / 2));
      let top = r.top - h - 10;
      if (top < 8) { top = r.bottom + 10; tip.classList.add('below'); }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.setProperty('--ax', `${cx - left}px`);
      tip.classList.add('show');
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el === target) return;
      hide();
      if (!el) return;
      target = el;
      timer = setTimeout(() => show(el), 280);
    });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
  }

  // Für Tests und Fehlersuche in der Browser-Konsole: CG.state()
  window.CG.state = () => s;
  window.CG.previewQuartet = (p = 0, f = 3) => s && showQuartet(p, f);

  /*
   * Gemeinsam mit den übrigen Teilen der Oberfläche (ui-duel.js, ui-input.js, ui-online.js), die nach dieser
   * Datei laden und ihre Funktionen hier eintragen. s wechselt mit jeder Partie, deshalb als Getter.
   */
  const UI = (window.CG.UI = {
    get s() { return s; },
    $, animateLoot, beginRound, canSelect, center, closeAllOverlays, closeOverlay, confirmChoice, escapeHTML,
    launch, legendHTML, onStatChosen, online, openOverlay, oppName, overlayOpen, overviewHTML, rallyNow,
    reducedMotion, render, selectCard, showGameOver, showRules, sleep, statLabel, store, toMenu, ui, zoomCard,
    zoomTerrain,
    /** Startet die Oberfläche, wenn alle Teile geladen sind (index.html). */
    start() {
      initMenu();
      UI.initInput();
      initAudio();
      watchFrames();
      initFullscreen();
      initTooltips();
    },
  });
})();
