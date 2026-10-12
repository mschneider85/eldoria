/*
 * Duell zum Mitverfolgen: Schritte, hochzählende Werte und das automatische „Weiter“.
 * Teil der Oberfläche (ui.js): UI.s ist der aktuelle Spielstand, die übrigen Helfer kommen aus ui.js.
 */
(function () {
  'use strict';
  const { Engine, CARDS, STAT_IDS } = window.CG;
  const Snd = window.CG.Audio;
  const UI = window.CG.UI;
  const { $, sleep, reducedMotion, ui, beginRound, animateLoot, overlayOpen, statLabel, render, showGameOver } = UI;

  const STEP_FIRST_MS = 900; // so lange steht der Kartenwert allein, bevor die Fähigkeiten dazukommen
  const STEP_MS = 1000;      // Abstand der folgenden Schritte
  const COUNT_MS = 420;      // so lange zählt der Wert hoch oder runter

  /**
   * Das Duell zum Mitverfolgen: Unter den Werten erscheint Schritt für Schritt, was sie verändert –
   * erst die Regeln (Umlenken, Verrat), dann ersetzte Grundwerte (Gestaltwandel, Spiegel), dann Zu- und Abschläge.
   * Jeder Schritt: lines[p] = { text, cls } oder null, dazu Eigenschaft, Richtung und Werte danach.
   * stats[p]: die Eigenschaft, die auf Karte p markiert ist (beim Gestaltwandel ihr höchster Wert).
   */
  function duelSteps(r) {
    const cards = r.ids.map((id) => CARDS[id]);
    const steps = [];
    let stat = r.start;
    let stats = [stat, stat];
    let low = !!UI.s.terrain.lowWins;
    let vals = r.values.map((v) => v.raw);
    const add = (kind, lines) => steps.push({ kind, lines, stat, stats: stats.slice(), low, vals: vals.slice() });
    const line = (text, cls = 'ability') => ({ text, cls });
    const both = (text) => [line(text), line(text)];
    const one = (i, text) => (i === 0 ? [line(text), null] : [null, line(text)]);

    if (r.switchers.length === 2) add('ability', both('🔀 Umlenken hebt sich auf'));
    else if (r.switchers.length === 1 && r.stat !== r.start) {
      stat = r.stat;
      // Auch Karten mit Gestaltwandel oder Spiegel springen erst mit um – deren Fähigkeit folgt danach als eigener Schritt
      stats = [stat, stat];
      vals = cards.map((c) => c.stats[stat]);
      add('ability', [0, 1].map((i) => line(`${i === r.switchers[0] ? '🔀 ' : ''}${statLabel(stat)} zählt`)));
    }
    if (r.traitors.length) {
      // Verrat legt fest, dass der niedrigere Wert gewinnt – im Nebelsumpf gilt das ohnehin
      const text = low ? '🎭 Niedriger gewinnt ohnehin' : '🎭 Verrat: Niedriger gewinnt';
      low = true;
      add('ability', r.traitors.length === 2 ? both(text) : one(r.traitors[0], text));
    }
    // Gestaltwandel vor dem Spiegel – der Spiegel greift den schon gewandelten Wert auf
    for (const via of ['shift', 'mirror']) {
      const who = [0, 1].filter((i) => r.values[i].via === via);
      if (!who.length) continue;
      const lines = [null, null];
      for (const i of who) {
        vals[i] = r.values[i].base;
        if (via === 'shift') {
          // der höchste Wert der Karte – diese Zeile wird markiert
          stats[i] = STAT_IDS.find((st) => cards[i].stats[st] === r.values[i].base);
          lines[i] = line(`🌀 ${statLabel(stats[i])} zählt`);
        } else lines[i] = line('🪞 Spiegel: Gegner +5');
      }
      add('ability', lines);
    }
    const n = Math.max(r.values[0].mods.length, r.values[1].mods.length);
    for (let j = 0; j < n; j++) {
      const lines = [0, 1].map((i) => {
        const m = r.values[i].mods[j];
        if (!m) return null;
        vals[i] += m.amount;
        // grün, wenn es dem Besitzer hilft (wo der niedrigere Wert gewinnt, schaden Zuschläge)
        return line(`${m.amount > 0 ? '+' : '−'}${Math.abs(m.amount)} ${m.label}`, (m.amount > 0) !== r.low ? 'good' : 'bad');
      });
      add('mod', lines);
    }
    return steps;
  }

  /** Fähigkeiten, die nach dem Duell wirken – je Seite eine kurze Zeile unter der Karte (oder null). */
  function afterLines(r) {
    const lines = [null, null];
    const line = (text) => ({ text, cls: 'ability' });
    if (r.stolen) lines[r.winner] = line('🏴‍☠️ Plündert eine Karte');
    if (r.retreated) lines[1 - r.winner] = line('↩️ Zieht sich zurück');
    for (const p of [0, 1]) {
      if (r.spied[p]) lines[p] = line('🕵️ Späht eine Karte aus');
      if (CARDS[r.ids[p]].ability === 'runehorn' && r.notes.some((n) => n.startsWith('📯'))) lines[p] = line('📯 Schlachtruf bereit');
    }
    return lines;
  }

  /** Stand der Duell-Animation: Eigenschaft, je Karte markierte Eigenschaft, Richtung und angezeigte Werte. */
  function duelView() {
    const r = UI.s.result;
    const d = ui.duel;
    const last = d && d.steps[d.steps.length - 1];
    if (!d || d.done) return { stat: r.stat, stats: last ? last.stats : [r.stat, r.stat], low: r.low, vals: r.values.map((v) => v.total) };
    const cur = d.steps[d.k - 1];
    if (!cur) return { stat: r.start, stats: [r.start, r.start], low: !!UI.s.terrain.lowWins, vals: r.values.map((v) => v.raw) };
    return { stat: cur.stat, stats: cur.stats, low: cur.low, vals: cur.vals.map((v) => Math.max(0, v)) };
  }

  /** Wartet ms (ohne die Zeit, in der ein Fenster offen ist); true, wenn übersprungen oder abgebrochen. */
  async function stepPause(token, ms) {
    let left = ms;
    let last = performance.now();
    while (left > 0) {
      await sleep(50);
      if (token !== ui.token || ui.duel.skip) return true;
      const now = performance.now();
      if (!overlayOpen()) left -= now - last;
      last = now;
    }
    return false;
  }

  /** Lässt die Werte vom alten zum neuen Stand zählen (das Element wird jedes Mal neu gesucht – render() ersetzt es). */
  let countRun = 0; // ein neuer Zählvorgang (oder das Ende des Duells) hält den laufenden an
  const stopCount = () => { countRun++; };
  function countValues(from, to) {
    const run = ++countRun;
    const t0 = performance.now();
    const tick = () => {
      if (run !== countRun) return;
      const k = reducedMotion ? 1 : Math.min(1, (performance.now() - t0) / COUNT_MS);
      for (const p of [0, 1]) {
        const el = $(`#slot-${p} .value .num`);
        if (!el || from[p] === to[p]) continue;
        el.textContent = Math.round(from[p] + (to[p] - from[p]) * k);
        el.classList.toggle('up', k < 1 && to[p] > from[p]);
        el.classList.toggle('down', k < 1 && to[p] < from[p]);
      }
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  async function playDuel(token) {
    const d = ui.duel;
    for (const step of d.steps) {
      if (await stepPause(token, d.k ? STEP_MS : STEP_FIRST_MS)) return;
      const before = duelView();
      d.k++;
      render();
      const after = duelView();
      countValues(before.vals, after.vals);
      // Springt die Markierung auf eine andere Eigenschaft (Umlenken, Gestaltwandel), leuchtet die neue Zeile auf
      for (const p of [0, 1]) if (after.stats[p] !== before.stats[p]) $(`#slot-${p} .row.active`)?.classList.add('flash');
      Snd.play(step.kind === 'ability' ? 'magic' : 'click');
    }
    await stepPause(token, STEP_MS);
  }

  const AUTO_MS = 6000;       // Countdown für „Weiter“
  const AUTO_NOTES_MS = 2500; // länger, wenn Fähigkeiten gewirkt haben – dann gibt es mehr zu lesen

  /**
   * „Weiter“ von selbst: Ein Balken im Knopf läuft ab. Einblendungen, ein verstecktes Fenster und die
   * Maus auf Schlachtfeld oder Ergebnis halten ihn an; ein Klick oder Tippen irgendwohin schaltet ihn
   * für diese Runde ab – wer liest, hat dann Zeit. Nach der letzten Runde bleibt es beim Klick.
   */
  async function autoAdvance(token) {
    if (!UI.s.result || UI.s.phase === 'over') return;
    const total = AUTO_MS + (UI.s.result.notes.length ? AUTO_NOTES_MS : 0);
    let left = total;
    let last = performance.now();
    for (;;) {
      await sleep(80);
      if (token !== ui.token || !ui.showResult || ui.fly !== null) return;
      const now = performance.now();
      const btn = $('#next-btn');
      if (ui.autoOff) { if (btn) btn.style.setProperty('--auto', '0'); return; }
      if (!overlayOpen() && !ui.hoverHold && !document.hidden) left -= now - last;
      last = now;
      if (btn) btn.style.setProperty('--auto', Math.max(0, left / total).toFixed(3));
      if (left <= 0) { nextStep(); return; }
    }
  }

  async function nextStep() {
    // Läuft das Duell noch, springt „Weiter“ erst einmal zum Ergebnis
    if (ui.duel && !ui.duel.done) { ui.duel.skip = true; return; }
    if (!UI.s.result || ui.fly !== null || ui.presenting || overlayOpen()) return;
    const token = ui.token;
    ui.fly = true;
    await animateLoot();
    if (token !== ui.token) return;
    if (UI.s.phase === 'over') { ui.deckShown = null; ui.deckBefore = UI.s.players.map((pl) => pl.deck.length); render(); showGameOver(); return; }
    ui.pendingDraw = UI.s.result.drawn.map((d) => d.slice());
    Engine.nextRound(UI.s);
    beginRound();
  }

  Object.assign(UI, { duelSteps, afterLines, duelView, playDuel, autoAdvance, nextStep, stopCount });
})();
