/*
 * Kartendefinitionen und Heldenklassen.
 * Effekte bekommen einen Kontext: { state, me, target, self, E }
 *   me     – Index des Spielers, der die Karte ausspielt / besitzt
 *   target – gewähltes Ziel (Held oder Diener) oder null
 *   self   – der Diener selbst (bei Kampfschrei, Todesröcheln, Zugende)
 *   E      – Engine-Hilfsfunktionen (Schaden, Heilung, Beschwören …)
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const CLASSES = {
    mage: {
      id: 'mage', name: 'Magier', hero: 'Elara Sternenfeuer', portrait: '🧙‍♀️', color: '#3d6fe0',
      power: { name: 'Feuerpfeil', icon: '🔥', cost: 2, target: 'any', text: 'Verursacht 1 Schaden.',
        effect: (c) => c.E.damage(c.state, c.target, 1) },
    },
    warrior: {
      id: 'warrior', name: 'Krieger', hero: 'Brakk Eisenfaust', portrait: '🧔', color: '#b8342e',
      power: { name: 'Rüstung anlegen', icon: '🛡️', cost: 2, target: null, text: 'Erhalte 2 Rüstung.',
        effect: (c) => c.E.addArmor(c.state, c.me, 2) },
    },
    priest: {
      id: 'priest', name: 'Priester', hero: 'Seraphine Lichtweber', portrait: '👼', color: '#d9d2b6',
      power: { name: 'Geringe Heilung', icon: '✨', cost: 2, target: 'any', text: 'Stellt 2 Leben wieder her.',
        effect: (c) => c.E.heal(c.state, c.target, 2) },
    },
    hunter: {
      id: 'hunter', name: 'Jäger', hero: 'Rexxan Wildpfad', portrait: '🏹', color: '#3f9a3a',
      power: { name: 'Zuverlässiger Schuss', icon: '🎯', cost: 2, target: null, text: 'Fügt dem gegnerischen Helden 2 Schaden zu.',
        effect: (c) => c.E.damage(c.state, c.E.hero(c.state, 1 - c.me), 2) },
    },
    paladin: {
      id: 'paladin', name: 'Paladin', hero: 'Aldric Morgenlicht', portrait: '🤴', color: '#e0a82e',
      power: { name: 'Verstärkung', icon: '📯', cost: 2, target: null, needsBoardSpace: true, text: 'Beschwört einen 1/1-Rekruten.',
        effect: (c) => c.E.summon(c.state, c.me, 'recruit') },
    },
    warlock: {
      id: 'warlock', name: 'Hexenmeister', hero: 'Malgor Schattenrufer', portrait: '😈', color: '#8a3fc4',
      power: { name: 'Aderlass', icon: '🩸', cost: 2, target: null, text: 'Ziehe eine Karte und erleide 2 Schaden.',
        effect: (c) => { c.E.damage(c.state, c.E.hero(c.state, c.me), 2); c.E.draw(c.state, c.me, 1); } },
    },
  };

  const CARDS = {};
  function def(card) {
    CARDS[card.id] = Object.assign({ type: 'minion', cls: 'neutral', keywords: [], text: '', target: null }, card);
  }

  /* ---------------------------------------------------------------- Neutral */
  def({ id: 'squire', name: 'Schildknappe', cost: 1, attack: 1, health: 1, art: '🛡️', keywords: ['divineShield'], text: '<b>Gottesschild</b>' });
  def({ id: 'elf_archer', name: 'Elfenbogenschützin', cost: 1, attack: 1, health: 1, art: '🧝‍♀️', target: 'any',
    text: '<b>Kampfschrei:</b> Verursacht 1 Schaden.', battlecry: (c) => c.E.damage(c.state, c.target, 1) });
  def({ id: 'gnoll', name: 'Gnoll-Späher', cost: 1, attack: 2, health: 1, art: '🐗' });
  def({ id: 'goblin_bomber', name: 'Goblin-Sprengmeister', cost: 2, attack: 2, health: 1, art: '💣',
    text: '<b>Todesröcheln:</b> Fügt einem zufälligen Feind 2 Schaden zu.',
    deathrattle: (c) => { const t = c.E.randomAliveEnemy(c.state, c.me); if (t) c.E.damage(c.state, t, 2); } });
  def({ id: 'dwarf_guard', name: 'Zwergischer Wächter', cost: 2, attack: 1, health: 4, art: '⛏️', keywords: ['taunt'], text: '<b>Spott</b>' });
  def({ id: 'wolf', name: 'Waldwolf', cost: 2, attack: 3, health: 2, art: '🐺' });
  def({ id: 'moon_priestess', name: 'Mondbrunnen-Priesterin', cost: 2, attack: 1, health: 3, art: '🌙',
    text: 'Am Ende deines Zuges: Stellt 2 Leben deines Helden wieder her.',
    endOfTurn: (c) => c.E.heal(c.state, c.E.hero(c.state, c.me), 2) });
  def({ id: 'gnome_scholar', name: 'Gelehrter Gnom', cost: 3, attack: 2, health: 2, art: '📜',
    text: '<b>Kampfschrei:</b> Ziehe eine Karte.', battlecry: (c) => c.E.draw(c.state, c.me, 1) });
  def({ id: 'wolf_rider', name: 'Wolfsreiter', cost: 3, attack: 3, health: 1, art: '🐎', keywords: ['charge'], text: '<b>Ansturm</b>' });
  def({ id: 'iron_bear', name: 'Eisenpelzbär', cost: 3, attack: 3, health: 3, art: '🐻', keywords: ['taunt'], text: '<b>Spott</b>' });
  def({ id: 'field_medic', name: 'Feldsanitäterin', cost: 3, attack: 3, health: 2, art: '⚕️', target: 'any',
    text: '<b>Kampfschrei:</b> Stellt 3 Leben wieder her.', battlecry: (c) => c.E.heal(c.state, c.target, 3) });
  def({ id: 'troll', name: 'Troll-Berserker', cost: 4, attack: 4, health: 5, art: '🧌' });
  def({ id: 'wind_rider', name: 'Windreiter', cost: 4, attack: 3, health: 3, art: '🦅', keywords: ['windfury'], text: '<b>Windzorn</b>' });
  def({ id: 'warchief', name: 'Kriegshäuptling', cost: 5, attack: 4, health: 4, art: '🪓',
    text: '<b>Kampfschrei:</b> Gibt deinen anderen Dienern +1/+1.',
    battlecry: (c) => c.E.friendlyMinions(c.state, c.me).forEach((m) => { if (m !== c.self) c.E.buff(c.state, m, 1, 1); }) });
  def({ id: 'storm_giant', name: 'Sturmriese', cost: 6, attack: 6, health: 7, art: '🗿' });
  def({ id: 'ancient_dragon', name: 'Uralter Drache', cost: 8, attack: 8, health: 8, art: '🐉',
    text: '<b>Kampfschrei:</b> Fügt allen anderen Dienern 2 Schaden zu.',
    battlecry: (c) => c.E.allMinions(c.state).forEach((m) => { if (m !== c.self) c.E.damage(c.state, m, 2); }) });

  /* ------------------------------------------------------------------ Magier */
  def({ id: 'arcane_missiles', cls: 'mage', type: 'spell', name: 'Arkane Geschosse', cost: 1, art: '💫',
    text: 'Verursacht 3 Schaden, zufällig auf alle Feinde verteilt.',
    spell: (c) => { for (let i = 0; i < 3; i++) { const t = c.E.randomAliveEnemy(c.state, c.me); if (t) c.E.damage(c.state, t, 1); } } });
  def({ id: 'frostbolt', cls: 'mage', type: 'spell', name: 'Frostblitz', cost: 2, art: '❄️', target: 'any',
    text: 'Verursacht 3 Schaden und <b>friert</b> das Ziel <b>ein</b>.',
    spell: (c) => { c.E.damage(c.state, c.target, 3); c.E.freeze(c.state, c.target); } });
  def({ id: 'fireball', cls: 'mage', type: 'spell', name: 'Feuerball', cost: 4, art: '☄️', target: 'any',
    text: 'Verursacht 6 Schaden.', spell: (c) => c.E.damage(c.state, c.target, 6) });
  def({ id: 'flamestrike', cls: 'mage', type: 'spell', name: 'Flammenstoß', cost: 7, art: '🔥',
    text: 'Fügt allen gegnerischen Dienern 4 Schaden zu.',
    spell: (c) => c.E.enemyMinions(c.state, c.me).forEach((m) => c.E.damage(c.state, m, 4)) });

  /* ----------------------------------------------------------------- Krieger */
  def({ id: 'whirlwind', cls: 'warrior', type: 'spell', name: 'Wirbelwind', cost: 1, art: '🌪️',
    text: 'Fügt ALLEN Dienern 1 Schaden zu.', spell: (c) => c.E.allMinions(c.state).forEach((m) => c.E.damage(c.state, m, 1)) });
  def({ id: 'execute', cls: 'warrior', type: 'spell', name: 'Hinrichten', cost: 1, art: '⚔️', target: 'enemyMinion',
    targetFilter: (t) => t.health < t.maxHealth,
    text: 'Vernichtet einen <b>verletzten</b> gegnerischen Diener.', spell: (c) => c.E.destroy(c.state, c.target) });
  def({ id: 'shield_master', cls: 'warrior', name: 'Schildmeister', cost: 3, attack: 3, health: 4, art: '🪖', keywords: ['taunt'],
    text: '<b>Spott</b>. <b>Kampfschrei:</b> Erhalte 3 Rüstung.', battlecry: (c) => c.E.addArmor(c.state, c.me, 3) });
  def({ id: 'warlord', cls: 'warrior', name: 'Schlachtenfürst', cost: 5, attack: 5, health: 4, art: '🐂', keywords: ['charge'], text: '<b>Ansturm</b>' });

  /* ---------------------------------------------------------------- Priester */
  def({ id: 'pw_shield', cls: 'priest', type: 'spell', name: 'Machtwort: Schild', cost: 2, art: '🔰', target: 'minion',
    text: 'Gibt einem Diener +2 Leben. Ziehe eine Karte.',
    spell: (c) => { c.E.buff(c.state, c.target, 0, 2); c.E.draw(c.state, c.me, 1); } });
  def({ id: 'holy_smite', cls: 'priest', type: 'spell', name: 'Heiliger Schlag', cost: 1, art: '🌟', target: 'any',
    text: 'Verursacht 2 Schaden.', spell: (c) => c.E.damage(c.state, c.target, 2) });
  def({ id: 'sw_death', cls: 'priest', type: 'spell', name: 'Schattenwort: Tod', cost: 3, art: '💀', target: 'minion',
    targetFilter: (t) => t.attack >= 5,
    text: 'Vernichtet einen Diener mit mindestens 5 Angriff.', spell: (c) => c.E.destroy(c.state, c.target) });
  def({ id: 'holy_nova', cls: 'priest', type: 'spell', name: 'Heilige Nova', cost: 6, art: '☀️',
    text: 'Fügt allen Feinden 2 Schaden zu. Stellt bei allen befreundeten Charakteren 2 Leben wieder her.',
    spell: (c) => {
      c.E.enemyChars(c.state, c.me).forEach((t) => c.E.damage(c.state, t, 2));
      c.E.friendlyChars(c.state, c.me).forEach((t) => c.E.heal(c.state, t, 2));
    } });

  /* ------------------------------------------------------------------- Jäger */
  def({ id: 'arcane_shot', cls: 'hunter', type: 'spell', name: 'Arkaner Schuss', cost: 1, art: '🏹', target: 'any',
    text: 'Verursacht 2 Schaden.', spell: (c) => c.E.damage(c.state, c.target, 2) });
  def({ id: 'animal_companion', cls: 'hunter', type: 'spell', name: 'Tierbegleiter', cost: 2, art: '🐾', needsBoardSpace: true,
    text: 'Beschwört einen zufälligen Tierbegleiter (Grimmbär, Sturmkeiler oder Schattenluchs).',
    spell: (c) => c.E.summon(c.state, c.me, c.E.random(['pet_bear', 'pet_boar', 'pet_lynx'])) });
  def({ id: 'multishot', cls: 'hunter', type: 'spell', name: 'Mehrfachschuss', cost: 3, art: '🎯',
    text: 'Fügt zwei zufälligen gegnerischen Dienern 3 Schaden zu.',
    spell: (c) => {
      const pool = c.E.enemyMinions(c.state, c.me).filter((m) => m.health > 0);
      for (let i = 0; i < 2 && pool.length; i++) c.E.damage(c.state, pool.splice(Math.floor(Math.random() * pool.length), 1)[0], 3);
    } });
  def({ id: 'savannah_king', cls: 'hunter', name: 'Savannenkönig', cost: 5, attack: 3, health: 5, art: '🦁',
    text: '<b>Todesröcheln:</b> Beschwört zwei 2/2-Hyänen.',
    deathrattle: (c) => { c.E.summon(c.state, c.me, 'hyena'); c.E.summon(c.state, c.me, 'hyena'); } });

  /* ----------------------------------------------------------------- Paladin */
  def({ id: 'blessing_might', cls: 'paladin', type: 'spell', name: 'Segen der Macht', cost: 1, art: '💪', target: 'minion',
    text: 'Gibt einem Diener +2 Angriff.', spell: (c) => c.E.buff(c.state, c.target, 2, 0) });
  def({ id: 'argent_protector', cls: 'paladin', name: 'Argentumbeschützer', cost: 2, attack: 2, health: 2, art: '🛡️', target: 'friendlyMinion',
    text: '<b>Kampfschrei:</b> Gibt einem befreundeten Diener <b>Gottesschild</b>.',
    battlecry: (c) => c.E.giveShield(c.state, c.target) });
  def({ id: 'consecration', cls: 'paladin', type: 'spell', name: 'Weihe', cost: 5, art: '🔆',
    text: 'Fügt allen Feinden 2 Schaden zu.', spell: (c) => c.E.enemyChars(c.state, c.me).forEach((t) => c.E.damage(c.state, t, 2)) });
  def({ id: 'lightbringer', cls: 'paladin', name: 'Lichtbringer', cost: 8, attack: 6, health: 6, art: '👑', keywords: ['taunt', 'divineShield'],
    text: '<b>Spott</b>. <b>Gottesschild</b>' });

  /* ------------------------------------------------------------ Hexenmeister */
  def({ id: 'voidwalker', cls: 'warlock', name: 'Leerwandler', cost: 1, attack: 1, health: 3, art: '👤', keywords: ['taunt'], text: '<b>Spott</b>' });
  def({ id: 'shadow_bolt', cls: 'warlock', type: 'spell', name: 'Schattenblitz', cost: 2, art: '🌑', target: 'minion',
    text: 'Fügt einem Diener 4 Schaden zu.', spell: (c) => c.E.damage(c.state, c.target, 4) });
  def({ id: 'pit_lord', cls: 'warlock', name: 'Grubenfürst', cost: 4, attack: 5, health: 6, art: '👹',
    text: '<b>Kampfschrei:</b> Fügt deinem Helden 5 Schaden zu.', battlecry: (c) => c.E.damage(c.state, c.E.hero(c.state, c.me), 5) });
  def({ id: 'hellfire', cls: 'warlock', type: 'spell', name: 'Höllenfeuer', cost: 4, art: '🌋',
    text: 'Fügt ALLEN Charakteren 3 Schaden zu.', spell: (c) => c.E.allChars(c.state).forEach((t) => c.E.damage(c.state, t, 3)) });

  /* ---------------------------------------------------------------- Spezial */
  def({ id: 'coin', type: 'spell', name: 'Die Münze', cost: 0, art: '🪙', token: true,
    text: 'Erhalte 1 Manakristall nur für diesen Zug.', spell: (c) => c.E.gainMana(c.state, c.me, 1) });
  def({ id: 'recruit', cls: 'paladin', name: 'Rekrut', cost: 1, attack: 1, health: 1, art: '🗡️', token: true });
  def({ id: 'hyena', cls: 'hunter', name: 'Hyäne', cost: 2, attack: 2, health: 2, art: '🐕', token: true });
  def({ id: 'pet_bear', cls: 'hunter', name: 'Grimmbär', cost: 3, attack: 4, health: 4, art: '🐻', token: true, keywords: ['taunt'], text: '<b>Spott</b>' });
  def({ id: 'pet_boar', cls: 'hunter', name: 'Sturmkeiler', cost: 3, attack: 4, health: 2, art: '🐗', token: true, keywords: ['charge'], text: '<b>Ansturm</b>' });
  def({ id: 'pet_lynx', cls: 'hunter', name: 'Schattenluchs', cost: 3, attack: 3, health: 3, art: '🐆', token: true, keywords: ['windfury'], text: '<b>Windzorn</b>' });

  /** Baut ein 30-Karten-Deck: 4 Klassenkarten ×2 + alle 16 neutralen Karten, 6 davon doppelt. */
  function buildDeck(classId) {
    const all = Object.values(CARDS).filter((c) => !c.token);
    const classCards = all.filter((c) => c.cls === classId).map((c) => c.id);
    const neutrals = all.filter((c) => c.cls === 'neutral').map((c) => c.id);
    const doubled = shuffle(neutrals.slice()).slice(0, 30 - classCards.length * 2 - neutrals.length);
    return shuffle([...classCards, ...classCards, ...neutrals, ...doubled]);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  CG.CLASSES = CLASSES;
  CG.CARDS = CARDS;
  CG.buildDeck = buildDeck;
  CG.shuffle = shuffle;
})(globalThis);
