/*
 * Online-Partie im Gleichschritt: Züge senden und empfangen, Prüfsummen, Abrisse, Revanche und die Lobby.
 * Teil der Oberfläche (ui.js): UI.s ist der aktuelle Spielstand, die übrigen Helfer kommen aus ui.js.
 */
(function () {
  'use strict';
  const { Engine, CARDS, TERRAINS } = window.CG;
  const UI = window.CG.UI;
  const { $, sleep, store, ui, online, oppName, launch, toMenu, center, escapeHTML, render, openOverlay, closeAllOverlays } = UI;

  /* =============================================================== Online (Gleichschritt) */
  /*
   * Beide Geräte rechnen dieselbe Partie: Der Gastgeber lost einen Startwert aus, der Gast spielt
   * spiegelverkehrt (Engine-Option flip) und sitzt so bei sich ebenfalls unten. Übers Netz gehen nur
   * die Züge (Eigenschaft, Schlachtruf, Karte) mit ihrer Rundennummer; kommt ein Zug zu früh an,
   * wartet er in der Schlange, bis das Gerät so weit ist.
   */
  const Net = window.CG.Net;
  /*
   * Online-Zustand. Züge (stat/choose/rally) tragen eine laufende Nummer: Nach einem Verbindungsabriss
   * schickt jede Seite alle Züge nach der zuletzt empfangenen Nummer noch einmal (out), doppelte fallen weg (inSeq).
   * sums: Prüfsummen nach jedem Duell, [eigene, empfangene] je Runde.
   */
  const net = {
    host: false, oppName: '', rematch: [false, false], queue: [], wake: null,
    seed: null, out: [], inSeq: 0, sums: {}, held: false, drop: null, gone: null,
    heard: 0, away: false, // wann zuletzt etwas vom Gegner kam; hat er das Spiel gerade im Hintergrund?
    behind: null,          // seit wann seine Lebenszeichen zeigen, dass ihm Züge von mir fehlen
  };
  const PING_MS = 4000;     // Lebenszeichen während der Partie (mit der Zahl der empfangenen Züge)
  const SILENT_MS = 15000;  // so lange nichts gehört: Verbindung gestört (statt „lässt sich Zeit“)
  const MOVES = ['stat', 'choose', 'rally'];
  const QUEUE_MAX = 16;
  const DROP_WAIT_S = 60; // so lange wird nach einem Abriss auf den Mitspieler gewartet
  // Beide Geräte brauchen dieselben Karten, Regeln und Spielversion – sonst laufen die Partien auseinander
  const fingerprint = (() => {
    const str = JSON.stringify([Net.BUILD, CARDS, TERRAINS, Engine.HAND_SIZE, Engine.RALLY_RECHARGE]);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    return h;
  })();
  const myName = () => ($('#name1').value.trim() || 'Spieler').slice(0, 14);

  function wakeRemote() {
    const w = net.wake;
    net.wake = null;
    if (w) w();
  }

  /** Nächster Zug des Gegners in dieser Runde (einer der Typen). null, wenn die Partie inzwischen vorbei ist. */
  async function nextRemote(token, types) {
    net.held = false;
    for (;;) {
      if (token !== ui.token) return null;
      net.queue = net.queue.filter((m) => m.r >= UI.s.round);
      const i = net.queue.findIndex((m) => m.r === UI.s.round && types.includes(m.t));
      // held: Der Zug ist da und wartet nur noch auf ein offenes Fenster – der Gegner lässt sich nicht Zeit
      if (i >= 0) { net.held = true; return net.queue.splice(i, 1)[0]; }
      await new Promise((resolve) => { net.wake = resolve; });
    }
  }

  /** Eigener Zug an den Gegner – nummeriert und gemerkt, um ihn nach einem Abriss erneut zu schicken. */
  function sendMove(m) {
    m.seq = net.out.length + 1;
    net.out.push(m);
    Net.send(m);
  }

  const inGame = () => !!UI.s && online() && UI.s.phase !== 'over';

  function onNetMessage(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    net.heard = Date.now();
    if (m.t === 'ping' || m.t === 'away' || m.t === 'back') {
      if (m.t !== 'ping') net.away = m.t === 'away';
      // Fehlen dem Gegner Züge (unterwegs verloren), gleich noch einmal schicken – sonst warten beide aufeinander
      if (!UI.s || !online() || !Number.isInteger(m.seq)) return;
      const missing = net.out.filter((x) => x.seq > m.seq);
      missing.forEach((x) => Net.send(x));
      // Bleibt das so, kommen meine Nachrichten bei ihm nicht an – dann liegt es an der Verbindung, nicht an ihm
      net.behind = missing.length ? net.behind || Date.now() : null;
      return;
    }
    if (m.t === 'hello') {
      // beim Gastgeber: der Gast ist da – Partie auslosen und starten
      if (!net.host) return;
      // Mitten in der Partie meldet sich der Gast neu an: Er hat die Seite neu geladen, sein Spielstand ist weg
      if (inGame()) { Net.send({ t: 'bye' }); Net.close(); connectionLost(`${net.oppName || 'Der Gegner'} hat die Seite neu geladen – die Partie lässt sich nicht fortsetzen.`); return; }
      if (UI.s && online()) return; // Revanche läuft über 'again'
      if (m.fp !== fingerprint) { Net.send({ t: 'version' }); versionMismatch(); return; }
      net.oppName = String(m.name || 'Gast').slice(0, 14);
      startOnline();
    } else if (m.t === 'start') {
      if (net.host || inGame()) return; // Anfang einer Partie nur, wenn keine läuft (Revanche erst nach dem Spielende)
      net.oppName = String(m.name || 'Gastgeber').slice(0, 14);
      launchOnline(Number(m.seed) >>> 0);
    } else if (m.t === 'resume') {
      // Nach einem Abriss wieder da: alles noch einmal schicken, was der Gegner nicht bekommen hat
      if (!UI.s || !online() || m.seed !== net.seed) { Net.send({ t: 'bye' }); Net.close(); connectionLost('Die Partie ließ sich nach dem Verbindungsabriss nicht fortsetzen.'); return; }
      const seen = Number.isInteger(m.seq) ? m.seq : 0;
      net.out.filter((x) => x.seq > seen).forEach((x) => Net.send(x));
    } else if (m.t === 'sum') {
      if (!UI.s || !online() || !Number.isInteger(m.r) || m.r < UI.s.round - 1 || m.r > UI.s.round + 1) return;
      (net.sums[m.r] = net.sums[m.r] || [null, null])[1] = m.h;
      checkSum(m.r);
    } else if (m.t === 'version') {
      versionMismatch();
    } else if (m.t === 'again') {
      net.rematch[1] = true;
      if (net.host && net.rematch[0]) startOnline();
      else rematchNote(`${net.oppName} möchte eine Revanche!`);
    } else if (m.t === 'bye') {
      Net.close();
      connectionLost(`${net.oppName || 'Der Gegner'} hat das Spiel verlassen.`);
    } else if (MOVES.includes(m.t)) {
      if (!UI.s || !online() || !Number.isInteger(m.r) || !Number.isInteger(m.seq)) return;
      // Der Reihe nach: Doppelte (nach einem Abriss erneut geschickt) fallen weg, Lücken füllt das erneute Schicken
      if (m.seq !== net.inSeq + 1) return;
      // Der Gegner ist höchstens eine Runde voraus (er braucht für die nächste ja meinen Zug)
      if (m.r < UI.s.round || m.r > UI.s.round + 1 || net.queue.length >= QUEUE_MAX) { outOfSync(); return; }
      net.inSeq = m.seq;
      net.queue.push(m);
      wakeRemote();
    }
  }

  /** Nach jedem Duell: eigene Prüfsumme schicken und mit der des Gegners vergleichen. */
  function sendSum() {
    const h = Engine.digest(UI.s);
    (net.sums[UI.s.round] = net.sums[UI.s.round] || [null, null])[0] = h;
    Net.send({ t: 'sum', r: UI.s.round, h });
    checkSum(UI.s.round);
  }

  function checkSum(r) {
    const [mine, theirs] = net.sums[r] || [];
    if (mine == null || theirs == null) return;
    delete net.sums[r];
    if (mine !== theirs) outOfSync();
  }

  /**
   * Verbindung mitten in der Partie abgerissen (Raum): eine Weile warten und den Raum ab und zu neu betreten,
   * damit beide sich wiederfinden. Gelingt es, holt 'resume' die verpassten Züge nach.
   */
  function onDrop() {
    if (!inGame()) return false;
    const token = ui.token;
    const drop = (net.drop = { since: Date.now() });
    render();
    (async () => {
      for (let tries = 0; ; ) {
        await sleep(1000);
        if (token !== ui.token || net.drop !== drop) return;
        const secs = Math.floor((Date.now() - drop.since) / 1000);
        if (secs >= DROP_WAIT_S) {
          Net.close();
          connectionLost(`Die Verbindung zu ${net.oppName || 'deinem Mitspieler'} ist abgerissen und kam nicht wieder zustande.`);
          return;
        }
        // Gastgeber und Gast versetzt, damit sie sich nicht ständig verpassen
        if (secs >= (net.host ? 6 : 12) + tries * 15) { tries++; Net.rejoin(); }
        render();
      }
    })();
    return true;
  }

  /** Der Mitspieler ist nach einem Abriss wieder da. */
  // Dem Gegner sagen, wenn das Spiel hier im Hintergrund liegt – dann wartet er nicht ratlos
  document.addEventListener('visibilitychange', () => {
    if (UI.s && online() && UI.s.phase !== 'over') Net.send({ t: document.hidden ? 'away' : 'back', seq: net.inSeq });
  });

  function onRejoin() {
    net.drop = null;
    Net.send({ t: 'resume', seed: net.seed, seq: net.inSeq });
    render();
  }

  /** Gastgeber: neuen Startwert auslosen, dem Gast schicken und selbst loslegen. */
  function startOnline() {
    const seed = Math.floor(Math.random() * 2 ** 32);
    Net.send({ t: 'start', seed, name: myName() });
    launchOnline(seed);
  }

  function launchOnline(seed) {
    Object.assign(net, { rematch: [false, false], queue: [], seed, out: [], inSeq: 0, sums: {}, held: false, drop: null, gone: null, heard: Date.now(), away: false, behind: null });
    launch({ mode: 'online', seed, flip: !net.host, players: [{ name: 'Du', you: true }, { name: net.oppName }] });
  }

  const STALL_HINT_S = 30;  // ab dann zeigt ein Zähler, dass der Gegner auf sich warten lässt
  const STALL_LEAVE_S = 120; // ab dann kann man die Partie direkt dort verlassen

  /**
   * Wartet dieses Gerät auf einen Zug des Gegners (Eigenschaft oder Karte, die eigene ist schon gelegt)?
   * Gezogen wird nie für ihn – das könnte sich mit seinem echten Zug überkreuzen. Man sieht nur, wie lange es dauert.
   */
  async function watchStall(token) {
    let key = null, since = 0, pinged = 0;
    for (;;) {
      await sleep(1000);
      if (token !== ui.token) return;
      if (UI.s.phase !== 'over' && Date.now() - pinged >= PING_MS) {
        pinged = Date.now();
        Net.send({ t: 'ping', seq: net.inSeq });
      }
      // Kommt gar nichts mehr an, liegt es an der Verbindung – nicht am Gegner
      const now = Date.now();
      const deaf = now - net.heard > SILENT_MS;                      // von ihm kommt nichts an
      const mute = net.behind !== null && now - net.behind > SILENT_MS; // von mir kommt bei ihm nichts an
      const brokenSince = deaf ? net.heard : mute ? net.behind : null;
      const silent = !net.drop && !(deaf && net.away) && UI.s.phase !== 'over' && brokenSince !== null ? Math.floor((now - brokenSince) / 1000) : null;
      if (silent !== ui.silent) { ui.silent = silent; render(); }
      const waiting = !net.held && !net.drop && !net.queue.some((m) => m.r === UI.s.round)
        && (UI.s.phase === 'stat' ? UI.s.picker === 1 && !ui.tossing : UI.s.phase === 'cards' && !!UI.s.choices[0] && !UI.s.choices[1]);
      const k = waiting ? `${UI.s.round}-${UI.s.phase}` : null;
      if (k !== key) { key = k; since = Date.now(); }
      const secs = k ? Math.floor((Date.now() - since) / 1000) : 0;
      const stall = secs >= STALL_HINT_S ? secs : null;
      if (stall !== ui.stall) { ui.stall = stall; render(); }
    }
  }

  /** Hinweis im Spielende-Fenster (Toasts lägen unter dem Fenster). */
  function rematchNote(text) {
    const modal = $('#go-again') && $('#go-again').closest('.modal');
    if (!modal) return;
    let el = modal.querySelector('.net-status');
    if (!el) { el = document.createElement('p'); el.className = 'net-status'; modal.querySelector('.buttons').before(el); }
    el.textContent = text;
  }

  function goneNote() {
    const b = $('#go-again');
    if (!b || !net.gone) return;
    b.disabled = true;
    b.textContent = 'Revanche';
    rematchNote(`🔌 ${net.gone}`);
  }

  function askRematch() {
    net.rematch[0] = true;
    const b = $('#go-again');
    if (b) { b.disabled = true; b.textContent = 'Warte auf Mitspieler…'; }
    rematchNote(`${net.oppName} muss auch auf „Revanche“ tippen.`);
    Net.send({ t: 'again' });
    if (net.host && net.rematch[1]) startOnline();
  }

  function connectionLost(text) {
    if (!(UI.s && online()) && !$('#lobby')) return;
    // Nach dem Spielende bleibt das Ergebnis stehen – nur keine Revanche mehr
    if (UI.s && online() && UI.s.phase === 'over') {
      net.gone = text;
      goneNote();
      return;
    }
    ui.token++;
    wakeRemote();
    closeAllOverlays();
    openOverlay(`<div class="modal"><div class="big-emoji">🔌</div><h2>Verbindung getrennt</h2><p>${escapeHTML(text)}</p>
      <div class="buttons"><button class="btn-primary" id="lost-ok">Zum Menü</button></div></div>`);
    $('#lost-ok').addEventListener('click', () => { closeAllOverlays(); if (UI.s) toMenu(); });
  }

  function versionMismatch() {
    Net.close();
    connectionLost('Ihr habt unterschiedliche Spielversionen. Ladet beide die Seite neu und versucht es noch einmal.');
  }

  /** Sollte nie passieren: Die beiden Geräte sind sich über den Spielstand nicht mehr einig. */
  function outOfSync() {
    Net.bye({ t: 'bye' });
    connectionLost('Die Spielstände der beiden Geräte passen nicht mehr zusammen – die Partie wurde abgebrochen.');
  }

  /* ---------------------------------------------------------------- Lobby */
  function lobbyHTML(body) {
    return `<div class="modal lobby" id="lobby"><div class="big-emoji">👥</div><h2>Online spielen</h2>${body}
      <div class="buttons"><button class="btn-secondary" id="lobby-cancel">Abbrechen</button></div></div>`;
  }

  function setLobby(body) {
    closeAllOverlays();
    openOverlay(lobbyHTML(body));
    $('#lobby-cancel').addEventListener('click', () => { Net.close(); closeAllOverlays(); });
  }

  function codeBox(id, code) {
    const share = navigator.share ? `<button class="btn-small" data-share="${id}">📤 Teilen</button>` : '';
    return `<textarea class="net-code" id="${id}" readonly rows="4">${code}</textarea>
      <div class="net-actions"><button class="btn-small" data-copy="${id}">📋 Kopieren</button>${share}</div>`;
  }

  function bindCodeButtons() {
    document.querySelectorAll('#lobby [data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const el = $(`#${b.dataset.copy}`);
      try { await navigator.clipboard.writeText(el.value); } catch (e) { el.select(); document.execCommand('copy'); }
      b.textContent = '✔ Kopiert';
      setTimeout(() => { b.textContent = '📋 Kopieren'; }, 1800);
    }));
    document.querySelectorAll('#lobby [data-share]').forEach((b) => b.addEventListener('click', () => {
      navigator.share({ title: 'Eldoria', text: $(`#${b.dataset.share}`).value }).catch(() => {});
    }));
  }

  function lobbyError(e) {
    const el = $('#lobby .net-status');
    if (el) { el.textContent = `⚠️ ${e.message || e}`; el.classList.add('error'); }
  }

  /** Lobby öffnen; mit Raumcode (aus einem Einladungslink) direkt beim Beitreten. */
  function openLobby(code) {
    Net.close();
    Net.on('message', onNetMessage);
    Net.on('open', () => {
      if (UI.s && online()) { onRejoin(); return; }
      const st = $('#lobby .net-status');
      if (st) { st.classList.remove('error'); st.textContent = 'Verbunden! Die Partie beginnt…'; }
      if (!net.host) Net.send({ t: 'hello', name: myName(), fp: fingerprint });
    });
    Net.on('close', (wasOpen) => {
      if (wasOpen) connectionLost(`Die Verbindung zu ${net.oppName || 'deinem Mitspieler'} ist abgerissen.`);
      else lobbyError(new Error('Die Verbindung kam nicht zustande. Seid ihr beide online? In manchen Mobilfunknetzen klappt es nicht – dann hilft ein WLAN.'));
    });
    Net.on('error', (text) => lobbyError(new Error(text)));
    Net.on('drop', onDrop);
    if (code) { roomJoin(code); return; }
    setLobby(`<p>Lade jemanden zu einer Partie ein – per Link, QR-Code oder Raumcode.</p>
      <div class="buttons"><button class="btn-primary" id="lobby-host">🏰 Spiel eröffnen</button><button class="btn-primary" id="lobby-join">🗝️ Beitreten</button></div>
      <p class="net-alt"><button class="link-btn" id="lobby-manual">Klappt nicht? Ohne Vermittlung verbinden</button></p>`);
    $('#lobby-host').addEventListener('click', roomHost);
    $('#lobby-join').addEventListener('click', () => roomJoin(null));
    $('#lobby-manual').addEventListener('click', manualLobby);
  }

  /** Gastgeber: Raum eröffnen und Link, QR-Code und Raumcode zeigen. */
  async function roomHost() {
    net.host = true;
    const code = Net.newCode();
    const url = Net.link(code);
    setLobby('<p class="net-status">Raum wird eröffnet…</p>');
    let qr;
    try {
      // Auf localhost gibt es keinen QR-Code: Kein anderes Gerät könnte die Adresse öffnen
      [qr] = await Promise.all([Net.linkUsable() ? Net.qrSVG(url) : null, Net.enterRoom(code)]);
    } catch (e) { lobbyError(e); return; }
    if (!$('#lobby')) return;
    const share = navigator.share ? '<button class="btn-primary" id="share-link">📤 Link teilen</button>' : '';
    const intro = qr
      ? '<p class="net-step">Schick deinem Mitspieler den Link – oder lass ihn den QR-Code mit der Handykamera scannen.</p>'
      : `<p class="net-warn">⚠️ Das Spiel läuft gerade unter <b>${escapeHTML(location.host || 'einer lokalen Datei')}</b> – diese Adresse
        kann kein anderes Gerät öffnen, deshalb gibt es keinen QR-Code. Zum Spielen mit anderen Geräten muss das Spiel
        über HTTPS erreichbar sein (z. B. GitHub Pages). Auf diesem Rechner klappt der Raumcode in einem zweiten Browserfenster.</p>`;
    setLobby(`${intro}
      <div class="net-invite">${qr ? `<div class="net-qr">${qr}</div>` : ''}
        <div class="net-room"><span class="net-label">Raumcode</span><b class="net-roomcode">${Net.prettyCode(code)}</b>
          <div class="net-actions">${share}<button class="btn-small" id="copy-link">📋 Link kopieren</button></div></div></div>
      <p class="net-status">⏳ Warte auf Mitspieler…</p>`);
    if (share) $('#share-link').addEventListener('click', () => navigator.share({ title: 'Eldoria', text: 'Spielst du eine Runde Eldoria mit mir?', url }).catch(() => {}));
    $('#copy-link').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(url); b.textContent = '✔ Kopiert'; } catch (err) { b.textContent = url; }
      setTimeout(() => { b.textContent = '📋 Link kopieren'; }, 1800);
    });
  }

  /** Gast: Raumcode (vorausgefüllt aus dem Link) und Name, dann beitreten. */
  function roomJoin(code) {
    net.host = false;
    setLobby(`<div class="net-form">
        <label>Raumcode <input id="room-code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" value="${code ? Net.prettyCode(code) : ''}"></label>
        <label>Dein Name <input id="join-name" maxlength="14" value="${escapeHTML(myName())}"></label>
      </div>
      <div class="net-actions center"><button class="btn-primary" id="join-room">Beitreten</button></div>
      <p class="net-status"></p>`);
    const input = code ? $('#join-name') : $('#room-code');
    input.focus();
    input.select();
    const go = async () => {
      const c = Net.cleanCode($('#room-code').value);
      if (!c) { lobbyError(new Error('Der Raumcode hat 6 Zeichen, z. B. K7M‑Q2P.')); return; }
      $('#name1').value = $('#join-name').value.trim().slice(0, 14) || 'Spieler';
      store.set('name', $('#name1').value);
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = '🔎 Suche das Spiel…';
      $('#join-room').disabled = true;
      try { await Net.enterRoom(c); } catch (e) { lobbyError(e); $('#join-room').disabled = false; return; }
      setTimeout(() => {
        const s2 = $('#lobby .net-status');
        if (s2 && !Net.connected && !s2.classList.contains('error')) {
          s2.textContent = '🔎 Noch nicht gefunden – ist der Raum beim Gastgeber noch offen? Es wird weiter gesucht…';
        }
      }, 20000);
    };
    $('#join-room').addEventListener('click', go);
    $('#lobby').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#join-room').disabled) go(); });
  }

  /** Notlösung ohne Vermittlung: zwei lange Codes von Hand austauschen. */
  function manualLobby() {
    setLobby(`<p>Ganz ohne Vermittlung: Ihr tauscht zwei lange Codes selbst aus, z. B. per Messenger.</p>
      <div class="buttons"><button class="btn-primary" id="manual-host">🏰 Spiel eröffnen</button><button class="btn-primary" id="manual-join">🗝️ Einladung annehmen</button></div>`);
    $('#manual-host').addEventListener('click', lobbyHost);
    $('#manual-join').addEventListener('click', lobbyJoin);
  }

  async function lobbyHost() {
    net.host = true;
    setLobby('<p class="net-status">Einladung wird vorbereitet…</p>');
    let code;
    try { code = await Net.host(); } catch (e) { lobbyError(e); return; }
    if (!$('#lobby')) return;
    setLobby(`<p class="net-step"><b>1.</b> Schick diesen Einladungscode deinem Mitspieler:</p>${codeBox('offer-code', code)}
      <p class="net-step"><b>2.</b> Füge hier seinen Antwortcode ein:</p>
      <textarea class="net-code" id="answer-code" rows="3" placeholder="ELDORIA1-…"></textarea>
      <div class="net-actions"><button class="btn-primary" id="answer-btn">Verbinden</button></div>
      <p class="net-status"></p>`);
    bindCodeButtons();
    $('#answer-btn').addEventListener('click', async () => {
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = 'Verbinde…';
      try { await Net.accept($('#answer-code').value); } catch (e) { lobbyError(e); }
    });
  }

  function lobbyJoin() {
    net.host = false;
    setLobby(`<p class="net-step"><b>1.</b> Füge den Einladungscode des Gastgebers ein:</p>
      <textarea class="net-code" id="offer-code" rows="4" placeholder="ELDORIA1-…"></textarea>
      <div class="net-actions"><button class="btn-primary" id="join-btn">Weiter</button></div>
      <p class="net-status"></p>`);
    $('#join-btn').addEventListener('click', async () => {
      const st = $('#lobby .net-status');
      st.classList.remove('error');
      st.textContent = 'Antwort wird vorbereitet…';
      let code;
      try { code = await Net.join($('#offer-code').value); } catch (e) { lobbyError(e); return; }
      if (!$('#lobby')) return;
      setLobby(`<p class="net-step"><b>2.</b> Schick diesen Antwortcode zurück an den Gastgeber:</p>${codeBox('answer-code', code)}
        <p class="net-status">Warte, bis der Gastgeber deinen Code eingibt…</p>`);
      bindCodeButtons();
    });
  }

  Object.assign(UI, { net, DROP_WAIT_S, wakeRemote, nextRemote, sendMove, sendSum, STALL_LEAVE_S, watchStall, rematchNote, goneNote, askRematch, outOfSync, openLobby });
})();
