/*
 * Eingaben: Maus, Tastatur und Touch im Spiel, dazu das Spielmenü (Verlassen).
 * Teil der Oberfläche (ui.js): UI.s ist der aktuelle Spielstand, die übrigen Helfer kommen aus ui.js.
 */
(function () {
  'use strict';
  const UI = window.CG.UI;
  const {
    $, store, reducedMotion, ui, toMenu, onStatChosen, confirmChoice, overlayOpen, overviewHTML, legendHTML,
    canSelect, selectCard, rallyNow, openOverlay, closeOverlay, showRules, zoomCard, zoomTerrain, nextStep
  } = UI;

  function initInput() {
    const zoomTarget = (target) => {
      // Ausgespähte Karten: auch auf der Rückseite zeigt sich die Karte groß
      const spied = target.closest('.spied');
      return spied ? spied.querySelector('[data-zoom]') : target.closest('.qcard, .terrain');
    };
    const zoomEl = (el) => {
      if (el.classList.contains('terrain')) { zoomTerrain(UI.s.terrain.id); return; }
      // Lange gedrückte Handkarte ist nach dem Schließen der Großansicht ausgewählt und kann gleich ausgespielt werden
      if (el.dataset.card) selectCard(el.dataset.card, true);
      const id = el.dataset.card || el.dataset.zoom;
      if (id) zoomCard(id);
    };
    $('#game').addEventListener('click', (e) => {
      if (!UI.s) return;
      // Während das Duell Schritt für Schritt abläuft, springt ein Tippen zum Ergebnis (Menü und Übersicht bleiben erreichbar)
      if (ui.duel && !ui.duel.done && ui.showResult && !e.target.closest('button:not(#next-btn)')) { ui.duel.skip = true; return; }
      const card = e.target.closest('#hand [data-card]');
      // Handkarten wählt man aus; gerade nicht wählbare zeigen sich groß wie alle anderen Karten
      if (card) { if (canSelect(card.dataset.card)) selectCard(card.dataset.card); else zoomEl(card); return; }
      const statBtn = e.target.closest('[data-stat]');
      if (statBtn) { onStatChosen(statBtn.dataset.stat); return; }
      if (e.target.closest('#rally-btn')) { rallyNow(); return; }
      if (e.target.closest('#play-btn')) { confirmChoice(); return; }
      if (e.target.closest('#next-btn')) { nextStep(); return; }
      if (e.target.closest('#stall-leave')) { confirmLeave(); return; }
      // Antippen einer Karte auf dem Schlachtfeld (Gelände, Duellkarten, ausgespähte Karten) zeigt sie groß
      const zoom = zoomTarget(e.target);
      if (zoom) { zoomEl(zoom); return; }
      // Antippen einer freien Stelle hebt die Auswahl wieder auf
      if (ui.selected && !e.target.closest('button')) selectCard(ui.selected);
    });
    // Wer mit der Maus auf dem Schlachtfeld (der ganzen Lederfläche) oder dem Ergebnis verweilt, liest noch – der Countdown wartet
    $('#game').addEventListener('pointerover', (e) => {
      if (e.pointerType === 'mouse') ui.hoverHold = !!e.target.closest('.battlefield, #hand-title');
    });
    $('#game').addEventListener('pointerleave', () => { ui.hoverHold = false; });
    // Ein Klick oder Tippen irgendwohin (außer auf „Weiter“) schaltet das automatische Weiter für diese Runde ab –
    // nicht aber das Tippen, das das Duell überspringt oder die Quartett-Tafel wegklickt
    document.addEventListener('pointerdown', (e) => {
      if (!ui.showResult || !ui.duel || !ui.duel.done || document.querySelector('.quartet-show')) return;
      if (!e.target.closest('#next-btn')) ui.autoOff = true;
    }, true);
    // Lichtreflex und leichte Neigung folgen der Maus (Handkarten, Galerie, Großansicht, Menü)
    const tilt = (e) => {
      if (reducedMotion) return;
      const card = e.target.closest('#hand .qcard, .zoom .qcard, .gallery-grid .qcard, .menu-cards .qcard');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', `${Math.round(x * 100)}%`);
      card.style.setProperty('--my', `${Math.round(y * 100)}%`);
      card.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(1)}deg`);
      card.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(1)}deg`);
    };
    document.addEventListener('pointermove', tilt, { passive: true });
    // Rechtsklick (oder langes Drücken auf dem Handy) zeigt eine Karte groß.
    let pressed = false; // diese Berührung hat schon die Großansicht geöffnet
    $('#game').addEventListener('contextmenu', (e) => {
      if (!UI.s) return;
      const el = zoomTarget(e.target);
      if (!el) return;
      e.preventDefault();
      endPress();
      if (pressed) return; // schon per langem Drücken geöffnet (Android meldet beides)
      pressed = true;
      zoomEl(el);
    });
    // iOS Safari kennt kein contextmenu beim langen Drücken – dafür ein eigener Zeitgeber
    // Beim Drücken wächst die Karte sichtbar an, bis sich die Großansicht öffnet
    let press = null;
    const endPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press.shown.classList.remove('pressing');
      press = null;
    };
    document.addEventListener('pointerdown', (e) => { pressed = false; ui.lastPointer = e.pointerType; }, true);
    $('#game').addEventListener('pointerdown', (e) => {
      endPress();
      if (!UI.s || e.pointerType !== 'touch') return;
      const el = zoomTarget(e.target);
      if (!el) return;
      const shown = el.closest('.spied') || el;
      shown.classList.add('pressing');
      press = { x: e.clientX, y: e.clientY, shown, timer: setTimeout(() => { endPress(); pressed = true; store.set('zoom-tip', true); zoomEl(el); }, 350) };
    });
    $('#game').addEventListener('pointermove', (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress();
    });
    ['pointerup', 'pointercancel'].forEach((type) => $('#game').addEventListener(type, endPress));
    // Der Klick am Ende des langen Drückens wählt keine Karte aus und schließt die Großansicht nicht gleich wieder
    document.addEventListener('click', (e) => {
      if (pressed) { e.stopPropagation(); e.preventDefault(); pressed = false; }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const q = document.querySelector('.quartet-show');
        if (q) { q.click(); return; }
        // Spielende, Lobby und Verbindungsabbruch nicht per Esc überspringen
        if (!$('#overlay').classList.contains('hidden') && !$('#go-again') && !$('#lobby') && !$('#lost-ok')) closeOverlay();
        return;
      }
      const pager = document.querySelector('#overlay .gallery-pager');
      if (pager && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const b = pager.querySelector(e.key === 'ArrowLeft' ? '.prev' : '.next');
        if (!b.disabled) b.click();
        return;
      }
      if (!UI.s || overlayOpen() || e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // Strg+1 (Tab wechseln) usw. gehören dem Browser
      const focused = e.target.closest && e.target.closest('#hand [data-card]');
      if (e.key === ' ' && focused) {
        e.preventDefault();
        selectCard(focused.dataset.card);
      } else if (e.key.toLowerCase() === 'z') {
        // Großansicht: gewählte oder fokussierte Karte, sonst das Schlachtfeld
        const id = ui.selected || (focused && focused.dataset.card);
        if (id) zoomCard(id); else if (UI.s.terrain) zoomTerrain(UI.s.terrain.id);
      } else if (['1', '2', '3'].includes(e.key)) {
        const el = document.querySelector(`#hand [data-key="${e.key}"]`);
        if (el) selectCard(el.dataset.card);
      } else if (e.key.toLowerCase() === 'h' && $('#rally-btn') && !$('#rally-btn').disabled) {
        rallyNow();
      } else if (e.key === 'Enter') {
        // Ein fokussierter Knopf bekommt sein Enter selbst (der Browser klickt ihn); eine fokussierte Handkarte wird erst gewählt
        if (e.target.closest('button')) return;
        if (focused && ui.selected !== focused.dataset.card) {
          if (canSelect(focused.dataset.card)) selectCard(focused.dataset.card);
          return;
        }
        if ($('#next-btn')) nextStep();
        else if ($('#play-btn') && !$('#play-btn').disabled) confirmChoice();
      }
    });
    $('#menu-btn').addEventListener('click', confirmLeave);
    $('#help-btn').addEventListener('click', showRules);
    $('#overview-btn').addEventListener('click', () => {
      openOverlay(`<div class="modal"><h2>Quartett-Übersicht</h2><div class="legend">${legendHTML()}</div><br>
        <div class="overview">${overviewHTML()}</div><div class="buttons"><button class="btn-primary" data-close>Schließen</button></div></div>`);
    });
  }

  function confirmLeave() {
    // Handy hochkant: Ton, Musik, Vollbild und Regeln stehen nicht in der Kopfleiste, sondern hier
    const inMenu = [...document.querySelectorAll('.top-buttons .in-menu')].filter((b) => !b.hidden);
    const moved = inMenu.length && getComputedStyle(inMenu[0]).display === 'none';
    // Beschriftung wie das Original, bei den Symbolknöpfen ergänzt um ihren Namen
    const label = (b) => `${b.innerHTML}${b.dataset.label ? ` ${b.dataset.label}` : ''}`;
    const head = moved ? `<h2>Menü</h2><div class="game-menu">${inMenu.map((b, i) =>
      `<button class="btn-secondary${b.classList.contains('off') ? ' off' : ''}" data-proxy="${i}">${label(b)}</button>`).join('')}</div>
      <p>Zurück zum Hauptmenü? Die aktuelle Partie geht dabei verloren.</p>`
      : '<h2>Spiel verlassen?</h2><p>Die aktuelle Partie geht verloren.</p>';
    openOverlay(`<div class="modal">${head}
      <div class="buttons"><button class="btn-secondary" data-close>Weiterspielen</button><button class="btn-primary" id="leave-btn">Zum Menü</button></div></div>`);
    $('#leave-btn').addEventListener('click', toMenu);
    document.querySelectorAll('#overlay [data-proxy]').forEach((b) => {
      const orig = inMenu[+b.dataset.proxy];
      const sync = () => { b.innerHTML = label(orig); b.classList.toggle('off', orig.classList.contains('off')); };
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // kein zweites Klick-Geräusch – das Original klickt selbst
        orig.click();
        sync();
        setTimeout(sync, 200); // das Vollbild-Symbol wechselt erst nach dem Umschalten
      });
    });
  }

  Object.assign(UI, { initInput });
})();
