'use strict';

/* ================================================================ outils */
const TAURI = window.__TAURI__;
const call = (cmd, args) => (TAURI ? TAURI.core.invoke(cmd, args) : window.__mockInvoke(cmd, args));
const listen = (ev, cb) => (TAURI ? TAURI.event.listen(ev, cb) : window.__mockListen?.(ev, cb));
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—');
const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '—');
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(Math.round(n || 0)));
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const avg = (a, b) => (b ? a / b : 0);
const dur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(ts) {
  const s = (ts - Date.now()) / 1000;
  const units = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let v = s;
  for (const [n, u] of units) { if (Math.abs(v) < n) return rtf.format(Math.round(v), u); v /= n; }
}
const dateFr = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const dateTimeFr = (ts) => new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const wrCls = (w) => (w >= 50 ? 'win' : 'loss');
const kdaStr = (k, d, a) => (d ? fmt2((k + a) / d) : 'Parfait');

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = String(msg);
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), err ? 6000 : 3000);
}

/* ================================================================ données LoL */
const REGIONS = [['euw1', 'EUW'], ['eun1', 'EUNE'], ['na1', 'NA'], ['kr', 'KR'], ['jp1', 'JP'], ['br1', 'BR'], ['la1', 'LAN'], ['la2', 'LAS'], ['oc1', 'OCE'], ['tr1', 'TR'], ['ru', 'RU'], ['me1', 'ME'], ['ph2', 'PH'], ['sg2', 'SG'], ['th2', 'TH'], ['tw2', 'TW'], ['vn2', 'VN']];
const regionLabel = (p) => REGIONS.find((r) => r[0] === p)?.[1] || p;
const QUEUES = { 420: 'Classée Solo/Duo', 440: 'Classée Flex', 400: 'Normale Draft', 430: 'Normale Aveugle', 490: 'Partie rapide', 480: 'Swiftplay', 450: 'ARAM', 1700: 'Arena', 1710: 'Arena', 900: 'ARURF', 1900: 'URF', 1300: 'Nexus Blitz', 1400: 'Grimoire ultime', 700: 'Clash', 720: 'Clash ARAM', 2400: 'ARAM Chaos', 0: 'Personnalisée' };
const queueName = (q) => QUEUES[q] || (q >= 800 && q < 900 ? 'Coop vs IA' : 'Partie');
const QUEUE_CHIPS = [[null, 'Toutes'], [420, 'Solo/Duo'], [440, 'Flex'], [400, 'Draft'], [490, 'Rapide'], [450, 'ARAM'], [1700, 'Arena']];
const isArena = (m) => m.queue === 1700 || m.queue === 1710;
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger' };
const TIER_COLOR = { IRON: '#8b7f78', BRONZE: '#c0825a', SILVER: '#a9b6c2', GOLD: '#e9bd5d', PLATINUM: '#4fc1b0', EMERALD: '#2fcf7b', DIAMOND: '#7896ff', MASTER: '#b866ff', GRANDMASTER: '#ff5f72', CHALLENGER: '#f8d978' };
const DIV = { IV: 0, III: 100, II: 200, I: 300 };
const DIV_N = { IV: 4, III: 3, II: 2, I: 1 };
const QTYPE = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flexible' };
const isApex = (t) => TIERS.indexOf(t) >= 7;
const absLP = (s) => { const i = TIERS.indexOf(s.tier); if (i < 0) return 0; return i >= 7 ? 2800 + s.lp : i * 400 + (DIV[s.rank] ?? 0) + s.lp; };
const rankLabel = (s) => (!s?.tier ? 'Non classé' : isApex(s.tier) ? TIER_FR[s.tier] : `${TIER_FR[s.tier]} ${DIV_N[s.rank] ?? ''}`);
const RARITY = {
  kNoRarity: ['Standard', '#8a92ab'], kEpic: ['Épique', '#22d3ee'], kLegendary: ['Légendaire', '#f87171'],
  kMythic: ['Mythique', '#c084fc'], kUltimate: ['Ultime', '#f5c96a'], kTranscendent: ['Transcendant', '#a78bfa'], kExalted: ['Exalté', '#fb923c'],
};
const rarity = (r) => RARITY[r] || RARITY.kNoRarity;
const ROLES = [
  ['TOP', 'Haut', '<svg viewBox="0 0 24 24"><path d="M4 20V4h16"/><path d="M9 15V9h6" opacity=".6"/></svg>'],
  ['JUNGLE', 'Jungle', '<svg viewBox="0 0 24 24"><path d="M6 3c4 4 5 9 4 18M18 3c-4 4-5 9-4 18M12 8c1.5 3 1.5 7 0 13"/></svg>'],
  ['MIDDLE', 'Milieu', '<svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><path d="M4 9V4h5M20 15v5h-5" opacity=".6"/></svg>'],
  ['BOTTOM', 'Tireur', '<svg viewBox="0 0 24 24"><path d="M20 4v16H4"/><path d="M15 9v6H9" opacity=".6"/></svg>'],
  ['UTILITY', 'Support', '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></svg>'],
];
const roleOf = (k) => ROLES.find((r) => r[0] === k);
const CLASS_FR = { Fighter: 'Combattant', Mage: 'Mage', Assassin: 'Assassin', Marksman: 'Tireur', Support: 'Support', Tank: 'Tank' };

const ddv = () => S.dd?.version || '15.1.1';
const champ = (id) => S.dd?.byKey[id];
const champName = (id, fb) => champ(id)?.name || fb || '?';
const champImg = (id, fb) => `https://ddragon.leagueoflegends.com/cdn/${ddv()}/img/champion/${champ(id)?.id || fb}.png`;
const champSplash = (id, fb) => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champ(id)?.id || fb}_0.jpg`;
const itemImg = (id) => `https://ddragon.leagueoflegends.com/cdn/${ddv()}/img/item/${id}.png`;
const iconImg = (id) => `https://ddragon.leagueoflegends.com/cdn/${ddv()}/img/profileicon/${id}.png`;
const spellImg = (id) => { const s = S.dd?.spells?.[id]; return s ? `https://ddragon.leagueoflegends.com/cdn/${ddv()}/img/spell/${s.id}.png` : ''; };
const rune = (id) => S.dd?.runes?.[id];
const itemName = (id) => S.dd?.items?.[id]?.name || '';

const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M14 9l2 2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.5 6.5 19.5l1-6.3L3 8.9 9 8z"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>',
  live: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.5M7.8 16.2a6 6 0 0 1 0-8.5M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/></svg>',
  medal: '<svg viewBox="0 0 24 24"><path d="M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9L7 23l5-3 5 3-1.2-9.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M7 21V9l-2-2V3h3v2h2V3h4v2h2V3h3v4l-2 2v12z"/></svg>',
  dragon: '<svg viewBox="0 0 24 24"><path d="M4 18c3-1 5-4 5-8 2 2 4 2 6 0 0 4 2 7 5 8M9 10L6 4M15 10l3-6"/></svg>',
  baron: '<svg viewBox="0 0 24 24"><path d="M12 3c4 0 7 3 7 7 0 3-2 5-3 7v4H8v-4c-1-2-3-4-3-7 0-4 3-7 7-7zM9 11h.01M15 11h.01"/></svg>',
  sword: '<svg viewBox="0 0 24 24"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
  swords: '<svg viewBox="0 0 24 24"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/></svg>',
};

/* ================================================================ état */
const S = {
  settings: null, dd: null, view: 'overview', loading: false,
  profile: null, matches: [], moreLoading: false,
  openMatch: null, detailTab: 'board',
  histQueue: null, histChamp: '',
  all: null, allLoading: false, anQueue: null,
  champQueue: null, champSort: 'games', champDetail: null,
  sync: null,
  lpHist: null, lpQueue: 'RANKED_SOLO_5x5',
  mastery: null, masteryLoading: false, masteryQ: '', masteryClass: null, masterySort: 'points',
  live: undefined, liveLoading: false,
  client: null,
  premades: {}, premadeLoading: null, premadeLeft: 0,
  coach: {}, cmp: { q: '', b: null, bm: null, loading: false },
  meta: { status: null, overview: null, patch: 'auto', pos: null, bpos: null, q: '', champ: null, rows: null, spells: {}, sync: null, tab: 'build', muMin: 3, muSort: 'g', roleRows: {} },
  nav: { stack: [], idx: -1, restoring: false },
};

const mainId = () => (S.settings?.main_riot_id || '').trim().toLowerCase();
const riotIdOf = (p) => `${p.game_name}#${p.tag_line}`;
const isMain = (p) => p && mainId() === riotIdOf(p).toLowerCase();
const myPart = (m) => m.parts.find((x) => x.puuid === S.profile?.puuid);

/* ================================================================ calculs */
const teamKey = (m, p) => (isArena(m) ? 's' + p.subteam : 't' + p.team);
const teamOf = (m, p) => m.parts.filter((x) => teamKey(m, x) === teamKey(m, p));
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

const scoreCache = new WeakMap();
/** Note de performance (0-10) de chaque joueur, relative à la partie. */
function scores(m) {
  if (scoreCache.has(m)) return scoreCache.get(m);
  const raw = new Map();
  for (const p of m.parts) {
    const t = teamOf(m, p);
    const tk = Math.max(1, sum(t, (x) => x.k));
    const share = (f) => { const tot = sum(t, f); return tot ? (f(p) / tot) * t.length : 1; };
    const kda = Math.min((p.k + p.a) / Math.max(1, p.d), 12);
    let r = 0.28 * Math.min((p.k + p.a) / tk, 1) * 2.2 + 0.2 * share((x) => x.dmg) + 0.1 * share((x) => x.gold)
      + 0.08 * share((x) => x.vision) + 0.08 * share((x) => (x.obj_dmg || 0) + (x.turret_dmg || 0))
      + 0.06 * share((x) => x.cs) + 0.2 * (kda / 4) - 0.04 * share((x) => x.d);
    if (isArena(m) && p.placement) r += (8 - p.placement) * 0.08;
    raw.set(p.puuid, r);
  }
  const vals = [...raw.values()];
  const max = Math.max(...vals), min = Math.min(...vals);
  const sorted = [...m.parts].sort((a, b) => raw.get(b.puuid) - raw.get(a.puuid));
  const out = new Map();
  const winners = sorted.filter((p) => p.win), losers = sorted.filter((p) => !p.win);
  for (const p of m.parts) {
    const v = max === min ? 5 : 2 + (8 * (raw.get(p.puuid) - min)) / (max - min);
    out.set(p.puuid, {
      score: Math.round(v * 10) / 10,
      rank: sorted.indexOf(p) + 1,
      mvp: !m.remake && winners[0] === p,
      ace: !m.remake && !isArena(m) && losers[0] === p,
    });
  }
  scoreCache.set(m, out);
  return out;
}

function laneOpp(m, me) {
  if (!me.pos || isArena(m)) return null;
  return m.parts.find((p) => p.team !== me.team && p.pos === me.pos) || null;
}

/* ---------------------------------------------------------------- groupes (premades) */
const GRP_COLORS = ['#f3d38a', '#c084fc', '#22d3ee', '#fb923c', '#46d39a', '#ff7ab6'];
const GRP_LABEL = { 2: 'Duo', 3: 'Trio', 4: '4 stack', 5: '5 stack' };
const LINK_ICON = '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

/**
 * Regroupe les joueurs d'une même équipe qui ont au moins 2 parties récentes en commun.
 * teams : tableaux de puuid ; ids : puuid -> [matchId] ; exclude : partie analysée elle-même.
 * Renvoie puuid -> { n: numéro de groupe, size, color }.
 */
function computeGroups(teams, ids, exclude) {
  const out = {};
  let n = 0;
  for (const team of teams) {
    const ps = team.filter((p) => ids[p]?.length);
    const parent = Object.fromEntries(ps.map((p) => [p, p]));
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const sets = Object.fromEntries(ps.map((p) => [p, new Set(ids[p].filter((i) => i !== exclude))]));
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      let shared = 0;
      for (const id of sets[ps[i]]) if (sets[ps[j]].has(id) && ++shared >= 2) break;
      if (shared >= 2) parent[find(ps[i])] = find(ps[j]);
    }
    const groups = {};
    for (const p of ps) (groups[find(p)] ??= []).push(p);
    for (const g of Object.values(groups)) {
      if (g.length < 2) continue;
      const color = GRP_COLORS[n % GRP_COLORS.length];
      for (const p of g) out[p] = { n, size: g.length, color };
      n++;
    }
  }
  return out;
}

const grpBadge = (g) => (g ? `<span class="grp" style="color:${g.color}" data-tip="Joue en groupe : ${GRP_LABEL[g.size] || g.size + ' stack'} (parties récentes en commun)">${LINK_ICON}${GRP_LABEL[g.size] || g.size + ' stack'}</span>` : '');

function grpSummary(groups, puuids) {
  const seen = new Map();
  for (const p of puuids) { const g = groups?.[p]; if (g && !seen.has(g.n)) seen.set(g.n, g); }
  if (!seen.size) return groups ? '<span class="grp-sum"><span class="dim" style="font:500 12px var(--ui);text-transform:none;letter-spacing:0">Aucun groupe détecté</span></span>' : '';
  return `<span class="grp-sum">${[...seen.values()].map(grpBadge).join('')}</span>`;
}

/** Badges de groupe d'une partie : le mien et ceux des adversaires. */
function cardGroups(m, me) {
  const pm = S.premades[m.id];
  if (!pm) {
    const g = myGroupIn(m, me);
    return g.length ? `<span class="grp" style="color:var(--gold2);opacity:.75" data-tip="Probable (d'après tes parties) : avec ${esc(g.map((x) => x.name.split('#')[0]).join(', '))}">${LINK_ICON}${GRP_LABEL[g.length + 1] || g.length + 1 + ' stack'}</span>` : '';
  }
  const mine = pm[me.puuid];
  const mates = mine ? m.parts.filter((x) => x.puuid !== me.puuid && pm[x.puuid]?.n === mine.n) : [];
  const enemyGroups = new Map();
  for (const x of m.parts) { const g = pm[x.puuid]; if (g && teamKey(m, x) !== teamKey(m, me)) enemyGroups.set(g.n, g.size); }
  let out = mine ? `<span class="grp" style="color:var(--gold2)" data-tip="Avec ${esc(mates.map((x) => x.name.split('#')[0]).join(', '))}">${LINK_ICON}${GRP_LABEL[mine.size] || mine.size + ' stack'}</span>` : '';
  if (enemyGroups.size) out += `<span class="grp" style="color:#ff9aa0" data-tip="Groupes dans l'équipe adverse">Adv. ${[...enemyGroups.values()].map((n) => (GRP_LABEL[n] || n + ' stack').toLowerCase()).join(' + ')}</span>`;
  return out;
}

/** Groupe probable avec moi, d'après les parties déjà chargées (gratuit, sans requête). */
let myMatesCache = { key: null, map: {} };
function myMates() {
  const key = S.profile?.puuid + ':' + S.matches.length;
  if (myMatesCache.key === key) return myMatesCache.map;
  const map = {};
  for (const { m, me } of mineOf(S.matches)) for (const x of teamOf(m, me)) if (x.puuid !== me.puuid) map[x.puuid] = (map[x.puuid] || 0) + 1;
  myMatesCache = { key, map };
  return map;
}
function myGroupIn(m, me) {
  const mates = myMates();
  return teamOf(m, me).filter((x) => x.puuid !== me.puuid && (mates[x.puuid] || 0) >= 2);
}

/** Groupes calculés par le backend -> format d'affichage (avec couleurs). */
function grpConv(groups) {
  const out = {};
  for (const [pu, g] of Object.entries(groups || {})) out[pu] = { ...g, color: GRP_COLORS[g.n % GRP_COLORS.length] };
  return out;
}

/** Récupère les groupes déjà calculés et lance l'analyse des autres en arrière-plan. */
async function syncPremades(matches) {
  if (!S.profile || !matches?.length) return;
  const ids = matches.filter((m) => !m.remake && !S.premades[m.id]).map((m) => m.id);
  if (!ids.length) return;
  try {
    const got = await call('premades_get', { ids });
    for (const [id, g] of Object.entries(got)) S.premades[id] = grpConv(g);
    const missing = ids.filter((id) => !got[id]);
    if (Object.keys(got).length) render();
    if (missing.length) { S.premadeLeft = missing.length; await call('premades_queue', { ids: missing, platform: S.profile.platform }); }
  } catch {}
}

let premadeRenderT;
listen('premade', (ev) => {
  S.premades[ev.payload.id] = grpConv(ev.payload.groups);
  S.premadeLeft = ev.payload.left;
  clearTimeout(premadeRenderT);
  premadeRenderT = setTimeout(() => { if (['history', 'overview'].includes(S.view)) render(); }, 400);
});

async function detectMatchGroups(m) {
  S.premadeLoading = m.id; render();
  try {
    const ids = await call('recent_ids', { puuids: m.parts.map((p) => p.puuid), platform: S.profile.platform, around: m.creation });
    const teams = Object.values(m.parts.reduce((a, p) => ((a[teamKey(m, p)] ??= []).push(p.puuid), a), {}));
    S.premades[m.id] = computeGroups(teams, ids, m.id);
  } catch (e) { toast(e, true); }
  S.premadeLoading = null; render();
}

async function detectLiveGroups() {
  const g = S.live;
  if (!g || g.groups) return;
  g.groups = null; g.groupsLoading = true;
  try {
    const ids = await call('recent_ids', { puuids: g.players.map((p) => p.puuid).filter(Boolean), platform: S.profile.platform, around: null });
    const teams = [100, 200].map((t) => g.players.filter((p) => p.team === t).map((p) => p.puuid));
    g.groups = computeGroups(teams, ids, null);
  } catch (e) { g.groups = {}; }
  g.groupsLoading = false;
  if (S.live === g) render();
}

/** Statistiques agrégées sur une liste de { m, me }. */
function aggregate(list) {
  const t = { games: 0, wins: 0, k: 0, d: 0, a: 0, kp: 0, cs: 0, min: 0, dmg: 0, gold: 0, vision: 0, dshare: 0, dead: 0, secs: 0, fb: 0, solo: 0, score: 0, mvp: 0, doubles: 0, triples: 0, quadras: 0, pentas: 0, cs10: 0, cs10n: 0, taken: 0, wards: 0, pinks: 0 };
  for (const { m, me } of list) {
    if (m.remake) continue;
    const team = teamOf(m, me);
    t.games++; t.wins += me.win; t.k += me.k; t.d += me.d; t.a += me.a; t.cs += me.cs;
    t.min += m.duration / 60; t.secs += m.duration; t.dmg += me.dmg; t.gold += me.gold; t.vision += me.vision;
    t.taken += me.dmg_taken || 0; t.wards += me.wards || 0; t.pinks += me.pinks || 0;
    const tk = sum(team, (p) => p.k); t.kp += tk ? (me.k + me.a) / tk : 0;
    const td = sum(team, (p) => p.dmg); t.dshare += td ? me.dmg / td : 0;
    t.dead += me.dead || 0; t.fb += me.first_blood ? 1 : 0; t.solo += me.solo_kills || 0;
    t.doubles += me.doubles || 0; t.triples += me.triples || 0; t.quadras += me.quadras || 0; t.pentas += me.pentas || 0;
    if (me.cs10) { t.cs10 += me.cs10; t.cs10n++; }
    const sc = scores(m).get(me.puuid); t.score += sc.score; t.mvp += sc.mvp || sc.ace ? 1 : 0;
  }
  return t;
}

const mineOf = (matches) => matches.map((m) => ({ m, me: myPart(m) })).filter((x) => x.me);

/* ================================================================ petits composants */
const loader = (txt) => `<div class="loader"><div class="spin"></div>${esc(txt)}</div>`;
const empty = (icon, title, text, btn = '') =>
  `<div class="empty"><div class="icon">${ICONS[icon]}</div><h2>${title}</h2><p>${text}</p>${btn}</div>`;

function needProfile() {
  if (S.loading) return loader('Chargement du profil…');
  if (!S.settings?.api_key) return empty('key', 'Ajoute ta clé API Riot', 'Elle est nécessaire pour lire les profils, les parties et les rangs.', '<button class="btn primary" data-go="settings">Ouvrir les paramètres</button>');
  return empty('search', 'Aucun invocateur sélectionné', 'Recherche un joueur avec son Riot ID (Nom#TAG), ou enregistre ton compte dans les paramètres pour l\'afficher au démarrage.', '<button class="btn primary" data-go="settings">Définir mon compte</button>');
}

function donut(value, label, color = 'var(--accent2)') {
  const r = 44, c = 2 * Math.PI * r;
  return `<div class="donut"><svg width="108" height="108" viewBox="0 0 108 108">
    <circle cx="54" cy="54" r="${r}" stroke="var(--card3)" stroke-width="10"/>
    <circle cx="54" cy="54" r="${r}" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * value) / 100} ${c}"/>
  </svg><div class="c"><div>${value}%<small>${label}</small></div></div></div>`;
}

let emblemSeq = 0;
const EMBLEM_URL = (t) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${t.toLowerCase()}.png`;
/** Emblème officiel du palier (CommunityDragon) ; hexagone gris pour « non classé ». */
function emblem(tier, rank, cls = '') {
  if (tier && TIERS.includes(tier)) {
    return `<div class="emblem ${cls}" data-tip="${esc(rankLabel({ tier, rank }))}"><img src="${EMBLEM_URL(tier)}" alt="${esc(TIER_FR[tier])}" loading="lazy"></div>`;
  }
  return `<svg class="emblem ${cls}" viewBox="0 0 100 100">
    <path d="M50 8 L86 28 V68 L50 92 L14 68 V28 Z" fill="#24242f" stroke="rgba(255,255,255,.15)" stroke-width="2"/>
    <path d="M50 20 L75 34 V64 L50 80 L25 64 V34 Z" fill="#0b0b10" stroke="#3a3a48" stroke-width="2.5"/>
    <text x="50" y="58" text-anchor="middle" font-family="Bahnschrift, Segoe UI" font-weight="700" font-size="22" fill="#666" stroke="none">—</text></svg>`;
}

function rankCard(title, r) {
  if (!r) {
    return `<div class="card"><h3>${title}</h3><div class="rank-card">${emblem(null)}
      <div><div class="tier dim">Non classé</div><div class="lp">Aucune partie classée cette saison</div></div></div></div>`;
  }
  const wr = pct(r.wins, r.wins + r.losses);
  return `<div class="card"><h3>${title}<span class="r">${r.wins + r.losses} parties</span></h3><div class="rank-card">
    ${emblem(r.tier, r.rank)}
    <div class="grow"><div class="tier" style="color:${TIER_COLOR[r.tier]}">${rankLabel(r)}</div>
    <div class="lp"><b style="color:var(--text);font-size:15px">${r.lp} LP</b> · ${r.wins}V ${r.losses}D · <b class="${wrCls(wr)}">${wr}%</b></div>
    ${isApex(r.tier) ? '' : `<div class="row" style="gap:8px;margin-top:8px"><div class="progress gold" style="max-width:220px"><i style="width:${Math.min(100, r.lp)}%"></i></div><span class="dim" style="font-size:11.5px">${100 - Math.min(100, r.lp)} LP avant ${DIV_N[r.rank] === 1 ? 'promotion' : 'la division suivante'}</span></div>`}
    <div class="wl-bar"><i style="width:${wr}%"></i></div></div></div></div>`;
}

const scoreBadge = (sc) => `<span class="score${sc.rank === 1 ? ' top' : ''}" data-tip="Note de performance ShiganshinaGG (${sc.rank}e sur la partie)">${fmt1(sc.score)}</span>`;

function badges(m, me, sc) {
  const b = [];
  if (sc.mvp) b.push('<span class="badge mvp">MVP</span>');
  if (sc.ace) b.push('<span class="badge ace">ACE</span>');
  if (me.pentas) b.push('<span class="badge multi">Penta</span>');
  else if (me.quadras) b.push('<span class="badge multi">Quadra</span>');
  else if (me.triples) b.push('<span class="badge multi">Triple</span>');
  else if (me.doubles) b.push('<span class="badge plain">Double</span>');
  if (me.first_blood) b.push('<span class="badge fb">1er sang</span>');
  if (isArena(m) && me.placement) b.push(`<span class="badge ${me.placement === 1 ? 'mvp' : 'plain'}">${me.placement}${me.placement === 1 ? 'er' : 'e'}</span>`);
  return b.join('');
}

function spellsRunes(p, size = 24) {
  const sp = (p.spells || []).map((s) => (spellImg(s) ? `<img loading="lazy" src="${spellImg(s)}" alt="" data-tip="${esc(S.dd?.spells?.[s]?.name || '')}">` : '<span></span>'));
  const k = rune(p.keystone), st = rune(p.sub_style);
  const rr = [k ? `<img class="rune" loading="lazy" src="${k.icon}" alt="" data-tip="${esc(k.name)}">` : '<span></span>', st ? `<img class="rune" loading="lazy" src="${st.icon}" alt="" data-tip="${esc(st.name)}" style="padding:4px">` : '<span></span>'];
  return `<div class="sr" style="grid-template-columns:${size}px ${size}px">${sp[0] || '<span></span>'}${rr[0]}${sp[1] || '<span></span>'}${rr[1]}</div>`;
}

function itemsHtml(items, size = 26) {
  return (items || []).map((i, n) => (i
    ? `<img loading="lazy" src="${itemImg(i)}" alt="" data-tip="${esc(itemName(i))}" style="width:${size}px;height:${size}px${n === 6 ? ';border-radius:50%;margin-left:3px' : ''}">`
    : `<span style="width:${size}px;height:${size}px${n === 6 ? ';border-radius:50%;margin-left:3px' : ''}"></span>`)).join('');
}

/* ================================================================ navigation précédente / suivante */
function navSnap() {
  const p = S.profile;
  return { view: S.view, champ: S.champDetail, bchamp: S.view === 'builds' ? S.meta.champ : null, player: p ? { n: p.game_name, t: p.tag_line, p: p.platform } : null };
}
const sameNav = (a, b) => a && b && a.view === b.view && a.champ === b.champ && a.bchamp === b.bchamp && JSON.stringify(a.player) === JSON.stringify(b.player);
function pushNav() {
  const N = S.nav;
  if (N.restoring || S.loading) return;
  const snap = navSnap();
  if (sameNav(N.stack[N.idx], snap)) return;
  N.stack = N.stack.slice(0, N.idx + 1);
  N.stack.push(snap);
  if (N.stack.length > 100) N.stack.shift();
  N.idx = N.stack.length - 1;
}
function navUpdateButtons() {
  $('#navBack').disabled = S.nav.idx <= 0;
  $('#navFwd').disabled = S.nav.idx >= S.nav.stack.length - 1;
}
function navGo(delta) {
  const N = S.nav;
  const i = N.idx + delta;
  if (i < 0 || i >= N.stack.length) return;
  N.idx = i;
  const e = N.stack[i];
  const cur = S.profile;
  N.restoring = true;
  if (e.view === 'builds') { S.meta.champ = e.bchamp ?? null; if (e.bchamp != null) loadMetaChamp(e.bchamp, false); }
  if (e.player && (!cur || cur.game_name !== e.player.n || cur.tag_line !== e.player.t || cur.platform !== e.player.p)) {
    S.view = e.view;
    loadProfile(e.player.n, e.player.t, e.player.p, e.champ);
  } else {
    S.view = e.view;
    S.champDetail = e.champ;
    if (e.champ != null && !S.all) loadAll();
    render();
    enterView();
    $('#view').scrollTop = 0;
  }
  N.restoring = false;
  navUpdateButtons();
}

/* ================================================================ rendu */
function render() {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  const views = { compare: vCompare, builds: vBuilds, overview: vOverview, history: vHistory, analysis: vAnalysis, champions: vChampions, mastery: vMastery, live: vLive, lp: vLP, settings: vSettings };
  emblemSeq = 0;
  $('#view').innerHTML = views[S.view]() + (S.champDetail != null ? champDrawer() : '');
  if (S.view === 'settings') bindSettings();
  $('#liveDot').classList.toggle('on', !!S.live);
  const ms = $('#metaStatus');
  if (ms) { ms.classList.toggle('on', !!S.meta.sync); if (S.meta.sync) ms.querySelector('.txt').textContent = `Builds : import ${S.meta.sync.done}/${S.meta.sync.total}`; }
  pushNav();
  navUpdateButtons();
}

/* ---------------------------------------------------------------- Aperçu */
function vOverview() {
  const p = S.profile;
  if (!p) return needProfile();
  const solo = p.ranks.find((r) => r.queue === 'RANKED_SOLO_5x5');
  const flex = p.ranks.find((r) => r.queue === 'RANKED_FLEX_SR');
  const mine = mineOf(S.matches).slice(0, 20);
  const t = aggregate(mine);
  const wr = pct(t.wins, t.games);

  const byChamp = {};
  for (const { m, me } of mine) {
    if (m.remake) continue;
    const c = (byChamp[me.champ_id] ??= { id: me.champ_id, champ: me.champ, g: 0, w: 0, k: 0, d: 0, a: 0, cs: 0, min: 0 });
    c.g++; c.w += me.win; c.k += me.k; c.d += me.d; c.a += me.a; c.cs += me.cs; c.min += m.duration / 60;
  }
  const top = Object.values(byChamp).sort((a, b) => b.g - a.g || b.w - a.w).slice(0, 5);
  const splashChamp = top[0];

  // rôles
  const roles = {};
  for (const { m, me } of mine) if (!m.remake && me.pos) { const r = (roles[me.pos] ??= { g: 0, w: 0 }); r.g++; r.w += me.win; }
  const maxRole = Math.max(1, ...Object.values(roles).map((r) => r.g));
  const mainRole = Object.entries(roles).sort((a, b) => b[1].g - a[1].g)[0]?.[0];

  // coéquipiers fréquents
  const duos = {};
  for (const { m, me } of mineOf(S.matches)) {
    if (m.remake) continue;
    for (const x of teamOf(m, me)) {
      if (x.puuid === me.puuid || !x.name.includes('#')) continue;
      const d = (duos[x.puuid] ??= { name: x.name, g: 0, w: 0, champ: x.champ_id });
      d.g++; d.w += me.win; d.champ = x.champ_id;
    }
  }
  const duoList = Object.values(duos).filter((d) => d.g >= 2).sort((a, b) => b.g - a.g).slice(0, 5);

  // meilleure partie
  let best = null;
  for (const { m, me } of mine) { if (m.remake) continue; const sc = scores(m).get(me.puuid); if (!best || sc.score > best.sc.score) best = { m, me, sc }; }

  const fav = isFav(p);
  return `<div class="fade-in">
  ${S.live ? `<div class="live-banner mb" data-go="live"><span class="pulse"></span><b>En partie maintenant</b><span class="muted">${queueName(S.live.queue)} · ${champName(S.live.players.find((x) => x.puuid === p.puuid)?.champ_id)}</span><span class="btn sm" style="margin-left:auto">Voir la partie</span></div>` : ''}
  <div class="hero">
    ${splashChamp ? `<div class="splash" style="background-image:url('${champSplash(splashChamp.id, splashChamp.champ)}')"></div>` : ''}
    <div class="avatar"><img src="${iconImg(p.icon)}" alt=""><span class="lvl">${p.level}</span></div>
    <div>
      <h1>${esc(p.game_name)} <span>#${esc(p.tag_line)}</span></h1>
      <div class="chips-row">
        <span class="tag">${regionLabel(p.platform)}</span>
        ${isMain(p) ? '<span class="tag gold">Mon compte</span>' : ''}
        ${mainRole ? `<span class="tag">${roleOf(mainRole)?.[1] || ''} principal</span>` : ''}
        ${solo ? `<span class="tag" style="color:${TIER_COLOR[solo.tier]}">${rankLabel(solo)} · ${solo.lp} LP</span>` : ''}
        ${t.games && wr >= 60 ? '<span class="tag red">En feu</span>' : ''}
      </div>
    </div>
    <div class="actions">
      <button class="btn icon star-btn${fav ? ' on' : ''}" data-act="fav" data-tip="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ICONS.star}</button>
      <button class="btn" data-act="compare" data-tip="Comparer ce joueur avec un autre">${ICONS.swords}Comparer</button>
      ${isMain(p) ? '' : '<button class="btn" data-act="set-main">Définir comme mon compte</button>'}
      <button class="btn primary" data-act="refresh">${ICONS.refresh}Actualiser</button>
    </div>
  </div>

  <div class="grid g2 mt">${rankCard('Classée Solo/Duo', solo)}${rankCard('Classée Flexible', flex)}</div>
  ${(() => { const last = mineOf(S.matches).find(({ m, me }) => !m.remake && me.pos && !isArena(m) && m.queue !== 450); if (!last) return ''; const { m, me } = last; return `<div class="card mt"><h3>Coach — dernière partie<span class="r"><img class="cicon xs" style="vertical-align:middle" src="${champImg(me.champ_id, me.champ)}" alt=""> ${esc(champName(me.champ_id, me.champ))} · <span class="${me.win ? 'win' : 'loss'}">${me.win ? 'Victoire' : 'Défaite'}</span> · ${ago(m.creation)} · <span class="link" data-coach-match="${esc(m.id)}">Analyse complète</span></span></h3>${coachPanel(m, me, true)}</div>`; })()}

  <div class="grid mt" style="grid-template-columns:1.55fr 1fr">
    <div class="card">
      <h3>${t.games} dernières parties<span class="r">${t.games ? `Note moyenne <b class="gold">${fmt1(t.score / t.games)}</b>` : ''}</span></h3>
      ${t.games ? `
      <div class="row" style="gap:24px;align-items:center">
        ${donut(wr, `${t.wins}V ${t.games - t.wins}D`, wr >= 50 ? 'var(--win)' : 'var(--loss)')}
        <div class="grid g3 grow" style="gap:10px">
          <div class="kpi stat"><div class="label">KDA</div><div class="value">${kdaStr(t.k, t.d, t.a)}</div><div class="sub">${fmt1(t.k / t.games)} / <span class="loss">${fmt1(t.d / t.games)}</span> / ${fmt1(t.a / t.games)}</div></div>
          <div class="kpi stat"><div class="label">Participation</div><div class="value">${Math.round((t.kp * 100) / t.games)}%</div><div class="sub">aux éliminations</div></div>
          <div class="kpi stat"><div class="label">CS / min</div><div class="value">${fmt1(t.cs / t.min)}</div><div class="sub">${t.cs10n ? `${fmt1(t.cs10 / t.cs10n)} à 10 min` : '&nbsp;'}</div></div>
          <div class="kpi stat"><div class="label">Dégâts / min</div><div class="value">${fmt(t.dmg / t.min)}</div><div class="sub">${Math.round((t.dshare * 100) / t.games)}% de l'équipe</div></div>
          <div class="kpi stat"><div class="label">Vision / min</div><div class="value">${fmt2(t.vision / t.min)}</div><div class="sub">${fmt1(t.wards / t.games)} balises posées</div></div>
          <div class="kpi stat"><div class="label">MVP / ACE</div><div class="value gold">${t.mvp}</div><div class="sub">${t.pentas ? `${t.pentas} penta · ` : ''}${t.quadras} quadra · ${t.triples} triple</div></div>
        </div>
      </div>
      <div class="streak mt">${mine.map(({ m, me }) => `<i class="${m.remake ? 'r' : me.win ? 'w' : 'l'}" data-tip="${esc(champName(me.champ_id, me.champ))} · ${me.k}/${me.d}/${me.a} · ${queueName(m.queue)} · ${ago(m.creation)}">${m.remake ? 'R' : me.win ? 'V' : 'D'}</i>`).join('')}</div>`
      : S.moreLoading ? loader('Récupération des parties…') : '<p class="muted">Aucune partie récente.</p>'}
    </div>
    <div class="card">
      <h3>Rôles joués</h3>
      ${Object.keys(roles).length ? `<div class="roles">${ROLES.map(([k, l, ic]) => {
        const r = roles[k] || { g: 0, w: 0 };
        return `<div class="r${k === mainRole ? ' top-role' : ''}" data-tip="${l} : ${r.g} parties · ${pct(r.w, r.g)}% de victoires"><small>${r.g ? pct(r.w, r.g) + '%' : ''}</small><div class="bar" style="height:${(r.g / maxRole) * 70}%"></div>${ic}</div>`;
      }).join('')}</div>` : '<p class="muted">Pas de rôle détecté (ARAM, Arena…).</p>'}
      ${best ? `<div class="sec-title mt" style="margin-bottom:10px">Meilleure partie</div>
      <div class="list-row click" data-goto-match="${esc(best.m.id)}"><img class="cicon" src="${champImg(best.me.champ_id, best.me.champ)}" alt="">
        <div class="grow"><b>${esc(champName(best.me.champ_id, best.me.champ))}</b> <span class="${best.me.win ? 'win' : 'loss'}">${best.me.win ? 'Victoire' : 'Défaite'}</span><div class="muted" style="font-size:12px">${best.me.k}/${best.me.d}/${best.me.a} · ${fmtK(best.me.dmg)} dégâts · ${ago(best.m.creation)}</div></div>${scoreBadge(best.sc)}</div>` : ''}
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card">
      <h3>Champions récents</h3>
      ${top.length ? top.map((c) => {
        const w = pct(c.w, c.g);
        return `<div class="champ-mini link-row" data-champ="${c.id}" style="cursor:pointer">
          <img class="cicon" loading="lazy" src="${champImg(c.id, c.champ)}" alt="">
          <div class="grow"><b>${esc(champName(c.id, c.champ))}</b><div class="muted" style="font-size:12.5px">${kdaStr(c.k, c.d, c.a)} KDA · ${fmt1(c.cs / c.min)} CS/min</div></div>
          <div class="right"><b class="${wrCls(w)}">${w}%</b><div class="dim" style="font-size:12px">${c.g} partie${c.g > 1 ? 's' : ''}</div></div>
        </div>`;
      }).join('') : '<p class="muted">—</p>'}
    </div>
    <div class="card">
      <h3>Joue souvent avec<span class="r">sur ${mineOf(S.matches).length} parties chargées</span></h3>
      ${duoList.length ? duoList.map((d) => {
        const w = pct(d.w, d.g);
        return `<div class="champ-mini"><img class="cicon round" loading="lazy" src="${champImg(d.champ)}" alt="">
          <div class="grow"><span class="link" data-riot="${esc(d.name)}"><b>${esc(d.name.split('#')[0])}</b></span><span class="dim"> #${esc(d.name.split('#')[1] || '')}</span><div class="muted" style="font-size:12.5px">${d.g} parties ensemble</div></div>
          <b class="${wrCls(w)}">${w}%</b></div>`;
      }).join('') : '<p class="muted">Aucun coéquipier récurrent dans les parties chargées.</p>'}
    </div>
  </div>

  <div class="row mt" style="justify-content:space-between"><div class="sec-title" style="margin:0">Dernières parties</div><button class="btn sm" data-go="history">Tout l'historique</button></div>
  <div class="mt">${mineOf(S.matches).slice(0, 5).map(({ m, me }) => matchCard(m, me)).join('')}</div>
  </div>`;
}

/* ---------------------------------------------------------------- Historique */
function matchCard(m, me) {
  const cls = m.remake ? 'r' : me.win ? 'w' : 'l';
  const res = m.remake ? 'Remake' : isArena(m) && me.placement ? `${me.placement}${me.placement === 1 ? 'er' : 'e'} place` : me.win ? 'Victoire' : 'Défaite';
  const min = Math.max(1, m.duration / 60);
  const team = teamOf(m, me);
  const kp = pct(me.k + me.a, sum(team, (p) => p.k));
  const sc = scores(m).get(me.puuid);
  const open = S.openMatch === m.id;
  const opp = laneOpp(m, me);
  return `<div class="match ${cls}${open ? ' open' : ''}" data-match="${esc(m.id)}" id="m-${esc(m.id)}">
    <div class="bar"></div>
    <div><div class="res">${res}</div><div class="meta">${queueName(m.queue)}<br>${ago(m.creation)} · ${dur(m.duration)}</div></div>
    <div class="champ"><img class="cicon lg" loading="lazy" src="${champImg(me.champ_id, me.champ)}" alt="" data-tip="${esc(champName(me.champ_id, me.champ))}"><span class="lv">${me.level}</span></div>
    ${spellsRunes(me)}
    <div class="kda"><b>${me.k} / <span class="loss">${me.d}</span> / ${me.a}</b><div class="ratio">${kdaStr(me.k, me.d, me.a)} KDA · ${kp}% KP</div><div class="badges">${badges(m, me, sc)}${cardGroups(m, me)}</div></div>
    <div class="items">${itemsHtml(me.items)}</div>
    <div class="nums"><b>${me.cs}</b> CS (${fmt1(me.cs / min)}) · <b>${fmtK(me.dmg)}</b> dég.<br><b>${fmtK(me.gold)}</b> or · vision <b>${me.vision}</b>${opp ? `<br><span class="dim">vs</span> <img class="cicon xs" style="vertical-align:middle" src="${champImg(opp.champ_id, opp.champ)}" alt=""> ${esc(champName(opp.champ_id, opp.champ))}` : ''}</div>
    <div class="row" style="gap:10px;justify-content:flex-end">${scoreBadge(sc)}<div class="mini-team">${miniTeams(m)}</div></div>
    <svg class="chev" viewBox="0 0 24 24" width="18" height="18"><path d="M6 9l6 6 6-6"/></svg>
  </div>${open ? matchDetail(m, me) : ''}`;
}

function miniTeams(m) {
  if (isArena(m)) return '';
  return [100, 200].map((t) => m.parts.filter((p) => p.team === t).map((p) =>
    `<img loading="lazy" src="${champImg(p.champ_id, p.champ)}" alt="" data-tip="${esc(p.name)} · ${esc(champName(p.champ_id, p.champ))}"${p.puuid === S.profile.puuid ? ' style="outline:1.5px solid var(--gold2)"' : ''}>`).join('')).join('');
}

function matchDetail(m, me) {
  const tabs = [['board', 'Tableau'], ['teams', 'Équipes'], ['me', 'Ma performance'], ['coach', 'Coach']];
  const body = S.detailTab === 'teams' ? detailTeams(m) : S.detailTab === 'me' ? detailMe(m, me) : S.detailTab === 'coach' ? coachPanel(m, me) : detailBoard(m);
  const pm = S.premades[m.id];
  const grpBtn = pm || m.remake ? '' : '<span class="dim" style="font-size:12px;align-self:center;margin-right:12px"><span class="spin" style="width:10px;height:10px;border-width:2px;display:inline-block;vertical-align:-1px"></span> Détection des groupes en cours…</span>';
  return `<div class="match-detail fade-in"><div class="tabs">${tabs.map(([k, l]) => `<button class="${S.detailTab === k ? 'on' : ''}" data-dtab="${k}">${l}</button>`).join('')}
    <span class="grow"></span>${grpBtn}<span class="dim" style="font-size:12px;align-self:center">Patch ${esc(m.patch || '?')} · ${dateTimeFr(m.creation)}</span></div>${body}</div>`;
}

function detailBoard(m) {
  const sc = scores(m);
  const groups = {};
  for (const p of m.parts) (groups[teamKey(m, p)] ??= []).push(p);
  const maxDmg = Math.max(...m.parts.map((p) => p.dmg), 1);
  const min = Math.max(1, m.duration / 60);
  return Object.entries(groups).map(([key, ps]) => {
    const won = ps[0]?.win;
    const ti = m.teams?.find((t) => 't' + t.id === key);
    const tk = sum(ps, (p) => p.k);
    const label = isArena(m) ? `Duo · ${ps[0].placement || '?'}e place` : m.remake ? 'Équipe' : won ? 'Victoire' : 'Défaite';
    const pm = S.premades[m.id];
    return `<div class="team-head ${m.remake ? 'dim' : won ? 'win' : 'loss'}">${label} <span class="muted" style="font:500 12px var(--ui)">${key === 't100' ? 'côté bleu' : key === 't200' ? 'côté rouge' : ''}</span>${pm ? grpSummary(pm, ps.map((p) => p.puuid)) : ''}
      ${ti ? `<div class="objs"><span data-tip="Tours">${ICONS.tower}${ti.tower}</span><span data-tip="Dragons">${ICONS.dragon}${ti.dragon}</span><span data-tip="Barons">${ICONS.baron}${ti.baron}</span><span data-tip="Larves du Néant">◆ ${ti.grubs}</span><span><b style="color:var(--text)">${tk}</b>&nbsp;éliminations</span></div>` : ''}</div>
    <table class="ptable mb"><thead><tr><th>Joueur</th><th>Note</th><th>KDA</th><th>Dégâts</th><th>Or</th><th>CS</th><th>Vision</th><th>Objets</th></tr></thead><tbody>
    ${ps.map((p) => {
      const s = sc.get(p.puuid);
      const gp = S.premades[m.id]?.[p.puuid];
      return `<tr class="${p.puuid === S.profile.puuid ? 'me' : ''}${gp ? ' in-grp' : ''}"${gp ? ` style="--gc:${gp.color}"` : ''}>
        <td><div class="row" style="gap:8px"><img class="cicon sm" loading="lazy" src="${champImg(p.champ_id, p.champ)}" alt="" data-tip="${esc(champName(p.champ_id, p.champ))} · niv. ${p.level}">${spellsRunes(p, 14)}
          <span class="n${p.name.includes('#') ? ' link' : ''}" data-riot="${esc(p.name)}" data-tip="${esc(p.name)}">${esc(p.name.split('#')[0] || champName(p.champ_id, p.champ))}</span>${grpBadge(gp)}</div></td>
        <td>${scoreBadge(s)}${s.mvp ? ' <span class="badge mvp">MVP</span>' : s.ace ? ' <span class="badge ace">ACE</span>' : ''}</td>
        <td><b>${p.k}/${p.d}/${p.a}</b> <span class="dim">${kdaStr(p.k, p.d, p.a)} · ${pct(p.k + p.a, tk)}%</span></td>
        <td><div class="minibar"><div class="progress"><i style="width:${(p.dmg * 100) / maxDmg}%"></i></div><span>${fmtK(p.dmg)}</span></div></td>
        <td>${fmtK(p.gold)}</td>
        <td>${p.cs} <span class="dim">${fmt1(p.cs / min)}</span></td>
        <td>${p.vision} <span class="dim" data-tip="Balises posées / détruites / pinks">${p.wards || 0}/${p.wards_killed || 0}/${p.pinks || 0}</span></td>
        <td><div class="row" style="gap:2px">${itemsHtml(p.items, 20)}</div></td></tr>`;
    }).join('')}</tbody></table>`;
  }).join('');
}

function detailTeams(m) {
  if (isArena(m) || m.parts.length !== 10) return '<p class="muted">Comparaison disponible pour les parties à 5 contre 5.</p>';
  const blue = m.parts.filter((p) => p.team === 100), red = m.parts.filter((p) => p.team === 200);
  const tb = m.teams?.find((t) => t.id === 100) || {}, tr = m.teams?.find((t) => t.id === 200) || {};
  const rows = [
    ['Éliminations', sum(blue, (p) => p.k), sum(red, (p) => p.k)],
    ['Or', sum(blue, (p) => p.gold), sum(red, (p) => p.gold), fmtK],
    ['Dégâts aux champions', sum(blue, (p) => p.dmg), sum(red, (p) => p.dmg), fmtK],
    ['Dégâts subis', sum(blue, (p) => p.dmg_taken), sum(red, (p) => p.dmg_taken), fmtK],
    ['Dégâts aux objectifs', sum(blue, (p) => p.obj_dmg), sum(red, (p) => p.obj_dmg), fmtK],
    ['Sbires', sum(blue, (p) => p.cs), sum(red, (p) => p.cs)],
    ['Score de vision', sum(blue, (p) => p.vision), sum(red, (p) => p.vision)],
    ['Tours', tb.tower || 0, tr.tower || 0],
    ['Dragons', tb.dragon || 0, tr.dragon || 0],
    ['Larves du Néant', tb.grubs || 0, tr.grubs || 0],
    ['Hérauts', tb.herald || 0, tr.herald || 0],
    ['Barons', tb.baron || 0, tr.baron || 0],
    ['Inhibiteurs', tb.inhib || 0, tr.inhib || 0],
  ];
  const firsts = [['Premier sang', tb.first_blood, tr.first_blood], ['Première tour', tb.first_tower, tr.first_tower], ['Premier dragon', tb.first_dragon, tr.first_dragon]];
  const bans = (t) => (t.bans || []).filter((b) => b > 0).map((b) => `<img class="cicon xs" style="filter:grayscale(.8)" src="${champImg(b)}" alt="" data-tip="Banni : ${esc(champName(b))}">`).join('');
  return `<div class="row mb" style="justify-content:space-between"><b class="win">Équipe bleue ${tb.win ? '· Victoire' : ''}</b><b class="loss">${tr.win ? 'Victoire · ' : ''}Équipe rouge</b></div>
    ${rows.map(([l, a, b, f = fmt]) => {
      const mx = Math.max(a, b, 1);
      return `<div class="cmp-row"><b>${f(a)}</b><div class="l"><i style="width:${(a * 100) / mx}%"></i></div><div class="lab">${l}</div><div class="rr"><i style="width:${(b * 100) / mx}%"></i></div><b class="right">${f(b)}</b></div>`;
    }).join('')}
    <div class="row mt wrap" style="gap:8px">${firsts.map(([l, a, b]) => `<span class="tag ${a ? 'blue' : b ? 'red' : ''}">${l} : ${a ? 'bleu' : b ? 'rouge' : '—'}</span>`).join('')}</div>
    ${(tb.bans?.length || tr.bans?.length) ? `<div class="row mt" style="justify-content:space-between"><div class="row" style="gap:4px">${bans(tb)}</div><span class="dim" style="font-size:12px">Bannissements</span><div class="row" style="gap:4px">${bans(tr)}</div></div>` : ''}`;
}

function detailMe(m, me) {
  const min = Math.max(1, m.duration / 60);
  const team = teamOf(m, me);
  const opp = laneOpp(m, me);
  const tot = Math.max(1, (me.phys || 0) + (me.magic || 0) + (me.true_dmg || 0));
  const line = (l, v, o) => `<div class="list-row"><span class="muted grow">${l}</span><b>${v}</b>${o !== undefined ? `<span class="dim" style="width:90px;text-align:right">${o}</span>` : ''}</div>`;
  return `<div class="grid g2">
    <div>
      <div class="sec-title">Dégâts</div>
      <div class="row mb" style="gap:0;height:10px;border-radius:6px;overflow:hidden">
        <i style="width:${((me.phys || 0) * 100) / tot}%;background:#ff7a59;height:100%" data-tip="Physiques : ${fmt(me.phys)}"></i>
        <i style="width:${((me.magic || 0) * 100) / tot}%;background:#7a8cff;height:100%" data-tip="Magiques : ${fmt(me.magic)}"></i>
        <i style="width:${((me.true_dmg || 0) * 100) / tot}%;background:#e8e2d4;height:100%" data-tip="Bruts : ${fmt(me.true_dmg)}"></i>
      </div>
      <div class="row dim mb" style="font-size:12px;gap:14px"><span><b style="color:#ff7a59">■</b> Physiques ${pct(me.phys || 0, tot)}%</span><span><b style="color:#7a8cff">■</b> Magiques ${pct(me.magic || 0, tot)}%</span><span><b style="color:#e8e2d4">■</b> Bruts ${pct(me.true_dmg || 0, tot)}%</span></div>
      ${line('Dégâts aux champions', fmt(me.dmg), `${fmt(me.dmg / min)}/min`)}
      ${line('Part des dégâts de l\'équipe', pct(me.dmg, sum(team, (p) => p.dmg)) + ' %')}
      ${line('Dégâts subis', fmt(me.dmg_taken), `${fmt((me.dmg_taken || 0) / min)}/min`)}
      ${line('Dégâts atténués', fmt(me.mitigated))}
      ${line('Soins / boucliers alliés', `${fmt(me.heal)} / ${fmt(me.shield)}`)}
      ${line('Dégâts aux bâtiments / objectifs', `${fmtK(me.turret_dmg || 0)} / ${fmtK(me.obj_dmg || 0)}`)}
      ${line('Contrôle de foule infligé', `${me.cc || 0} s`)}
    </div>
    <div>
      <div class="sec-title">Laning & macro</div>
      ${line('CS à 10 min', me.cs10 ? fmt(me.cs10) : '—')}
      ${line('Avance max. en CS sur le vis-à-vis', me.cs_adv ? '+' + fmt(me.cs_adv) : '—')}
      ${line('Solo kills', me.solo_kills || 0)}
      ${line('Plaques de tour', me.plates || 0)}
      ${line('Tours / dragons / barons tués', `${me.turrets || 0} / ${me.dragons || 0} / ${me.barons || 0}`)}
      ${line('Sorts esquivés', fmt(me.dodged))}
      ${line('Plus longue série', me.spree || 0)}
      ${line('Temps mort', dur(me.dead || 0), `${pct(me.dead || 0, m.duration)}% de la partie`)}
      ${line('Balises posées / détruites / pinks', `${me.wards || 0} / ${me.wards_killed || 0} / ${me.pinks || 0}`)}
      ${opp ? `<div class="sec-title mt">Face à ${esc(champName(opp.champ_id, opp.champ))}</div>
        ${line('KDA', `${me.k}/${me.d}/${me.a}`, `${opp.k}/${opp.d}/${opp.a}`)}
        ${line('Or', fmtK(me.gold), fmtK(opp.gold))}
        ${line('Dégâts', fmtK(me.dmg), fmtK(opp.dmg))}
        ${line('CS', me.cs, opp.cs)}` : ''}
    </div></div>`;
}

function vHistory() {
  if (!S.profile) return needProfile();
  let list = mineOf(S.matches);
  const champs = [...new Map(list.map(({ me }) => [me.champ_id, me])).values()].sort((a, b) => champName(a.champ_id).localeCompare(champName(b.champ_id)));
  if (S.histQueue != null) list = list.filter(({ m }) => m.queue === S.histQueue || (S.histQueue === 1700 && isArena(m)));
  if (S.histChamp) list = list.filter(({ me }) => me.champ_id === +S.histChamp);
  const t = aggregate(list);
  const chips = QUEUE_CHIPS.map(([q, l]) => `<button class="chip${S.histQueue === q ? ' on' : ''}" data-hq="${q ?? ''}">${l}</button>`).join('');
  return `<div class="fade-in"><div class="page-title"><div><h1>Historique</h1><p>${list.length} parties · clique sur une partie pour le tableau complet${S.premadeLeft ? ` · <span class="gold">détection des groupes : ${S.premadeLeft} partie${S.premadeLeft > 1 ? 's' : ''} restante${S.premadeLeft > 1 ? 's' : ''}</span>` : ''}</p></div>
    <div class="row">${t.games ? `<span class="tag">${t.wins}V ${t.games - t.wins}D · <b class="${wrCls(pct(t.wins, t.games))}">${pct(t.wins, t.games)}%</b></span><span class="tag">${kdaStr(t.k, t.d, t.a)} KDA</span>` : ''}</div></div>
    <div class="toolbar mb"><div class="chips">${chips}</div><span class="grow"></span>
      <select class="input" id="histChamp" style="width:200px"><option value="">Tous les champions</option>${champs.map((c) => `<option value="${c.champ_id}"${+S.histChamp === c.champ_id ? ' selected' : ''}>${esc(champName(c.champ_id, c.champ))}</option>`).join('')}</select></div>
    ${list.length ? list.map(({ m, me }) => matchCard(m, me)).join('') : S.moreLoading ? '' : '<div class="card"><p class="muted">Aucune partie pour ce filtre.</p></div>'}
    <div class="row mt" style="justify-content:center">${S.moreLoading ? loader('Chargement des parties…') : '<button class="btn" data-act="more">Charger 20 parties de plus</button>'}</div></div>`;
}

/* ---------------------------------------------------------------- Analyse */
function needAll(title) {
  if (!S.all) return `<div class="page-title"><div><h1>${title}</h1></div></div>` + loader('Lecture des parties enregistrées…');
  return null;
}

function syncBox() {
  const syncedTo = store.get('synced:' + S.profile.puuid, 0);
  return S.sync
    ? `<div style="width:260px"><div class="muted" style="font-size:12px;margin-bottom:6px">Import : ${S.sync.done} / ${S.sync.total} parties</div><div class="progress"><i style="width:${pct(S.sync.done, S.sync.total)}%"></i></div></div>`
    : `<button class="btn primary" data-act="sync100">${syncedTo ? 'Importer 100 parties de plus' : 'Importer 100 parties'}</button>`;
}

function filterQueue(list, q) {
  return q == null ? list : list.filter(({ m }) => m.queue === q || (q === 1700 && isArena(m)));
}

function lineChart(series, opts = {}) {
  const W = 1000, H = opts.h || 220, L = 44, R = 14, T = 14, B = 26;
  const n = Math.max(...series.map((s) => s.values.length));
  if (n < 2) return '<p class="muted">Pas assez de parties pour tracer une tendance.</p>';
  const lo = opts.min ?? 0, hi = opts.max ?? 100;
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let g = '';
  for (const v of opts.ticks || [0, 25, 50, 75, 100]) g += `<line class="${v === 50 && !opts.ticks ? 'half' : 'grid-line'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}${opts.unit ?? '%'}</text>`;
  const paths = series.map((s) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Math.max(lo, Math.min(hi, v))).toFixed(1)}`).join('');
    return `${s.area ? `<path class="area" d="${d}L${x(s.values.length - 1)},${H - B}L${x(0)},${H - B}Z"/>` : ''}<path class="${s.cls || 'line'}" d="${d}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="lpGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff5a63" stop-opacity=".28"/><stop offset="1" stop-color="#ff5a63" stop-opacity="0"/></linearGradient></defs>${g}${paths}
    <text x="${L}" y="${H - 6}">${opts.left || ''}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${opts.right || ''}</text></svg>`;
}

function hbars(rows) {
  const maxG = Math.max(1, ...rows.map((r) => r.g));
  return rows.map((r) => {
    const w = pct(r.w, r.g);
    return `<div class="hbar"><span class="row" style="gap:8px">${r.icon || ''}${r.label}</span>
      <div class="row" style="gap:8px"><div class="progress" style="flex:0 0 ${Math.max(8, (r.g / maxG) * 100)}%"><i style="width:${w}%;background:${w >= 50 ? 'var(--win)' : 'var(--loss)'}"></i></div></div>
      <span class="right">${r.g ? `<b class="${wrCls(w)}">${w}%</b> <span class="dim">${r.g}</span>` : '<span class="dim">—</span>'}</span></div>`;
  }).join('');
}

function vAnalysis() {
  if (!S.profile) return needProfile();
  const wait = needAll('Analyse'); if (wait) return wait;
  const list = filterQueue(mineOf(S.all), S.anQueue).filter(({ m }) => !m.remake);
  const chips = QUEUE_CHIPS.map(([q, l]) => `<button class="chip${S.anQueue === q ? ' on' : ''}" data-aq="${q ?? ''}">${l}</button>`).join('');
  const head = `<div class="page-title"><div><h1>Analyse <em>approfondie</em></h1><p>${list.length} parties analysées, enregistrées sur ce PC</p></div>${syncBox()}</div><div class="chips mb">${chips}</div>`;
  if (!list.length) return `<div class="fade-in">${head}<div class="card">${empty('chart', 'Aucune partie à analyser', 'Importe des parties pour remplir cette page : plus il y en a, plus l\'analyse est précise.')}</div></div>`;
  const t = aggregate(list);
  const g = t.games;
  const kpis = [
    ['Parties', g, `${t.wins}V ${g - t.wins}D`],
    ['Winrate', `<span class="${wrCls(pct(t.wins, g))}">${pct(t.wins, g)}%</span>`, `${fmt(t.secs / 3600)} h de jeu`],
    ['KDA', kdaStr(t.k, t.d, t.a), `${fmt1(t.k / g)} / ${fmt1(t.d / g)} / ${fmt1(t.a / g)}`],
    ['Participation', Math.round((t.kp * 100) / g) + '%', 'aux éliminations'],
    ['Note moyenne', `<span class="gold">${fmt1(t.score / g)}</span>`, `${t.mvp} MVP/ACE`],
    ['Part des dégâts', Math.round((t.dshare * 100) / g) + '%', 'de ton équipe'],
    ['CS / min', fmt1(t.cs / t.min), t.cs10n ? `${fmt1(t.cs10 / t.cs10n)} à 10 min` : ''],
    ['Dégâts / min', fmt(t.dmg / t.min), `${fmt(t.taken / t.min)} subis/min`],
    ['Or / min', fmt(t.gold / t.min), ''],
    ['Vision / min', fmt2(t.vision / t.min), `${fmt1(t.pinks / g)} pinks/partie`],
    ['Temps mort', pct(t.dead, t.secs) + '%', 'de la durée des parties'],
    ['Premier sang', pct(t.fb, g) + '%', `${fmt1(t.solo / g)} solo kills/partie`],
  ];

  // tendance (plus ancienne -> plus récente)
  const chrono = [...list].reverse();
  const win = 10, wrS = [], kdaS = [];
  for (let i = 0; i < chrono.length; i++) {
    const sl = chrono.slice(Math.max(0, i - win + 1), i + 1);
    wrS.push((sum(sl, (x) => x.me.win) * 100) / sl.length);
    const k = sum(sl, (x) => x.me.k), d = sum(sl, (x) => x.me.d), a = sum(sl, (x) => x.me.a);
    kdaS.push(Math.min(100, (((k + a) / Math.max(1, d)) * 100) / 6));
  }

  // rôles, durées, côtés
  const roleRows = ROLES.map(([k, l, ic]) => { const s = list.filter((x) => x.me.pos === k); return { label: l, icon: ic.replace('<svg', '<svg width="16" height="16"'), g: s.length, w: sum(s, (x) => x.me.win) }; });
  const buckets = [[0, 20, '< 20 min'], [20, 25, '20 – 25 min'], [25, 30, '25 – 30 min'], [30, 35, '30 – 35 min'], [35, 999, '35 min et +']];
  const durRows = buckets.map(([a, b, l]) => { const s = list.filter((x) => x.m.duration / 60 >= a && x.m.duration / 60 < b); return { label: l, g: s.length, w: sum(s, (x) => x.me.win) }; });
  const side = (tid) => { const s = list.filter((x) => !isArena(x.m) && x.me.team === tid); return { g: s.length, w: sum(s, (x) => x.me.win) }; };
  const blue = side(100), red = side(200);
  const cond = (f) => { const s = list.filter((x) => { const ti = x.m.teams?.find((tt) => tt.id === x.me.team); return ti && f(ti); }); return { g: s.length, w: sum(s, (x) => x.me.win) }; };
  const condRows = [
    { label: '1er sang', ...cond((ti) => ti.first_blood) },
    { label: '1re tour', ...cond((ti) => ti.first_tower) },
    { label: '1er dragon', ...cond((ti) => ti.first_dragon) },
    { label: '1 baron ou +', ...cond((ti) => ti.baron >= 1) },
  ];

  // heatmap jour x heure
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const slots = [[0, 6, 'Nuit'], [6, 12, 'Matin'], [12, 18, 'Aprem'], [18, 24, 'Soir']];
  const heat = slots.map(() => days.map(() => ({ g: 0, w: 0 })));
  for (const { m, me } of list) {
    const d = new Date(m.creation);
    const di = (d.getDay() + 6) % 7, si = slots.findIndex(([a, b]) => d.getHours() >= a && d.getHours() < b);
    heat[si][di].g++; heat[si][di].w += me.win;
  }
  const heatHtml = `<div class="heat"><span></span>${days.map((d) => `<span class="h">${d}</span>`).join('')}
    ${slots.map(([, , l], si) => `<span class="h">${l}</span>${days.map((d, di) => {
      const c = heat[si][di]; const w = pct(c.w, c.g);
      const bg = !c.g ? 'var(--card2)' : w >= 50 ? `rgba(63,181,255,${0.18 + Math.min(0.6, c.g / 15)})` : `rgba(255,90,99,${0.18 + Math.min(0.6, c.g / 15)})`;
      return `<div class="c" style="background:${bg}" data-tip="${d} ${l.toLowerCase()} : ${c.g} parties${c.g ? ` · ${w}% de victoires` : ''}">${c.g ? w + '%' : ''}</div>`;
    }).join('')}`).join('')}</div>`;

  // activité 30 jours
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const act = Array.from({ length: 30 }, (_, i) => ({ d: new Date(today.getTime() - (29 - i) * 864e5), g: 0, w: 0 }));
  for (const { m, me } of list) { const i = 29 - Math.floor((today.getTime() + 864e5 - 1 - m.creation) / 864e5); if (i >= 0 && i < 30) { act[i].g++; act[i].w += me.win; } }
  const maxAct = Math.max(1, ...act.map((a) => a.g));

  // matchups
  const mu = {};
  for (const { m, me } of list) { const o = laneOpp(m, me); if (!o) continue; const r = (mu[o.champ_id] ??= { id: o.champ_id, champ: o.champ, g: 0, w: 0 }); r.g++; r.w += me.win; }
  const muList = Object.values(mu).filter((r) => r.g >= 2);
  const bestMu = [...muList].sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g).slice(0, 5);
  const worstMu = [...muList].sort((a, b) => a.w / a.g - b.w / b.g || b.g - a.g).slice(0, 5);
  const muRow = (r) => { const w = pct(r.w, r.g); return `<div class="champ-mini"><img class="cicon sm" src="${champImg(r.id, r.champ)}" alt=""><span class="grow">${esc(champName(r.id, r.champ))}</span><span class="dim">${r.g} p.</span><b class="${wrCls(w)}" style="width:44px;text-align:right">${w}%</b></div>`; };

  // duos
  const duos = {};
  for (const { m, me } of list) for (const x of teamOf(m, me)) {
    if (x.puuid === me.puuid || !x.name.includes('#')) continue;
    const d = (duos[x.puuid] ??= { name: x.name, g: 0, w: 0 }); d.g++; d.w += me.win;
  }
  const duoList = Object.values(duos).filter((d) => d.g >= 3).sort((a, b) => b.g - a.g).slice(0, 8);

  // records
  const rec = (f, l, fm = fmt) => { let b = null; for (const x of list) { const v = f(x); if (b === null || v > b.v) b = { v, x }; } return { l, v: fm(b.v), x: b.x }; };
  const records = [
    rec((x) => x.me.k, 'Éliminations'), rec((x) => x.me.a, 'Assistances'),
    rec((x) => x.me.dmg, 'Dégâts aux champions', fmtK), rec((x) => x.me.cs / (x.m.duration / 60), 'CS par minute', fmt1),
    rec((x) => x.me.vision, 'Score de vision'), rec((x) => x.me.gold, 'Or gagné', fmtK),
    rec((x) => x.me.spree || 0, 'Série d\'éliminations'), rec((x) => x.m.duration, 'Partie la plus longue', dur),
  ];

  return `<div class="fade-in">${head}
    <div class="grid g6">${kpis.map(([l, v, s]) => `<div class="card stat" style="padding:14px 16px"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s || '&nbsp;'}</div></div>`).join('')}</div>

    <div class="card mt"><h3>Tendance<span class="r"><b style="color:var(--accent2)">━</b> winrate glissant (10 parties) &nbsp; <b class="gold">┅</b> KDA glissant (échelle 0-6)</span></h3>
      ${lineChart([{ values: wrS, area: true }, { values: kdaS, cls: 'line2' }], { left: dateFr(chrono[0].m.creation), right: dateFr(chrono[chrono.length - 1].m.creation) })}</div>

    <div class="grid g3 mt">
      <div class="card"><h3>Par rôle</h3>${hbars(roleRows)}</div>
      <div class="card"><h3>Par durée de partie</h3>${hbars(durRows)}</div>
      <div class="card"><h3>Côté & objectifs</h3>
        <div class="row mb" style="gap:10px"><div class="kpi grow"><div class="stat"><div class="label" style="color:var(--win)">Côté bleu</div><div class="value">${pct(blue.w, blue.g)}%</div><div class="sub">${blue.g} parties</div></div></div>
        <div class="kpi grow"><div class="stat"><div class="label" style="color:var(--loss)">Côté rouge</div><div class="value">${pct(red.w, red.g)}%</div><div class="sub">${red.g} parties</div></div></div></div>
        <div class="dim" style="font-size:12px;margin-bottom:4px">Winrate quand ton équipe obtient…</div>${hbars(condRows)}</div>
    </div>

    <div class="grid mt" style="grid-template-columns:1.2fr 1fr">
      <div class="card"><h3>Quand tu gagnes le plus<span class="r">jour × moment</span></h3>${heatHtml}</div>
      <div class="card"><h3>Activité sur 30 jours<span class="r">${sum(act, (a) => a.g)} parties</span></h3>
        <div class="spark">${act.map((a) => `<i class="${a.g && a.w * 2 >= a.g ? 'g' : ''}" style="height:${(a.g / maxAct) * 100}%" data-tip="${a.d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} : ${a.g} parties${a.g ? ` · ${a.w}V ${a.g - a.w}D` : ''}"></i>`).join('')}</div>
        <div class="row dim" style="justify-content:space-between;font-size:11px;margin-top:6px"><span>${dateFr(act[0].d)}</span><span>aujourd'hui</span></div>
        <div class="grid g4 mt" style="gap:8px">${[['Doubles', t.doubles], ['Triples', t.triples], ['Quadras', t.quadras], ['Pentas', t.pentas]].map(([l, v]) => `<div class="kpi stat" style="padding:8px 10px"><div class="label">${l}</div><div class="value" style="font-size:18px">${v}</div></div>`).join('')}</div></div>
    </div>

    <div class="grid g3 mt">
      <div class="card"><h3>Meilleurs matchups<span class="r">2 parties min.</span></h3>${bestMu.length ? bestMu.map(muRow).join('') : '<p class="muted">Pas assez de données.</p>'}</div>
      <div class="card"><h3>Matchups difficiles</h3>${worstMu.length ? worstMu.map(muRow).join('') : '<p class="muted">Pas assez de données.</p>'}</div>
      <div class="card"><h3>Coéquipiers<span class="r">3 parties min.</span></h3>${duoList.length ? duoList.map((d) => { const w = pct(d.w, d.g); return `<div class="champ-mini"><span class="grow ellipsis link" data-riot="${esc(d.name)}">${esc(d.name.split('#')[0])}<span class="dim">#${esc(d.name.split('#')[1] || '')}</span></span><span class="dim">${d.g} p.</span><b class="${wrCls(w)}" style="width:44px;text-align:right">${w}%</b></div>`; }).join('') : '<p class="muted">Aucun coéquipier récurrent.</p>'}</div>
    </div>

    <div class="card mt"><h3>Records personnels</h3><div class="grid g4" style="gap:10px">${records.map((r) => `<div class="record link-row" data-goto-match="${esc(r.x.m.id)}" style="cursor:pointer"><img class="cicon" src="${champImg(r.x.me.champ_id, r.x.me.champ)}" alt=""><div><div class="v">${r.v}</div><div class="l">${r.l} · ${dateFr(r.x.m.creation)}</div></div></div>`).join('')}</div></div>
  </div>`;
}

/* ---------------------------------------------------------------- Champions */
function champAgg(list) {
  const map = {};
  for (const x of list) {
    if (x.m.remake) continue;
    (map[x.me.champ_id] ??= { id: x.me.champ_id, champ: x.me.champ, list: [] }).list.push(x);
  }
  return Object.values(map).map((c) => ({ ...c, t: aggregate(c.list), last: Math.max(...c.list.map((x) => x.m.creation)) }));
}

const CH_COLS = [
  ['champ', 'Champion', null],
  ['games', 'Parties', (c) => c.t.games],
  ['wr', 'Winrate', (c) => c.t.wins / c.t.games],
  ['kda', 'KDA', (c) => (c.t.k + c.t.a) / Math.max(1, c.t.d)],
  ['kp', 'KP', (c) => c.t.kp / c.t.games],
  ['score', 'Note', (c) => c.t.score / c.t.games],
  ['cs', 'CS/min', (c) => c.t.cs / c.t.min],
  ['dmg', 'Dégâts/min', (c) => c.t.dmg / c.t.min],
  ['share', 'Part dég.', (c) => c.t.dshare / c.t.games],
  ['gold', 'Or/min', (c) => c.t.gold / c.t.min],
  ['vis', 'Vision/min', (c) => c.t.vision / c.t.min],
  ['last', 'Dernière', (c) => c.last],
];

function vChampions() {
  if (!S.profile) return needProfile();
  const wait = needAll('Stats par champion'); if (wait) return wait;
  const chips = QUEUE_CHIPS.map(([q, l]) => `<button class="chip${S.champQueue === q ? ' on' : ''}" data-cq="${q ?? ''}">${l}</button>`).join('');
  const stats = champAgg(filterQueue(mineOf(S.all), S.champQueue));
  let body;
  if (!stats.length) body = '<p class="muted" style="padding:20px">Aucune partie en cache pour ce filtre. Importe des parties pour remplir les stats.</p>';
  else {
    const col = CH_COLS.find((c) => c[0] === S.champSort) || CH_COLS[1];
    const rows = stats.sort((a, b) => (col[2] ? col[2](b) - col[2](a) : champName(a.id).localeCompare(champName(b.id))));
    const totalGames = sum(stats, (c) => c.t.games);
    const top3 = [...stats].sort((a, b) => b.t.games - a.t.games).slice(0, 3);
    body = `<table><thead><tr>${CH_COLS.map(([k, l]) => `<th data-sort="${k}" class="${k === S.champSort ? 'sorted' : ''}">${l}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((c) => {
      const t = c.t, wr = pct(t.wins, t.games);
      return `<tr class="click" data-champ="${c.id}">
        <td><div class="row" style="gap:10px"><img class="cicon sm" loading="lazy" src="${champImg(c.id, c.champ)}" alt=""><b>${esc(champName(c.id, c.champ))}</b></div></td>
        <td>${t.games} <span class="dim">${pct(t.games, totalGames)}%</span></td>
        <td><div class="minibar"><div class="progress" style="max-width:70px"><i style="width:${wr}%;background:${wr >= 50 ? 'var(--win)' : 'var(--loss)'}"></i></div><b class="${wrCls(wr)}">${wr}%</b></div></td>
        <td><b>${kdaStr(t.k, t.d, t.a)}</b> <span class="dim">${fmt1(t.k / t.games)}/${fmt1(t.d / t.games)}/${fmt1(t.a / t.games)}</span></td>
        <td>${Math.round((t.kp * 100) / t.games)}%</td>
        <td><span class="gold">${fmt1(t.score / t.games)}</span></td>
        <td>${fmt1(t.cs / t.min)}</td>
        <td>${fmt(t.dmg / t.min)}</td>
        <td>${Math.round((t.dshare * 100) / t.games)}%</td>
        <td>${fmt(t.gold / t.min)}</td>
        <td>${fmt2(t.vision / t.min)}</td>
        <td class="muted">${dateFr(c.last)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
    body = `<div class="grid g3 mb">${top3.map((c, i) => {
      const wr = pct(c.t.wins, c.t.games);
      return `<div class="card flush link-row" data-champ="${c.id}" style="cursor:pointer"><div class="mcard" style="border:0;border-radius:0"><div class="img" style="height:110px;background-image:url('${champSplash(c.id, c.champ)}')"></div>
        <div class="body"><div class="row"><span class="badge ${i === 0 ? 'mvp' : 'plain'}">#${i + 1}</span><span class="nm">${esc(champName(c.id, c.champ))}</span><span class="grow"></span><b class="${wrCls(wr)}">${wr}%</b></div>
        <div class="pts mt" style="margin-top:4px">${c.t.games} parties · ${kdaStr(c.t.k, c.t.d, c.t.a)} KDA · note ${fmt1(c.t.score / c.t.games)}</div></div></div></div>`;
    }).join('')}</div><div class="card flush" style="overflow-x:auto">${body}</div>`;
  }
  return `<div class="fade-in"><div class="page-title"><div><h1>Stats par champion</h1><p>${stats.length} champions · clique sur un champion pour le détail</p></div>${syncBox()}</div>
    <div class="chips mb">${chips}</div>${body}</div>`;
}

function champDrawer() {
  const id = S.champDetail;
  const source = S.all || S.matches;
  const list = mineOf(source).filter((x) => x.me.champ_id === id && !x.m.remake);
  const c = champ(id);
  const t = aggregate(list);
  const wr = pct(t.wins, t.games);
  // objets & runes les plus fréquents
  const items = {}, keys = {}, spells = {};
  for (const { me } of list) {
    for (const i of me.items.slice(0, 6)) if (i && (S.dd?.items?.[i]?.gold ?? 3000) >= 2200) items[i] = (items[i] || 0) + 1;
    if (me.keystone) keys[me.keystone] = (keys[me.keystone] || 0) + 1;
    const sk = [...(me.spells || [])].sort().join('-'); if (sk) spells[sk] = (spells[sk] || 0) + 1;
  }
  const topItems = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topKeys = Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topSpells = Object.entries(spells).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const mu = {};
  for (const { m, me } of list) { const o = laneOpp(m, me); if (!o) continue; const r = (mu[o.champ_id] ??= { id: o.champ_id, g: 0, w: 0 }); r.g++; r.w += me.win; }
  const muList = Object.values(mu).sort((a, b) => b.g - a.g).slice(0, 8);
  const mast = S.mastery?.list?.find((x) => x.champ_id === id);
  return `<div class="drawer" data-act="close-drawer"><div class="panel" data-stop>
    <div class="dhead" style="background-image:url('${champSplash(id)}')"><button class="btn icon close" data-act="close-drawer">${ICONS.close}</button>
      <div class="row" style="gap:16px"><img class="cicon lg" src="${champImg(id)}" alt=""><div><h1 style="font-size:30px">${esc(champName(id))}</h1><div class="muted">${esc(c?.title || '')}${c?.tags ? ' · ' + c.tags.map((x) => CLASS_FR[x] || x).join(', ') : ''}</div></div><button class="btn gold" data-act="meta-build" style="margin-left:24px">${ICONS.sword}Build Master+</button></div></div>
    <div class="dbody">
      ${t.games ? `<div class="grid g4 mb" style="gap:10px">
        <div class="kpi stat"><div class="label">Parties</div><div class="value">${t.games}</div><div class="sub">${t.wins}V ${t.games - t.wins}D</div></div>
        <div class="kpi stat"><div class="label">Winrate</div><div class="value ${wrCls(wr)}">${wr}%</div><div class="sub">note ${fmt1(t.score / t.games)}</div></div>
        <div class="kpi stat"><div class="label">KDA</div><div class="value">${kdaStr(t.k, t.d, t.a)}</div><div class="sub">${fmt1(t.k / t.games)}/${fmt1(t.d / t.games)}/${fmt1(t.a / t.games)}</div></div>
        <div class="kpi stat"><div class="label">Maîtrise</div><div class="value gold">${mast ? 'Niv. ' + mast.level : '—'}</div><div class="sub">${mast ? fmt(mast.points) + ' pts' : 'non chargée'}</div></div>
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Objets favoris</h3><div class="row wrap" style="gap:8px">${topItems.length ? topItems.map(([i, n]) => `<div class="col" style="align-items:center;gap:4px"><img class="sq" style="width:38px;height:38px" src="${itemImg(i)}" alt="" data-tip="${esc(itemName(i))}"><span class="dim" style="font-size:11px">${pct(n, t.games)}%</span></div>`).join('') : '<span class="muted">—</span>'}</div></div>
        <div class="card"><h3>Runes & sorts</h3><div class="row wrap" style="gap:12px">${topKeys.map(([k, n]) => rune(k) ? `<div class="col" style="align-items:center;gap:4px"><img class="sq r" style="width:38px;height:38px" src="${rune(k).icon}" alt="" data-tip="${esc(rune(k).name)}"><span class="dim" style="font-size:11px">${pct(n, t.games)}%</span></div>` : '').join('')}
          ${topSpells.map(([k, n]) => `<div class="col" style="align-items:center;gap:4px"><div class="row" style="gap:2px">${k.split('-').map((s) => `<img class="sq" style="width:24px;height:24px" src="${spellImg(s)}" alt="">`).join('')}</div><span class="dim" style="font-size:11px">${pct(n, t.games)}%</span></div>`).join('')}</div></div>
      </div>
      <div class="grid g2 mb">
        <div class="card"><h3>Statistiques</h3>
          ${[['CS / min', fmt1(t.cs / t.min)], ['CS à 10 min', t.cs10n ? fmt1(t.cs10 / t.cs10n) : '—'], ['Dégâts / min', fmt(t.dmg / t.min)], ['Part des dégâts', Math.round((t.dshare * 100) / t.games) + '%'], ['Participation', Math.round((t.kp * 100) / t.games) + '%'], ['Vision / min', fmt2(t.vision / t.min)], ['Solo kills / partie', fmt1(t.solo / t.games)], ['Multikills', `${t.doubles}D ${t.triples}T ${t.quadras}Q ${t.pentas}P`]].map(([l, v]) => `<div class="list-row"><span class="muted grow">${l}</span><b>${v}</b></div>`).join('')}</div>
        <div class="card"><h3>Adversaires de voie</h3>${muList.length ? muList.map((r) => { const w = pct(r.w, r.g); return `<div class="champ-mini"><img class="cicon sm" src="${champImg(r.id)}" alt=""><span class="grow">${esc(champName(r.id))}</span><span class="dim">${r.g} p.</span><b class="${wrCls(w)}" style="width:44px;text-align:right">${w}%</b></div>`; }).join('') : '<p class="muted">—</p>'}</div>
      </div>
      <div class="sec-title">Dernières parties</div>
      ${list.slice(0, 8).map(({ m, me }) => { const sc = scores(m).get(me.puuid); return `<div class="list-row click" data-goto-match="${esc(m.id)}"><span class="badge ${me.win ? 'plain' : 'fb'}" style="width:62px;text-align:center">${me.win ? 'Victoire' : 'Défaite'}</span><span class="grow"><b>${me.k}/${me.d}/${me.a}</b> <span class="dim">· ${queueName(m.queue)} · ${dur(m.duration)}</span></span><span class="row" style="gap:2px">${itemsHtml(me.items, 20)}</span><span class="dim" style="width:90px;text-align:right">${ago(m.creation)}</span>${scoreBadge(sc)}</div>`; }).join('')}`
      : '<p class="muted">Aucune partie enregistrée sur ce champion.</p>'}
    </div></div></div>`;
}

/* ---------------------------------------------------------------- Maîtrises */
function vMastery() {
  if (!S.profile) return needProfile();
  const head = (extra = '') => `<div class="page-title"><div><h1>Maîtrises</h1><p>Points de maîtrise de champion de ${esc(S.profile.game_name)}</p></div>${extra}</div>`;
  if (S.masteryLoading || !S.mastery) return head() + loader('Chargement des maîtrises…');
  const all = S.mastery.list;
  const totalPts = sum(all, (m) => m.points);
  const lv10 = all.filter((m) => m.level >= 10).length;
  const q = S.masteryQ.trim().toLowerCase();
  let list = all.filter((m) => (!q || champName(m.champ_id).toLowerCase().includes(q)) && (!S.masteryClass || champ(m.champ_id)?.tags?.includes(S.masteryClass)));
  const sorts = { points: (a, b) => b.points - a.points, level: (a, b) => b.level - a.level || b.points - a.points, last: (a, b) => b.last - a.last, name: (a, b) => champName(a.champ_id).localeCompare(champName(b.champ_id)) };
  list = list.sort(sorts[S.masterySort]);
  const chips = [[null, 'Toutes classes'], ...Object.entries(CLASS_FR)].map(([k, l]) => `<button class="chip${S.masteryClass === k ? ' on' : ''}" data-mc="${k ?? ''}">${l}</button>`).join('');
  const nChamps = Object.keys(S.dd?.byKey || {}).length;
  return `<div class="fade-in">${head(`<button class="btn" data-act="mastery">${ICONS.refresh}Actualiser</button>`)}
    <div class="grid g4 mb">
      <div class="card stat"><div class="label">Score de maîtrise</div><div class="value gold">${fmt(typeof S.mastery.score === 'number' ? S.mastery.score : sum(all, (m) => m.level))}</div><div class="sub">somme des niveaux</div></div>
      <div class="card stat"><div class="label">Points totaux</div><div class="value">${fmt(totalPts)}</div><div class="sub">${fmt(totalPts / Math.max(1, all.length))} en moyenne</div></div>
      <div class="card stat"><div class="label">Champions joués</div><div class="value">${all.length}</div><div class="sub">${nChamps ? `sur ${nChamps} (${pct(all.length, nChamps)}%)` : '&nbsp;'}</div></div>
      <div class="card stat"><div class="label">Niveau 10 et +</div><div class="value">${lv10}</div><div class="sub">${all.filter((m) => m.points >= 1e6).length} champions à 1 M+</div></div>
    </div>
    <div class="toolbar mb"><input class="input" id="mastQ" placeholder="Filtrer un champion…" value="${esc(S.masteryQ)}" style="width:240px">
      <select class="input" id="mastSort" style="width:190px">${[['points', 'Trier : points'], ['level', 'Trier : niveau'], ['last', 'Trier : dernière partie'], ['name', 'Trier : nom']].map(([v, l]) => `<option value="${v}"${S.masterySort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div class="chips">${chips}</div></div>
    <div class="mastery-grid">${list.map((m) => {
      const prog = m.next > 0 ? pct(m.since, m.since + m.next) : 100;
      return `<div class="mcard link-row" data-champ="${m.champ_id}" style="cursor:pointer"><div class="img" style="background-image:url('${champSplash(m.champ_id)}')"></div><span class="lvl${m.level >= 10 ? ' hi' : ''}">Niv. ${m.level}</span>
        <div class="body"><div class="nm">${esc(champName(m.champ_id))}</div><div class="pts"><b style="color:var(--text)">${fmt(m.points)}</b> pts · ${ago(m.last)}</div>
        <div class="progress gold" style="margin-top:8px;height:4px" data-tip="${m.next > 0 ? fmt(m.next) + ' pts avant le niveau suivant' : 'Niveau atteint'}"><i style="width:${prog}%"></i></div></div></div>`;
    }).join('') || '<p class="muted">Aucun champion ne correspond.</p>'}</div></div>`;
}

/* ---------------------------------------------------------------- Partie en cours */
function vLive() {
  if (!S.profile) return needProfile();
  const head = `<div class="page-title"><div><h1>Partie en cours</h1><p>Rangs et profils des 10 joueurs de la partie de ${esc(S.profile.game_name)}</p></div><button class="btn" data-act="live">${ICONS.refresh}Actualiser</button></div>`;
  if (S.liveLoading || S.live === undefined) return head + loader('Recherche d\'une partie en cours…');
  if (!S.live) return head + `<div class="card">${empty('live', 'Pas en partie', `${esc(S.profile.game_name)} n'est pas en partie en ce moment. ShiganshinaGG vérifie automatiquement toutes les 3 minutes pour ton compte.`)}</div>`;
  const g = S.live;
  const elapsed = g.start ? Math.max(0, Math.floor((Date.now() - g.start) / 1000)) : g.length || 0;
  const teams = [[100, 'blue', 'Équipe bleue'], [200, 'red', 'Équipe rouge']];
  const bans = (tid) => (g.bans || []).filter((b) => b.teamId === tid && b.championId > 0).map((b) => `<img class="cicon xs" style="filter:grayscale(.8)" src="${champImg(b.championId)}" alt="" data-tip="Banni : ${esc(champName(b.championId))}">`).join('');
  const avgRank = (ps) => { const r = ps.map((p) => p.ranks.find((x) => x.queue === 'RANKED_SOLO_5x5')).filter(Boolean); if (!r.length) return '—'; const a = sum(r, absLP) / r.length; const ti = Math.min(9, Math.floor(a / 400)); return ti >= 7 ? 'Maître+' : `${TIER_FR[TIERS[ti]]} ${4 - Math.floor((a % 400) / 100)}`; };
  return `<div class="fade-in">${head}
    <div class="row mb wrap" style="gap:8px"><span class="tag red">● En direct</span><span class="tag">${queueName(g.queue)}</span><span class="tag">${dur(elapsed)} écoulées</span></div>
    <div class="grid" style="gap:16px">${teams.map(([tid, cls, label]) => {
      const ps = g.players.filter((p) => p.team === tid);
      if (!ps.length) return '';
      return `<div class="live-team ${cls}"><div class="th">${label}<span class="tag" style="font-family:var(--ui);letter-spacing:0;text-transform:none">Rang moyen : ${avgRank(ps)}</span>${g.groupsLoading ? '<span class="dim" style="font:500 12px var(--ui);text-transform:none;letter-spacing:0">Détection des groupes…</span>' : grpSummary(g.groups, ps.map((p) => p.puuid))}<span class="grow"></span><span class="row" style="gap:4px">${bans(tid)}</span></div>
      ${ps.map((p) => {
        const solo = p.ranks.find((x) => x.queue === 'RANKED_SOLO_5x5') || p.ranks.find((x) => x.queue === 'RANKED_FLEX_SR');
        const w = solo ? pct(solo.wins, solo.wins + solo.losses) : 0;
        const gp = g.groups?.[p.puuid];
        return `<div class="lp-row${p.puuid === S.profile.puuid ? ' me' : ''}${gp ? ' in-grp' : ''}"${gp ? ` style="--gc:${gp.color}"` : ''}>
          <img class="cicon lg" style="width:48px;height:48px" src="${champImg(p.champ_id)}" alt="" data-tip="${esc(champName(p.champ_id))}">
          ${spellsRunes(p, 22)}
          <div><div class="link" data-riot="${esc(p.name || '')}"><b>${esc((p.name || '?').split('#')[0])}</b><span class="dim">#${esc((p.name || '').split('#')[1] || '')}</span></div><div class="muted" style="font-size:12px">${esc(champName(p.champ_id))} ${grpBadge(gp)}</div></div>
          <div class="row" style="gap:10px">${solo ? emblem(solo.tier, solo.rank, 'sm') : emblem(null, null, 'sm')}<div><b style="color:${solo ? TIER_COLOR[solo.tier] : 'var(--dim)'}">${solo ? rankLabel(solo) : 'Non classé'}</b><div class="dim" style="font-size:12px">${solo ? `${solo.lp} LP${solo.hot ? ' · 🔥 série' : ''}` : ''}</div></div></div>
          <div class="right">${solo ? `<b class="${wrCls(w)}">${w}%</b><div class="dim" style="font-size:12px">${solo.wins + solo.losses} parties</div>` : ''}</div>
        </div>`;
      }).join('')}</div>`;
    }).join('')}</div></div>`;
}

/* ---------------------------------------------------------------- LP */
function lpPoints() {
  const hist = (S.lpHist || []).filter((s) => s.queue === S.lpQueue);
  const cur = S.profile?.ranks.find((r) => r.queue === S.lpQueue);
  const pts = [...hist];
  if (cur && (!pts.length || absLP(pts[pts.length - 1]) !== absLP(cur))) pts.push(cur);
  return pts;
}

function lpChart(pts) {
  const W = 1000, H = 330, L = 104, R = 16, T = 16, B = 36;
  const vals = pts.map(absLP);
  let lo = Math.min(...vals) - 40, hi = Math.max(...vals) + 40;
  if (hi - lo < 200) { const mid = (hi + lo) / 2; lo = mid - 100; hi = mid + 100; }
  lo = Math.max(0, lo);
  const x = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  let grid = '';
  const step = hi - lo > 1200 ? 400 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const tierI = Math.min(7, Math.floor(v / 400));
    const label = v >= 2800 ? `${v - 2800} LP` : v % 400 === 0 ? TIER_FR[TIERS[tierI]] : `${TIER_FR[TIERS[tierI]]} ${4 - (v % 400) / 100}`;
    const isTier = v % 400 === 0;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${isTier ? 'tier-line' : 'grid-line'}" ${isTier ? `stroke="${TIER_COLOR[TIERS[tierI]]}"` : ''}/>
      <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${label}</text>`;
  }
  const n = Math.min(6, pts.length);
  for (let j = 0; j < n; j++) {
    const i = n === 1 ? 0 : Math.round((j * (pts.length - 1)) / (n - 1));
    grid += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dateFr(pts[i].ts)}</text>`;
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const dots = pts.length <= 80 ? pts.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(vals[i])}" r="4" data-tip="${dateTimeFr(p.ts)} — ${rankLabel(p)} ${p.lp} LP"></circle>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="lpGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff5a63" stop-opacity=".3"/><stop offset="1" stop-color="#ff5a63" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}</svg>`;
}

function deltaSince(pts, ms) {
  if (!pts.length) return null;
  const now = absLP(pts[pts.length - 1]);
  const since = Date.now() - ms;
  const base = [...pts].reverse().find((p) => p.ts <= since) || pts[0];
  return now - absLP(base);
}
const deltaHtml = (d) => (d === null ? '—' : `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} LP</span>`);

function vLP() {
  if (!S.profile) return needProfile();
  const chips = Object.entries(QTYPE).map(([q, l]) => `<button class="chip${S.lpQueue === q ? ' on' : ''}" data-lq="${q}">${l}</button>`).join('');
  const head = `<div class="page-title"><div><h1>Évolution des LP</h1><p>ShiganshinaGG enregistre ton rang à chaque ouverture et toutes les 10 minutes</p></div><div class="chips">${chips}</div></div>`;
  if (!S.lpHist) return head + loader('Chargement…');
  const pts = lpPoints();
  if (!pts.length) return head + `<div class="card">${empty('chart', 'Pas encore classé dans cette file', 'Joue des parties classées : chaque changement de LP sera enregistré ici.')}</div>`;
  const cur = pts[pts.length - 1];
  const peak = pts.reduce((a, b) => (absLP(b) > absLP(a) ? b : a));
  const low = pts.reduce((a, b) => (absLP(b) < absLP(a) ? b : a));
  const changes = [];
  for (let i = pts.length - 1; i > 0 && changes.length < 30; i--) {
    const a = pts[i - 1], b = pts[i];
    changes.push({ b, d: absLP(b) - absLP(a), g: b.wins + b.losses - (a.wins + a.losses), w: b.wins - a.wins });
  }
  const gains = changes.filter((c) => c.d > 0 && c.g === 1), losses = changes.filter((c) => c.d < 0 && c.g === 1);
  return `<div class="fade-in">${head}
    <div class="grid g5 mb">
      <div class="card stat"><div class="row" style="gap:12px">${emblem(cur.tier, cur.rank, 'sm')}<div><div class="label">Actuel</div><div class="value" style="color:${TIER_COLOR[cur.tier]};font-size:20px">${rankLabel(cur)}</div></div></div><div class="sub">${cur.lp} LP</div></div>
      <div class="card stat"><div class="label">Pic enregistré</div><div class="value">${rankLabel(peak)}</div><div class="sub">${peak.lp} LP · ${dateFr(peak.ts)}</div></div>
      <div class="card stat"><div class="label">Plus bas</div><div class="value">${rankLabel(low)}</div><div class="sub">${low.lp} LP · ${dateFr(low.ts)}</div></div>
      <div class="card stat"><div class="label">24 heures</div><div class="value">${deltaHtml(deltaSince(pts, 864e5))}</div><div class="sub">7 jours : ${deltaHtml(deltaSince(pts, 7 * 864e5))}</div></div>
      <div class="card stat"><div class="label">Gain moyen</div><div class="value"><span class="ok">+${gains.length ? Math.round(sum(gains, (c) => c.d) / gains.length) : '—'}</span> / <span class="loss">${losses.length ? Math.round(sum(losses, (c) => c.d) / losses.length) : '—'}</span></div><div class="sub">par victoire / défaite</div></div>
    </div>
    <div class="card">${pts.length < 2 ? `<p class="muted mb">Premier point enregistré le ${dateTimeFr(pts[0].ts)}. La courbe se remplira au fil de tes parties.</p>` : ''}${lpChart(pts)}</div>
    ${changes.length ? `<div class="card mt"><h3>Derniers changements</h3>${changes.map((c) => `
      <div class="list-row"><span class="muted" style="width:150px">${dateTimeFr(c.b.ts)}</span><span class="grow">${rankLabel(c.b)} · ${c.b.lp} LP</span>
      <span class="muted" style="width:140px">${c.g > 0 ? `${c.w}V ${c.g - c.w}D` : ''}</span>${deltaHtml(c.d)}</div>`).join('')}</div>` : ''}</div>`;
}

/* ---------------------------------------------------------------- Paramètres */
function vSettings() {
  const s = S.settings || {};
  return `<div class="fade-in"><div class="page-title"><div><h1>Paramètres</h1><p>Enregistrés uniquement sur ce PC</p></div></div>
  <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
  <div class="card"><div class="form">
    <div class="field"><label>Clé API Riot</label>
      <div class="row"><input class="input" id="sKey" type="password" value="${esc(s.api_key)}" placeholder="RGAPI-xxxxxxxx-xxxx-…" spellcheck="false"><button class="btn" id="sKeyShow" type="button">Afficher</button></div>
      <div class="hint">Crée-la sur <b>developer.riotgames.com</b> (connexion avec ton compte Riot). Une clé de développement expire après 24 h : il suffit de la régénérer et de la recoller ici.</div></div>
    <div class="field"><label>Mon compte (Riot ID)</label>
      <div class="row"><input class="input" id="sMain" value="${esc(s.main_riot_id)}" placeholder="Nom#TAG" spellcheck="false">
      <select class="input" id="sPlat" style="flex:0 0 110px">${REGIONS.map(([v, l]) => `<option value="${v}"${v === s.platform ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="hint">Affiché au démarrage. Ses LP sont suivis automatiquement et ShiganshinaGG détecte quand il est en partie.</div></div>
    <div class="field"><label>Builds Master+</label>
      <label class="row" style="gap:10px;cursor:pointer;text-transform:none;letter-spacing:0;font:500 14px var(--ui);color:var(--text)"><input type="checkbox" id="sAutoMeta"${store.get('autoMeta', true) !== false ? ' checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> Mise à jour quotidienne : 150 nouvelles parties Master+ du patch en cours, une fois par jour</label>
      <div class="hint">Environ 5 minutes en arrière-plan, au premier lancement de la journée seulement. Les gros imports (Builds &amp; tier list → +2 000) reprennent tout seuls s'ils sont interrompus.</div></div>
    <div><button class="btn primary" id="sSave" type="button">Enregistrer</button></div>
  </div></div>
  <div class="col">
    <div class="card"><h3>Favoris</h3>${favs().length ? favs().map((f) => `<div class="list-row"><img class="cicon sm round" src="${iconImg(f.icon || 29)}" alt=""><span class="grow">${esc(f.id)} <span class="dim">${regionLabel(f.platform)}</span></span><button class="btn sm" data-unfav="${esc(f.id)}">Retirer</button></div>`).join('') : '<p class="muted">Ajoute des joueurs en favoris avec l\'étoile sur leur profil.</p>'}</div>
    <div class="card"><h3>Recherches récentes</h3>${recents().length ? `<p class="muted">${recents().length} joueurs mémorisés.</p><button class="btn sm" data-act="clear-recents">Effacer l'historique de recherche</button>` : '<p class="muted">Aucune recherche.</p>'}</div>
    <div class="card"><h3>À propos</h3><p class="muted" style="margin:0">ShiganshinaGG 1.0 — données Riot Games API. ShiganshinaGG n'est ni affilié à Riot Games ni approuvé par Riot Games.</p></div>
  </div></div></div>`;
}

function bindSettings() {
  $('#sKeyShow').onclick = () => {
    const i = $('#sKey');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#sKeyShow').textContent = i.type === 'password' ? 'Afficher' : 'Masquer';
  };
  $('#sSave').onclick = async () => {
    const before = mainId();
    const next = {
      api_key: $('#sKey').value.trim(),
      main_riot_id: $('#sMain').value.trim(),
      platform: $('#sPlat').value,
      league_path: '',
      rp_to_eur: 0,
    };
    store.set('autoMeta', $('#sAutoMeta').checked);
    try {
      await call('save_settings', { settings: next });
      S.settings = next;
      $('#region').value = next.platform;
      toast('Paramètres enregistrés.');
      if (next.api_key && next.main_riot_id && (mainId() !== before || !S.profile)) loadMain();
    } catch (e) { toast(e, true); }
  };
}

/* ================================================================ builds & tier list (parties Master+) */
const SK = ['', 'Q', 'W', 'E', 'R'];
const itemInfo = (id) => S.dd?.items?.[id];
const isLegendary = (id) => { const it = itemInfo(id); return it && it.complete && !it.boots && !it.consumable && it.gold >= 2000; };
const isBoots = (id) => { const it = itemInfo(id); return it && it.boots && it.gold >= 700; };
const adjWr = (w, g) => (w + 5) / (g + 10);
function grade(w, g) {
  const a = adjWr(w, g);
  return a >= 0.53 ? 'S' : a >= 0.515 ? 'A' : a >= 0.495 ? 'B' : a >= 0.48 ? 'C' : 'D';
}
function tally(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    const e = map.get(k) || { key: k, g: 0, w: 0, rows: [] };
    e.g++; e.w += r.win ? 1 : 0; e.rows.push(r);
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.g - a.g || b.w - a.w);
}

function maxOrder(skills) {
  const pts = [0, 0, 0, 0, 0];
  const done = [];
  for (const s of skills.slice(0, 18)) { if (s < 1 || s > 3) { pts[s] = (pts[s] || 0) + 1; continue; } pts[s]++; if (pts[s] === 5) done.push(s); }
  for (const s of [1, 2, 3].sort((a, b) => pts[b] - pts[a])) if (!done.includes(s)) done.push(s);
  return done.slice(0, 3).map((s) => SK[s]).join(' > ');
}

function metaPatch() {
  const st = S.meta.status;
  if (!st?.patches?.length) return null;
  if (S.meta.patch === 'all') return null;
  if (S.meta.patch && S.meta.patch !== 'auto') return S.meta.patch;
  const cur = curPatch();
  if (st.patches.some((p) => p.patch === cur)) return cur;
  return [...st.patches].sort((a, b) => b.patch.localeCompare(a.patch, undefined, { numeric: true }))[0].patch;
}

async function loadMeta() {
  try {
    S.meta.status = await call('meta_status');
    S.meta.overview = await call('meta_overview', { patch: metaPatch() });
    if (S.meta.champ != null) await loadMetaChamp(S.meta.champ, false);
  } catch (e) { toast(e, true); }
  if (S.view === 'builds') render();
}

async function loadMetaChamp(id, rerender = true) {
  S.meta.champ = id; S.meta.rows = null;
  if (rerender) render();
  try {
    const [rows] = await Promise.all([
      call('meta_rows', { champId: id, patch: metaPatch() }),
      S.meta.spells[id] ? null : call('champ_spells', { id: champ(id)?.id, version: ddv() }).then((sp) => (S.meta.spells[id] = sp)).catch(() => {}),
    ]);
    if (S.meta.champ === id) S.meta.rows = rows;
  } catch (e) { toast(e, true); S.meta.rows = []; }
  if (rerender && S.view === 'builds') render();
}

/** Import Master+ ; la tâche est mémorisée pour reprendre au prochain lancement si l'appli est fermée. */
async function metaSync(count, auto = false) {
  const plat = S.profile?.platform || S.settings.platform || 'euw1';
  const patch = curPatch();
  S.meta.sync = { done: 0, total: count, phase: 'Démarrage…', auto, start: Date.now() };
  S.meta.cancelled = false;
  store.set('metaJob', { patch, remaining: count });
  render();
  try {
    const n = await call('meta_sync', { platform: plat, count, patch: patch || null });
    if (!auto || n) toast(n ? `Builds : ${fmt(n)} parties Master+ du patch ${patch} importées.` : `Aucune nouvelle partie Master+ du patch ${patch} disponible pour l'instant.`);
    S.coach = {};
  } catch (e) { if (!auto) toast(e, true); }
  // terminé, arrêté ou plus de parties disponibles : rien à reprendre
  store.set('metaJob', null);
  S.meta.sync = null;
  S.meta.roleRows = {};
  await loadMeta();
}

const META_RATE = 32; // parties par minute avec une clé limitée à 100 requêtes / 2 min
function metaSyncBox() {
  const st = S.meta.status;
  const sy = S.meta.sync;
  const cur = st?.patches?.find((p) => p.patch === curPatch())?.matches || 0;
  if (sy) {
    const left = Math.max(0, sy.total - sy.done);
    const el = (Date.now() - (sy.start || Date.now())) / 60000;
    const rate = sy.done > 20 && el > 0.5 ? sy.done / el : META_RATE;
    const eta = left / Math.max(1, rate);
    return `<div class="card" style="min-width:380px"><div class="row" style="justify-content:space-between"><b>${esc(sy.phase || 'Import…')}</b><button class="btn sm" data-act="meta-cancel">Arrêter</button></div>
      <div class="progress mt" style="margin-top:10px"><i style="width:${pct(sy.done, sy.total)}%"></i></div>
      <div class="data-note" style="margin-top:6px">${fmt(sy.done)} / ${fmt(sy.total)} parties · ${eta >= 60 ? `${Math.floor(eta / 60)} h ${Math.round(eta % 60)} min` : `${Math.max(1, Math.ceil(eta))} min`} restantes · ${Math.round(rate)} parties/min</div>
      <div class="data-note">Continue en arrière-plan et reprend tout seul si tu fermes l'appli.</div></div>`;
  }
  return `<div class="col" style="align-items:flex-end;gap:6px"><div class="row wrap" style="gap:8px;justify-content:flex-end"><span class="tag gold">${fmt(cur)} parties du patch ${esc(curPatch())}</span>
    <button class="btn sm" data-msync="500" data-tip="≈ 15 minutes">+500</button>
    <button class="btn sm primary" data-msync="2000" data-tip="≈ 1 heure, en arrière-plan">+2 000</button>
    <button class="btn sm" data-msync="5000" data-tip="≈ 2 h 30, en arrière-plan (reprend tout seul)">+5 000</button></div>
    <span class="data-note">Limite de ta clé : 100 requêtes / 2 min ≈ ${fmt(META_RATE * 60)} parties par heure</span></div>`;
}

function patchChips() {
  const st = S.meta.status;
  if (!st?.patches?.length) return '';
  const cur = metaPatch();
  const ps = [...st.patches].sort((a, b) => b.patch.localeCompare(a.patch, undefined, { numeric: true })).slice(0, 3);
  return `<div class="chips">${ps.map((p) => `<button class="chip${cur === p.patch ? ' on' : ''}" data-bpatch="${esc(p.patch)}">Patch ${esc(p.patch)} <span class="dim">${p.matches}</span></button>`).join('')}
    <button class="chip${cur === null ? ' on' : ''}" data-bpatch="all">Tous les patchs</button></div>`;
}

function vBuilds() {
  if (!S.meta.status) return `<div class="page-title"><div><h1>Builds & tier list</h1></div></div>${loader('Chargement…')}`;
  return S.meta.champ != null ? vBuildChamp() : vTierList();
}

function vTierList() {
  const ov = S.meta.overview;
  const head = `<div class="page-title"><div><h1>Builds & <em>tier list</em></h1><p>Calculés à partir de vraies parties classées Master, Grand Maître et Challenger de ta région</p></div>${metaSyncBox()}</div>`;
  if (!ov?.matches) {
    return `<div class="fade-in">${head}<div class="card">${empty('sword', 'Importe des parties de haut niveau', 'ShiganshinaGG télécharge des parties récentes des meilleurs joueurs de ta région (Master+) pour calculer les meilleurs runes, objets, sorts et ordres de compétences de chaque champion. Avec une clé de développement, 300 parties prennent environ 20 minutes : l\'import continue pendant que tu utilises l\'appli.', '<button class="btn primary" data-msync="300">Importer 300 parties</button>')}</div></div>`;
  }
  const q = S.meta.q.trim().toLowerCase();
  const byChamp = {};
  for (const e of ov.list) (byChamp[e.champ_id] ??= []).push(e);
  let rows = ov.list.filter((e) => e.pos && (!S.meta.pos || e.pos === S.meta.pos) && (!q || champName(e.champ_id).toLowerCase().includes(q)));
  if (!S.meta.pos) {
    // un seul rôle (le principal) par champion
    const best = {};
    for (const e of rows) if (!best[e.champ_id] || e.games > best[e.champ_id].games) best[e.champ_id] = e;
    rows = Object.values(best);
  }
  rows = rows.filter((e) => e.games >= 3).sort((a, b) => adjWr(b.wins, b.games) - adjWr(a.wins, a.games));
  const chips = [[null, 'Tous les rôles'], ...ROLES.map(([k, l]) => [k, l])].map(([k, l]) => `<button class="chip${S.meta.pos === k ? ' on' : ''}" data-bpos="${k ?? ''}">${l}</button>`).join('');
  return `<div class="fade-in">${head}
    <div class="toolbar mb"><input class="input" id="metaQ" placeholder="Chercher un champion…" value="${esc(S.meta.q)}" style="width:220px"><div class="chips">${chips}</div><span class="grow"></span>${patchChips()}</div>
    <div class="card flush"><table><thead><tr><th style="width:40px">#</th><th>Champion</th><th>Rôle</th><th>Tier</th><th>Winrate</th><th>Pick</th><th>Ban</th><th>Parties</th></tr></thead><tbody>
    ${rows.map((e, i) => {
      const w = pct(e.wins, e.games);
      const r = roleOf(e.pos);
      return `<tr class="click" data-bchamp="${e.champ_id}" data-bchamppos="${e.pos}"><td class="dim">${i + 1}</td>
        <td><div class="row" style="gap:10px"><img class="cicon sm" loading="lazy" src="${champImg(e.champ_id)}" alt=""><b>${esc(champName(e.champ_id))}</b></div></td>
        <td><span class="row" style="gap:6px;color:var(--muted)">${r ? r[2].replace('<svg', '<svg width="16" height="16"') + r[1] : '—'}</span></td>
        <td><span class="tier-grade ${grade(e.wins, e.games)}">${grade(e.wins, e.games)}</span></td>
        <td><b class="${wrCls(w)}">${w}%</b></td>
        <td>${fmt1((e.games * 100) / ov.matches)}%</td>
        <td class="muted">${fmt1(((ov.bans[e.champ_id] || 0) * 100) / ov.matches)}%</td>
        <td class="muted">${e.games}${e.games < 15 ? ' <span class="dim" data-tip="Peu de parties : résultat encore peu fiable">·</span>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted" style="padding:20px">Aucun champion ne correspond.</td></tr>'}</tbody></table></div>
    <p class="data-note mt">Le tier tient compte du nombre de parties : un champion joué 3 fois à 100% de victoires n'est pas classé S. Plus tu importes de parties, plus la liste est fiable.</p></div>`;
}

const pctWr = (e, n) => `<div class="stats"><b class="${wrCls(pct(e.w, e.g))}">${pct(e.w, e.g)}%</b> WR<div class="dim">${pct(e.g, n)}% · ${e.g} parties</div></div>`;
const itemRow = (ids, big = true) => `<div class="ibuild">${ids.map((i, k) => `${k ? '<span class="arr">›</span>' : ''}<img src="${itemImg(i)}" alt="" data-tip="${esc(itemName(i))}"${big ? '' : ' style="width:32px;height:32px"'}>`).join('')}</div>`;

function runePage(key) {
  const [style, prim, sub, sec, shards] = key.split('|');
  const primIds = prim.split('.').map(Number), secIds = sec.split('.').map(Number);
  const tree = (id) => S.dd?.trees?.find((t) => t.id === +id);
  const img = (id, on, cls = '') => { const r = rune(id); return r ? `<img class="${on ? 'on' : ''} ${cls}" src="${r.icon}" alt="" data-tip="${esc(r.name)}">` : ''; };
  const t1 = tree(style), t2 = tree(sub);
  const left = t1 ? `<div class="rune-tree">${img(+style, true, 'style-ic')}${t1.slots.map((sl, i) => `<div class="row${i === 0 ? ' ks' : ''}">${sl.map((id) => img(id, primIds.includes(id))).join('')}</div>`).join('')}</div>` : `<div class="row">${primIds.map((id) => img(id, true)).join('')}</div>`;
  const right = t2 ? `<div class="rune-tree">${img(+sub, true, 'style-ic')}${t2.slots.slice(1).map((sl) => `<div class="row">${sl.map((id) => img(id, secIds.includes(id))).join('')}</div>`).join('')}
    <div class="row shard" style="margin-top:6px">${shards.split('.').map((id) => img(+id, true)).join('')}</div></div>` : '';
  return `<div class="row" style="gap:40px;align-items:flex-start;justify-content:center">${left}${right}</div>`;
}

/** Agrège les lignes d'un champion (un rôle) : runes, objets, compétences, matchups, stats. */
function buildAgg(rows) {
  const n = rows.length;
  const wins = rows.filter((r) => r.win).length;
  const withTl = rows.filter((r) => r.buys?.length);
  const out = { n, wins, tl: withTl.length };
  const full = rows.filter((r) => r.perks?.length >= 6);
  out.full = full.length;
  out.pages = tally(full, (r) => [r.style, r.perks.slice(0, 4).join('.'), r.sub, [...r.perks.slice(4, 6)].sort().join('.'), r.shards.join('.')].join('|'));
  const minG = Math.max(3, Math.round(full.length * 0.05));
  out.bestPage = [...out.pages].filter((p) => p.g >= minG).sort((a, b) => adjWr(b.w, b.g) - adjWr(a.w, a.g))[0];
  out.keystones = tally(full, (r) => r.perks[0]);
  out.primTrees = tally(full, (r) => r.style);
  out.subTrees = tally(full, (r) => r.sub);
  out.runeStat = {};
  for (const r of full) for (const id of r.perks) { const e = (out.runeStat[id] ??= { g: 0, w: 0 }); e.g++; e.w += r.win ? 1 : 0; }
  out.shardRows = [0, 1, 2].map((i) => tally(full.filter((r) => r.shards?.[i]), (r) => r.shards[i]));
  out.spells = tally(rows, (r) => [...r.spells].sort((a, b) => a - b).join('-'));
  out.starts = tally(withTl, (r) => r.buys.filter(([, t]) => t <= 75).map(([i]) => i).sort((a, b) => a - b).join('-'));
  const bootsOf = (r) => (r.buys?.length ? r.buys.find(([i]) => isBoots(i)) : null);
  out.boots = tally(rows, (r) => (r.buys?.length ? bootsOf(r)?.[0] : r.items.find(isBoots)) ?? 'none');
  for (const b of out.boots) { const ts = b.rows.map(bootsOf).filter(Boolean).map((x) => x[1]); b.time = ts.length ? ts.reduce((a, c) => a + c, 0) / ts.length : null; }
  const coreOf = (r) => {
    const seq = r.buys?.length ? r.buys : [...r.items].sort((a, b) => (itemInfo(b)?.gold || 0) - (itemInfo(a)?.gold || 0)).map((i) => [i, null]);
    const seen = new Set(), res = [];
    for (const [i, t] of seq) if (isLegendary(i) && !seen.has(i)) { seen.add(i); res.push([i, t]); }
    return res;
  };
  const ord = withTl.length >= 15 ? withTl : rows;
  out.ordRows = ord.length;
  out.cores = tally(ord.filter((r) => coreOf(r).length >= 3), (r) => coreOf(r).slice(0, 3).map((x) => x[0]).join('-'));
  out.cores2 = tally(ord.filter((r) => coreOf(r).length >= 2), (r) => coreOf(r).slice(0, 2).map((x) => x[0]).join('-'));
  out.coreOrdered = withTl.length >= n / 2;
  out.slots = [0, 1, 2, 3, 4, 5].map((k) => tally(ord.filter((r) => coreOf(r).length > k), (r) => coreOf(r)[k][0]));
  out.slotTimes = [0, 1, 2].map((k) => { const ts = withTl.map((r) => coreOf(r)[k]?.[1]).filter((t) => t != null); return ts.length ? ts.reduce((a, c) => a + c, 0) / ts.length : null; });
  const late = new Map();
  for (const r of ord) for (const [i] of coreOf(r).slice(3, 6)) { const e = late.get(i) || { key: i, g: 0, w: 0 }; e.g++; e.w += r.win ? 1 : 0; late.set(i, e); }
  out.late = [...late.values()].sort((a, b) => b.g - a.g).slice(0, 8);
  const sk = rows.filter((r) => r.skills?.length >= 9);
  out.skillN = sk.length;
  out.orders = tally(sk, (r) => maxOrder(r.skills));
  out.first3 = tally(sk, (r) => r.skills.slice(0, 3).map((x) => SK[x]).join(' › '));
  if (out.orders[0]) {
    const top = out.orders[0].rows;
    out.grid = Array.from({ length: 18 }, (_, lv) => { const c = [0, 0, 0, 0, 0]; for (const r of top) if (r.skills[lv]) c[r.skills[lv]]++; return Math.max(...c) ? c.indexOf(Math.max(...c)) : 0; });
  }
  // matchups avec écarts de voie
  out.matchups = tally(rows.filter((r) => r.opp), (r) => r.opp).map((m) => {
    const avgOf = (f) => { const v = m.rows.map(f).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
    return { ...m, cs10: avgOf((r) => (r.opp_cs10 != null && r.cs10 ? r.cs10 - r.opp_cs10 : NaN)), g15: avgOf((r) => (r.at15 && r.opp_at15 ? r.at15[0] - r.opp_at15[0] : NaN)), xp15: avgOf((r) => (r.at15 && r.opp_at15 ? r.at15[1] - r.opp_at15[1] : NaN)), kd: avgOf((r) => (r.opp_k != null ? r.k - r.opp_k : NaN)) };
  });
  // synergies : partenaire de voie (bot/support) ou jungle
  const PARTNER = { BOTTOM: 'UTILITY', UTILITY: 'BOTTOM', JUNGLE: 'MIDDLE', MIDDLE: 'JUNGLE', TOP: 'JUNGLE' };
  const pos = rows[0]?.pos;
  out.partnerPos = PARTNER[pos];
  out.synergy = tally(rows.filter((r) => r.allies?.length), (r) => r.allies.find((a) => a[1] === PARTNER[r.pos])?.[0]);
  // durée, palier
  const buckets = [[0, 20, '< 20'], [20, 25, '20-25'], [25, 30, '25-30'], [30, 35, '30-35'], [35, 99, '35 +']];
  out.byDur = buckets.map(([a, b, l]) => { const s = rows.filter((r) => r.dur / 60 >= a && r.dur / 60 < b); return { label: l, g: s.length, w: s.filter((r) => r.win).length }; });
  out.byTier = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].map((t) => { const s = rows.filter((r) => r.tier === t); return { tier: t, g: s.length, w: s.filter((r) => r.win).length }; });
  out.avg = statAverages(rows);
  out.perf = rows.reduce((a, r) => (a.k += r.k, a.d += r.d, a.a += r.a, a.cs += r.cs, a.dmg += r.dmg, a.min += r.dur / 60, a), { k: 0, d: 0, a: 0, cs: 0, dmg: 0, min: 0 });
  return out;
}

const STAT_DEFS = [
  ['KDA', (r) => [r.k + r.a, Math.max(1, r.d)], fmt2, 'ratio'],
  ['Éliminations', (r) => r.k, fmt1], ['Morts', (r) => r.d, fmt1, null, true], ['Assistances', (r) => r.a, fmt1],
  ['Participation', (r) => r.kp * 100, (v) => Math.round(v) + ' %'],
  ['CS / min', (r) => r.cs / (r.dur / 60), fmt1], ['CS à 10 min', (r) => r.cs10 || NaN, fmt1],
  ['Or / min', (r) => (r.gold || 0) / (r.dur / 60), fmt], ['Dégâts / min', (r) => r.dmg / (r.dur / 60), fmt],
  ['Part des dégâts', (r) => (r.dshare || 0) * 100, (v) => Math.round(v) + ' %'],
  ['Dégâts subis / min', (r) => (r.taken || 0) / (r.dur / 60), fmt], ['Dégâts atténués / min', (r) => (r.mitigated || 0) / (r.dur / 60), fmt],
  ['Soins + boucliers alliés', (r) => (r.heal || 0) + (r.shield || 0), fmt],
  ['Contrôle de foule (s)', (r) => r.cc ?? NaN, fmt1],
  ['Vision / min', (r) => (r.vision || 0) / (r.dur / 60), fmt2], ['Balises posées', (r) => r.wards ?? NaN, fmt1], ['Balises de contrôle', (r) => r.pinks ?? NaN, fmt1],
  ['Solo kills', (r) => r.solo ?? NaN, fmt2], ['Plaques de tour', (r) => r.plates ?? NaN, fmt2], ['Dégâts aux tours', (r) => r.turret ?? NaN, fmt],
  ['Premier sang', (r) => (r.fb ? 100 : 0), (v) => Math.round(v) + ' %'],
  ['Écart d\'or à 15 min', (r) => (r.at15 && r.opp_at15 ? r.at15[0] - r.opp_at15[0] : NaN), (v) => (v > 0 ? '+' : '') + fmt(v)],
  ['Écart d\'XP à 15 min', (r) => (r.at15 && r.opp_at15 ? r.at15[1] - r.opp_at15[1] : NaN), (v) => (v > 0 ? '+' : '') + fmt(v)],
  ['Écart de CS à 15 min', (r) => (r.at15 && r.opp_at15 ? r.at15[2] - r.opp_at15[2] : NaN), (v) => (v > 0 ? '+' : '') + fmt1(v)],
  ['Multikills (pour 100 parties)', (r) => ((r.doubles || 0) + (r.triples || 0) + (r.quadras || 0) + (r.pentas || 0)) * 100, fmt],
];
function statAverages(rows) {
  return STAT_DEFS.map(([l, f, fm, kind, low]) => {
    if (kind === 'ratio') { let a = 0, b = 0; for (const r of rows) { const [x, y] = f(r); a += x; b += y; } return { l, v: b ? a / b : NaN, fm, low }; }
    const v = rows.map(f).filter((x) => Number.isFinite(x));
    return { l, v: v.length ? v.reduce((a, c) => a + c, 0) / v.length : NaN, fm, low, n: v.length };
  });
}

const mmss = (t) => (t == null ? '—' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`);
const wrSpan = (e) => `<b class="${wrCls(pct(e.w, e.g))}">${pct(e.w, e.g)}%</b>`;
const smallRune = (id, size = 26) => (rune(id) ? `<img class="sq r" style="width:${size}px;height:${size}px" src="${rune(id).icon}" alt="" data-tip="${esc(rune(id).name)}">` : '');

/** Arbre de runes avec pick% et winrate de chaque rune. */
function runeTreeStats(treeId, b, secondary = false) {
  const tree = S.dd?.trees?.find((t) => t.id === +treeId);
  if (!tree) return '';
  const total = secondary ? (b.subTrees.find((t) => +t.key === +treeId)?.g || 1) : (b.primTrees.find((t) => +t.key === +treeId)?.g || 1);
  const slots = secondary ? tree.slots.slice(1) : tree.slots;
  return `<div class="rune-stats">${slots.map((sl, i) => `<div class="rs-row${!secondary && i === 0 ? ' ks' : ''}">${sl.map((id) => {
    const e = b.runeStat[id] || { g: 0, w: 0 };
    const p = pct(e.g, total);
    return `<div class="rs-cell${p >= 50 ? ' top' : ''}" data-tip="${esc(rune(id)?.name || '')} : ${e.g} parties">${rune(id) ? `<img src="${rune(id).icon}" alt="" style="opacity:${0.25 + Math.min(1, p / 60) * 0.75}">` : ''}<span class="p">${p}%</span><span class="${e.g ? wrCls(pct(e.w, e.g)) : 'dim'}">${e.g ? pct(e.w, e.g) + '%' : '—'}</span></div>`;
  }).join('')}</div>`).join('')}</div>`;
}

function pageMini(key) {
  const [style, prim, sub, sec, shards] = key.split('|');
  return `<div class="row" style="gap:4px">${smallRune(+style, 20)}${prim.split('.').map((id, i) => smallRune(+id, i ? 24 : 30)).join('')}<span class="dim" style="margin:0 4px">|</span>${smallRune(+sub, 20)}${sec.split('.').map((id) => smallRune(+id, 24)).join('')}<span class="dim" style="margin:0 4px">|</span>${shards.split('.').map((id) => smallRune(+id, 18)).join('')}</div>`;
}

function buildTabBuild(b, id) {
  const n = b.n;
  const page = b.pages[0];
  const sp = S.meta.spells[id];
  const spellPair = (key) => key.split('-').map((s) => `<img class="sq" style="width:32px;height:32px" src="${spellImg(s)}" alt="" data-tip="${esc(S.dd?.spells?.[s]?.name || '')}">`).join('');
  const skillIcon = (slot) => (sp?.spells?.[slot - 1] ? `<img src="${sp.spells[slot - 1].img}" alt="" data-tip="${esc(sp.spells[slot - 1].name)}">` : '');
  const g15 = b.avg.find((x) => x.l === 'Écart d\'or à 15 min');
  return `<div class="grid g4 mb" style="gap:10px">${[
      ['Winrate', `<span class="${wrCls(pct(b.wins, n))}">${pct(b.wins, n)}%</span>`, `${b.wins}V ${n - b.wins}D`],
      ['KDA moyen', kdaStr(b.perf.k, b.perf.d, b.perf.a), `${fmt1(b.perf.k / n)} / ${fmt1(b.perf.d / n)} / ${fmt1(b.perf.a / n)}`],
      ['1er objet terminé', mmss(b.slotTimes[0]), b.slotTimes[1] ? `2e à ${mmss(b.slotTimes[1])} · 3e à ${mmss(b.slotTimes[2])}` : '&nbsp;'],
      ['Écart d\'or à 15 min', g15 && Number.isFinite(g15.v) ? `<span class="${g15.v >= 0 ? 'ok' : 'loss'}">${g15.fm(g15.v)}</span>` : '—', g15?.n ? `sur ${g15.n} parties` : 'données des prochains imports'],
    ].map(([l, v, s]) => `<div class="kpi stat"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('')}</div>
  <div class="grid" style="grid-template-columns:1.25fr 1fr">
    <div class="card"><h3>Runes les plus jouées${page ? `<span class="r">${wrSpan(page)} WR · ${pct(page.g, b.full)}% · ${page.g} parties</span>` : ''}</h3>${page ? runePage(page.key) : '<p class="muted">—</p>'}
      ${b.bestPage && b.bestPage.key !== page?.key ? `<div class="sec-title mt">Meilleur winrate</div><div class="opt-row">${pageMini(b.bestPage.key)}${pctWr(b.bestPage, b.full)}</div>` : ''}</div>
    <div class="col" style="gap:16px">
      <div class="card"><h3>Sorts d'invocateur</h3>${b.spells.slice(0, 2).map((e) => `<div class="opt-row"><div class="row" style="gap:6px">${spellPair(e.key)}</div>${pctWr(e, n)}</div>`).join('')}</div>
      <div class="card"><h3>Objets de départ</h3>${b.starts.slice(0, 2).map((e) => `<div class="opt-row">${itemRow(e.key.split('-'), false)}${pctWr(e, b.tl)}</div>`).join('') || '<p class="muted">—</p>'}</div>
    </div></div>
  <div class="grid mt" style="grid-template-columns:1.25fr 1fr">
    <div class="card"><h3>Build principal<span class="r">dans l'ordre d'achat</span></h3>${b.cores.slice(0, 3).map((e, i) => `<div class="opt-row"><span class="badge ${i ? 'plain' : 'mvp'}">${i ? 'Alt.' : 'Top'}</span>${itemRow(e.key.split('-'))}${pctWr(e, b.ordRows)}</div>`).join('') || '<p class="muted">—</p>'}</div>
    <div class="card"><h3>Bottes</h3>${b.boots.filter((e) => e.key !== 'none').slice(0, 3).map((e) => `<div class="opt-row">${itemRow([e.key])}<span>${esc(itemName(e.key))}<div class="dim" style="font-size:12px">achetées vers ${mmss(e.time)}</div></span>${pctWr(e, n)}</div>`).join('') || '<p class="muted">—</p>'}</div>
  </div>
  ${b.orders[0] ? `<div class="card mt"><h3>Ordre des compétences<span class="r">${pct(b.orders[0].g, b.skillN)}% des parties · ${wrSpan(b.orders[0])} WR</span></h3>
    <div class="skill-grid"><span></span>${Array.from({ length: 18 }, (_, i) => `<div class="c" style="background:none">${i + 1}</div>`).join('')}
    ${[1, 2, 3, 4].map((sl) => `<div class="lab">${skillIcon(sl)}<b>${SK[sl]}</b></div>${b.grid.map((g) => `<div class="c${g === sl ? ` on ${SK[sl].toLowerCase()}` : ''}">${g === sl ? SK[sl] : ''}</div>`).join('')}`).join('')}</div></div>` : ''}`;
}

function buildTabRunes(b) {
  const trees = b.primTrees.slice(0, 2);
  const subs = b.subTrees.slice(0, 3);
  const shardNames = ['Attaque', 'Flexible', 'Défense'];
  return `<div class="card mb"><h3>Pages de runes complètes<span class="r">${b.full} parties avec la page complète</span></h3>
    <table class="ptable"><thead><tr><th>Page</th><th>Pick</th><th>Winrate</th><th>Parties</th></tr></thead><tbody>
    ${b.pages.slice(0, 8).map((p, i) => `<tr><td>${pageMini(p.key)}</td><td>${pct(p.g, b.full)}%</td><td>${wrSpan(p)}${b.bestPage?.key === p.key ? ' <span class="badge mvp">Meilleur WR</span>' : i === 0 ? ' <span class="badge plain">Plus jouée</span>' : ''}</td><td class="dim">${p.g}</td></tr>`).join('')}</tbody></table></div>
  <div class="grid g2">
    ${trees.map((t) => `<div class="card"><h3><span class="row" style="gap:8px">${smallRune(+t.key, 22)}${esc(rune(+t.key)?.name || '')} (principal)</span><span class="r">${pct(t.g, b.full)}% · ${wrSpan(t)} WR</span></h3>${runeTreeStats(t.key, b)}<p class="data-note" style="margin:10px 0 0">Pour chaque rune : % de parties où elle est prise dans cet arbre, puis winrate.</p></div>`).join('')}
  </div>
  <div class="grid g3 mt">
    ${subs.map((t) => `<div class="card"><h3><span class="row" style="gap:8px">${smallRune(+t.key, 20)}${esc(rune(+t.key)?.name || '')} (secondaire)</span><span class="r">${pct(t.g, b.full)}% · ${wrSpan(t)}</span></h3>${runeTreeStats(t.key, b, true)}</div>`).join('')}
  </div>
  <div class="card mt"><h3>Fragments de stats</h3><div class="grid g3">${b.shardRows.map((row, i) => `<div><div class="sec-title" style="margin-bottom:8px">${shardNames[i]}</div>${row.slice(0, 3).map((e) => `<div class="opt-row" style="padding:6px 0">${smallRune(+e.key, 28)}<span style="font-size:12.5px">${esc(rune(+e.key)?.name || e.key)}</span>${pctWr(e, b.full)}</div>`).join('')}</div>`).join('')}</div></div>`;
}

function buildTabItems(b) {
  const n = b.n;
  return `<div class="grid g2 mb">
    <div class="card"><h3>Objets de départ<span class="r">${b.tl} parties avec chronologie</span></h3>${b.starts.slice(0, 5).map((e) => `<div class="opt-row">${itemRow(e.key.split('-'), false)}${pctWr(e, b.tl)}</div>`).join('') || '<p class="muted">—</p>'}</div>
    <div class="card"><h3>Bottes</h3>${b.boots.slice(0, 5).map((e) => e.key === 'none' ? `<div class="opt-row"><span class="sq" style="width:40px;height:40px"></span><span>Sans bottes</span>${pctWr(e, n)}</div>` : `<div class="opt-row">${itemRow([e.key])}<span>${esc(itemName(e.key))}<div class="dim" style="font-size:12px">vers ${mmss(e.time)}</div></span>${pctWr(e, n)}</div>`).join('')}</div>
  </div>
  <div class="card mb"><h3>Objets par ordre d'achat<span class="r">objets légendaires terminés · % des parties ayant atteint ce slot</span></h3>
    <div class="slot-grid">${b.slots.map((sl, k) => `<div class="slot-col"><div class="sec-title" style="margin-bottom:6px">${k + 1}${k ? 'e' : 'er'} objet</div>${k < 3 && b.slotTimes[k] ? `<div class="data-note" style="margin:-4px 0 8px">vers ${mmss(b.slotTimes[k])}</div>` : '<div style="height:14px"></div>'}
      ${sl.slice(0, 5).map((e) => { const tot = sum(sl, (x) => x.g); return `<div class="slot-item"><img src="${itemImg(e.key)}" alt="" data-tip="${esc(itemName(e.key))}"><div><div style="font-size:12px">${pct(e.g, tot)}%</div><div style="font-size:12px">${wrSpan(e)}</div></div></div>`; }).join('') || '<span class="dim">—</span>'}</div>`).join('')}</div></div>
  <div class="grid g2">
    <div class="card"><h3>Combinaisons de 3 objets</h3>${b.cores.slice(0, 6).map((e) => `<div class="opt-row">${itemRow(e.key.split('-'), false)}${pctWr(e, b.ordRows)}</div>`).join('') || '<p class="muted">—</p>'}</div>
    <div class="card"><h3>Duos de 2 premiers objets</h3>${b.cores2.slice(0, 6).map((e) => `<div class="opt-row">${itemRow(e.key.split('-'), false)}${pctWr(e, b.ordRows)}</div>`).join('') || '<p class="muted">—</p>'}</div>
  </div>`;
}

function buildTabSkills(b, id) {
  const sp = S.meta.spells[id];
  const skillIcon = (slot) => (sp?.spells?.[slot - 1] ? `<img src="${sp.spells[slot - 1].img}" alt="" data-tip="${esc(sp.spells[slot - 1].name)}">` : '');
  if (!b.orders[0]) return '<div class="card"><p class="muted">Nécessite des parties avec chronologie.</p></div>';
  return `<div class="grid g2 mb">
    <div class="card"><h3>Ordre de maximisation</h3>${b.orders.slice(0, 4).map((o) => `<div class="opt-row"><div class="max-order">${o.key.split(' > ').map((k, j) => `${j ? '<span class="dim">›</span>' : ''}<div class="k" style="background:${{ Q: '#c43a46', W: '#2f7fc4', E: '#3aa070' }[k]}">${skillIcon(SK.indexOf(k))}<b>${k}</b></div>`).join('')}</div>${pctWr(o, b.skillN)}</div>`).join('')}</div>
    <div class="card"><h3>Trois premiers niveaux</h3>${b.first3.slice(0, 5).map((o) => `<div class="opt-row"><b style="font-family:var(--display);font-size:16px;letter-spacing:.06em">${o.key}</b>${pctWr(o, b.skillN)}</div>`).join('')}</div>
  </div>
  <div class="card"><h3>Ordre complet le plus joué</h3><div class="skill-grid"><span></span>${Array.from({ length: 18 }, (_, i) => `<div class="c" style="background:none">${i + 1}</div>`).join('')}
    ${[1, 2, 3, 4].map((sl) => `<div class="lab">${skillIcon(sl)}<b>${SK[sl]}</b></div>${b.grid.map((g) => `<div class="c${g === sl ? ` on ${SK[sl].toLowerCase()}` : ''}">${g === sl ? SK[sl] : ''}</div>`).join('')}`).join('')}</div></div>`;
}

const MU_COLS = [['g', 'Parties', (m) => m.g], ['wr', 'Winrate', (m) => adjWr(m.w, m.g)], ['cs10', 'CS à 10 min', (m) => m.cs10 ?? -1e9], ['g15', 'Or à 15 min', (m) => m.g15 ?? -1e9], ['xp15', 'XP à 15 min', (m) => m.xp15 ?? -1e9], ['kd', 'Écart d\'éliminations', (m) => m.kd ?? -1e9]];
function buildTabMatchups(b) {
  const minG = S.meta.muMin;
  const col = MU_COLS.find((c) => c[0] === S.meta.muSort) || MU_COLS[0];
  const list = b.matchups.filter((m) => m.g >= minG).sort((a, x) => col[2](x) - col[2](a));
  const diff = (v, f = fmt) => (v == null ? '<span class="dim">—</span>' : `<span class="${v >= 0 ? 'ok' : 'loss'}">${v > 0 ? '+' : ''}${f(v)}</span>`);
  const partner = roleOf(b.partnerPos)?.[1];
  return `<div class="row mb" style="justify-content:space-between"><div class="chips">${[1, 3, 5, 10].map((v) => `<button class="chip${minG === v ? ' on' : ''}" data-mumin="${v}">${v}+ parties</button>`).join('')}</div><span class="data-note">Écarts face à l'adversaire de voie (positif = à ton avantage)</span></div>
  <div class="grid" style="grid-template-columns:1.6fr 1fr;align-items:start">
    <div class="card flush" style="overflow-x:auto"><table class="ptable"><thead><tr><th>Adversaire</th>${MU_COLS.map(([k, l]) => `<th data-musort="${k}" class="${k === col[0] ? 'sorted' : ''}" style="cursor:pointer">${l}</th>`).join('')}</tr></thead><tbody>
      ${list.map((m) => `<tr class="click" data-bchamp="${m.key}"><td><div class="row" style="gap:8px"><img class="cicon sm" src="${champImg(m.key)}" alt=""><b>${esc(champName(m.key))}</b></div></td><td>${m.g}</td><td>${wrSpan(m)}</td><td>${diff(m.cs10, fmt1)}</td><td>${diff(m.g15)}</td><td>${diff(m.xp15)}</td><td>${diff(m.kd, fmt1)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:16px">Aucun matchup avec assez de parties.</td></tr>'}
    </tbody></table></div>
    <div class="card"><h3>Meilleurs alliés${partner ? ` (${partner.toLowerCase()})` : ''}<span class="r">2 parties min.</span></h3>${b.synergy.filter((e) => e.key && e.g >= 2).sort((a, x) => adjWr(x.w, x.g) - adjWr(a.w, a.g)).slice(0, 8).map((e) => `<div class="champ-mini"><img class="cicon sm" src="${champImg(e.key)}" alt=""><span class="grow">${esc(champName(e.key))}</span><span class="dim">${e.g} p.</span><span style="width:44px;text-align:right">${wrSpan(e)}</span></div>`).join('') || '<p class="muted">Pas assez de données.</p>'}</div>
  </div>`;
}

function buildTabStats(b, pos) {
  const role = S.meta.roleRows?.[pos];
  if (role === undefined) { loadRoleRows(pos); }
  const ravg = Array.isArray(role) && role.length ? statAverages(role) : null;
  const rows = b.rows;
  const tot = sum(rows, (r) => (r.phys || 0) + (r.magic || 0) + (r.true || 0)) || 1;
  const ph = sum(rows, (r) => r.phys || 0), mg = sum(rows, (r) => r.magic || 0), tr = sum(rows, (r) => r.true || 0);
  const maxDur = Math.max(1, ...b.byDur.map((d) => d.g));
  return `<div class="grid" style="grid-template-columns:1.3fr 1fr;align-items:start">
    <div class="card flush"><table class="ptable"><thead><tr><th>Statistique (moyenne par partie)</th><th>${esc(champName(S.meta.champ))}</th><th>Moyenne du rôle</th><th>Écart</th></tr></thead><tbody>
      ${b.avg.map((a, i) => {
        const r = ravg?.[i];
        const ok = r && Number.isFinite(a.v) && Number.isFinite(r.v);
        const abs = a.l.startsWith('Écart');
        let cell = '<span class="dim">≈</span>';
        if (ok && abs) { const d = a.v - r.v; if (Math.abs(d) >= 1) cell = `<span class="${d > 0 ? 'ok' : 'loss'}">${d > 0 ? '+' : ''}${a.l.includes('CS') ? fmt1(d) : fmt(d)}</span>`; }
        else if (ok && r.v) { const d = (a.v - r.v) / Math.abs(r.v); const good = a.low ? d < 0 : d > 0; if (Math.abs(d) >= 0.03) cell = `<span class="${good ? 'ok' : 'loss'}">${d > 0 ? '+' : ''}${Math.round(d * 100)} %</span>`; }
        return `<tr><td>${a.l}</td><td><b>${Number.isFinite(a.v) ? a.fm(a.v) : '—'}</b></td><td class="muted">${r && Number.isFinite(r.v) ? r.fm(r.v) : Array.isArray(role) ? '—' : '…'}</td><td>${cell}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <div class="col" style="gap:16px">
      <div class="card"><h3>Winrate selon la durée</h3><div class="dur-chart">${b.byDur.map((d) => { const w = pct(d.w, d.g); return `<div class="dc"><span class="${d.g ? wrCls(w) : 'dim'}" style="font-size:12px">${d.g ? w + '%' : '—'}</span><i style="height:${d.g ? Math.max(6, Math.abs(w - 50) * 2.4 + 6) : 2}px;background:${!d.g ? 'var(--card3)' : w >= 50 ? 'var(--win)' : 'var(--loss)'};opacity:${0.35 + (d.g / maxDur) * 0.65}"></i><small>${d.label} min</small><small class="dim">${d.g} p.</small></div>`; }).join('')}</div></div>
      <div class="card"><h3>Type de dégâts</h3><div class="row" style="gap:0;height:12px;border-radius:6px;overflow:hidden"><i style="width:${(ph * 100) / tot}%;background:#ff7a59;height:100%"></i><i style="width:${(mg * 100) / tot}%;background:#7a8cff;height:100%"></i><i style="width:${(tr * 100) / tot}%;background:#e8e2d4;height:100%"></i></div>
        <div class="row dim mt" style="font-size:12px;gap:14px;margin-top:8px"><span><b style="color:#ff7a59">■</b> Physiques ${pct(ph, tot)}%</span><span><b style="color:#7a8cff">■</b> Magiques ${pct(mg, tot)}%</span><span><b style="color:#e8e2d4">■</b> Bruts ${pct(tr, tot)}%</span></div></div>
      <div class="card"><h3>Winrate par palier</h3>${b.byTier.map((t) => `<div class="opt-row" style="padding:7px 0">${emblem(t.tier, 'I', 'xs')}<span>${TIER_FR[t.tier]}</span><div class="stats">${t.g ? wrSpan(t) : '—'}<div class="dim">${t.g} parties</div></div></div>`).join('')}</div>
    </div></div>`;
}

async function loadRoleRows(pos) {
  S.meta.roleRows ??= {};
  if (S.meta.roleRows[pos] !== undefined) return;
  S.meta.roleRows[pos] = null;
  try { S.meta.roleRows[pos] = await call('meta_rows', { champId: null, pos, patch: metaPatch() }); } catch { S.meta.roleRows[pos] = []; }
  if (S.view === 'builds') render();
}

function vBuildChamp() {
  const id = S.meta.champ;
  const c = champ(id);
  const all = S.meta.rows;
  const back = '<button class="btn sm" data-act="meta-back">‹ Tier list</button>';
  if (!all) return `<div class="page-title"><div class="row">${back}<h1>${esc(champName(id))}</h1></div></div>${loader('Calcul du build…')}`;
  const posList = tally(all.filter((r) => r.pos), (r) => r.pos);
  const pos = S.meta.bpos && posList.some((p) => p.key === S.meta.bpos) ? S.meta.bpos : posList[0]?.key;
  const rows = pos ? all.filter((r) => r.pos === pos) : all;
  const ov = S.meta.overview;
  const tabs = [['build', 'Build'], ['runes', 'Runes'], ['items', 'Objets'], ['skills', 'Compétences'], ['matchups', 'Matchups'], ['stats', 'Statistiques']];
  const head = `<div class="bhead mb"><div class="splash" style="background-image:url('${champSplash(id)}')"></div>
    <img class="cicon lg" src="${champImg(id)}" alt="" style="width:72px;height:72px;border-radius:14px;border:2px solid var(--gold)">
    <div class="grow"><div class="row" style="gap:10px;margin-bottom:6px">${back}</div><h1 style="font-size:34px">${esc(champName(id))} <span class="muted" style="font-size:18px;font-weight:400">${esc(c?.title || '')}</span></h1>
      <div class="chips mt" style="margin-top:10px">${posList.map((p) => `<button class="chip${p.key === pos ? ' on' : ''}" data-bpos2="${p.key}">${roleOf(p.key)?.[1] || p.key} <span class="dim">${p.g}</span></button>`).join('')}</div></div>
    ${rows.length ? `<div class="row" style="gap:12px">${[['Tier', `<span class="tier-grade ${grade(rows.filter((r) => r.win).length, rows.length)}">${grade(rows.filter((r) => r.win).length, rows.length)}</span>`], ['Winrate', `<span class="${wrCls(pct(rows.filter((r) => r.win).length, rows.length))}">${pct(rows.filter((r) => r.win).length, rows.length)}%</span>`], ['Pick', fmt1((rows.length * 100) / ov.matches) + '%'], ['Ban', fmt1(((ov.bans[id] || 0) * 100) / ov.matches) + '%'], ['Parties', rows.length]].map(([l, v]) => `<div class="kpi stat" style="min-width:84px;background:rgba(15,15,20,.75)"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>` : ''}
  </div>`;
  if (!rows.length) return `<div class="fade-in">${head}<div class="card">${empty('sword', 'Pas encore de données', `Aucune partie Master+ avec ${esc(champName(id))} pour ce filtre. Importe plus de parties ou choisis « Tous les patchs ».`, '<button class="btn primary" data-msync="300">Importer 300 parties</button>')}</div></div>`;
  const b = buildAgg(rows);
  b.rows = rows;
  const few = b.n < 20 ? `<div class="warn-note mb">Seulement ${b.n} parties pour ce champion à ce rôle : les statistiques sont indicatives. L'import automatique en ajoute à chaque ouverture.</div>` : '';
  const tab = S.meta.tab || 'build';
  const body = tab === 'runes' ? buildTabRunes(b) : tab === 'items' ? buildTabItems(b) : tab === 'skills' ? buildTabSkills(b, id) : tab === 'matchups' ? buildTabMatchups(b) : tab === 'stats' ? buildTabStats(b, pos) : buildTabBuild(b, id);
  return `<div class="fade-in">${head}${few}
    <div class="row mb" style="justify-content:space-between">${patchChips()}<span class="data-note">${b.n} parties Master+${b.tl < b.n ? ` · ${b.tl} avec chronologie` : ''}</span></div>
    <div class="tabs big-tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-btab="${k}">${l}</button>`).join('')}</div>
    ${body}</div>`;
}

/* ================================================================ coach (comparaison avec les Master+) */
const curPatch = () => (S.dd?.version || '').split('.').slice(0, 2).join('.');
const COACH_METRICS = [
  { k: 'cs10', l: 'CS à 10 min', f: (x) => x.cs10, fmt: fmt1, noSup: true },
  { k: 'csmin', l: 'CS / min', f: (x) => x.cs / (x.dur / 60), fmt: fmt1, noSup: true },
  { k: 'dmg', l: 'Dégâts / min', f: (x) => x.dmg / (x.dur / 60), fmt: fmt },
  { k: 'gold', l: 'Or / min', f: (x) => x.gold / (x.dur / 60), fmt: fmt },
  { k: 'vision', l: 'Vision / min', f: (x) => x.vision / (x.dur / 60), fmt: fmt2 },
  { k: 'deaths', l: 'Morts / 10 min', f: (x) => (x.d * 600) / x.dur, fmt: fmt1, low: true },
  { k: 'kp', l: 'Participation', f: (x) => x.kp * 100, fmt: (v) => Math.round(v) + ' %' },
];

/** Ligne au format « méta » pour un joueur d'une de mes parties. */
function coachRowOf(m, p) {
  const team = teamOf(m, p);
  const tk = sum(team, (x) => x.k);
  return { ...p, dur: m.duration, cs10: p.cs10 || 0, kp: tk ? (p.k + p.a) / tk : 0 };
}

const coachKey = (m, me) => `${me.champ_id}|${me.pos}`;
async function loadCoach(m, me) {
  const key = coachKey(m, me);
  if (S.coach[key] || !me.pos || isArena(m) || m.queue === 450) return;
  S.coach[key] = 'loading';
  try {
    let rows = await call('meta_rows', { champId: me.champ_id, pos: me.pos, patch: null });
    let scope = 'champ';
    if (rows.length < 8) { rows = await call('meta_rows', { champId: null, pos: me.pos, patch: null }); scope = 'role'; }
    S.coach[key] = { rows, scope };
  } catch (e) { S.coach[key] = { rows: [], scope: 'role' }; }
  render();
}

function coachAnalysis(m, me) {
  const c = S.coach[coachKey(m, me)];
  if (!c || c === 'loading') return c;
  if (c.rows.length < 8) return { empty: true };
  const mine = coachRowOf(m, me);
  const sup = me.pos === 'UTILITY';
  const metrics = COACH_METRICS.filter((x) => !(x.noSup && sup) && !(x.k === 'cs10' && (!mine.cs10 || !c.rows.some((r) => r.cs10))));
  const res = metrics.map((x) => {
    const vals = c.rows.map(x.f).filter((v) => Number.isFinite(v) && !(x.k === 'cs10' && v === 0));
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const v = x.f(mine);
    let delta = avg ? (v - avg) / avg : 0;
    if (x.low) delta = -delta;
    return { ...x, v, avg, delta: Math.max(-1, Math.min(1, delta)) };
  });
  const work = res.filter((r) => r.delta < -0.1).sort((a, b) => a.delta - b.delta).slice(0, 3);
  const good = res.filter((r) => r.delta > 0.1).sort((a, b) => b.delta - a.delta).slice(0, 2);
  const note = Math.round(50 + (res.reduce((a, r) => a + r.delta, 0) / res.length) * 100);
  return { res, work, good, note: Math.max(0, Math.min(100, note)), n: c.rows.length, scope: c.scope, mine };
}

function coachAdvice(r, me, m) {
  const avg = r.fmt(r.avg), v = r.fmt(r.v);
  const jg = me.pos === 'JUNGLE';
  switch (r.k) {
    case 'cs10': return jg
      ? `${v} camps/sbires à 10 min contre ${avg} chez les Master+. Enchaîne tes camps entre deux gank et évite de traverser la carte sans raison avant ton premier retour.`
      : `${v} CS à 10 min contre ${avg} chez les Master+. Travaille le last-hit sous la tour et dans les échanges, et ne quitte pas ta voie avant 10 min sans raison (vise ${Math.round(r.avg)}).`;
    case 'csmin': return jg
      ? `${v} CS/min contre ${avg}. Après les premiers objectifs, nettoie tes camps et ceux de l'adversaire quand c'est sans risque au lieu d'attendre ton équipe.`
      : `${v} CS/min contre ${avg}. Après la phase de voie, ramasse les vagues sur les côtés entre deux objectifs plutôt que de rester groupé sans rien faire.`;
    case 'dmg': return `Tes dégâts aux champions (${v}/min) sont sous ceux des Master+ (${avg}/min). Cherche plus d'échanges rentables en voie et place-toi pour pouvoir taper pendant tout le combat.`;
    case 'gold': return `${v} or/min contre ${avg}. Combine farm, plaques de tour et objectifs : l'or vient surtout des sbires et des tours, pas seulement des éliminations.`;
    case 'vision': return `Score de vision de ${v}/min contre ${avg}. Achète une balise de contrôle à chaque retour (tu en as acheté ${me.pinks || 0}) et pose ton totem dès qu'il est rechargé.`;
    case 'deaths': return `${me.d} morts (${v} par 10 min) contre ${avg} chez les Master+, soit ${dur(me.dead || 0)} passées mort. Avant d'avancer, regarde la mini-carte : si le jungler adverse n'est pas visible, joue plus prudemment.`;
    case 'kp': return `Participation de ${v} contre ${avg}. Rejoins les combats et les objectifs (dragons, larves, Héraut) quand ta voie est poussée, au lieu de rester seul.`;
    default: return '';
  }
}

function coachPanel(m, me, compact = false) {
  if (!me.pos || isArena(m) || m.queue === 450) return '<p class="muted">Le coach analyse les parties de la Faille de l\'invocateur (classées, normales, rapides).</p>';
  const a = coachAnalysis(m, me);
  if (!a || a === 'loading') { loadCoach(m, me); return loader('Comparaison avec les joueurs Master+…'); }
  if (a.empty) return `<div class="col" style="align-items:flex-start"><p class="muted" style="margin:0">Pas encore assez de parties Master+ pour comparer cette partie. Importe des parties dans « Builds & tier list ».</p><button class="btn sm primary" data-go="builds">Ouvrir Builds & tier list</button></div>`;
  const who = a.scope === 'champ' ? `${esc(champName(me.champ_id, me.champ))} ${roleOf(me.pos)?.[1]?.toLowerCase() || ''}` : `tous les ${roleOf(me.pos)?.[1]?.toLowerCase() || 'joueurs'}s`;
  const cards = (list, cls, title) => list.length ? `<div class="sec-title" style="margin-top:${compact ? 8 : 16}px">${title}</div>${list.map((r) => `<div class="coach-tip ${cls}"><b>${r.l}</b><span>${cls === 'bad' ? coachAdvice(r, me, m) : `${r.fmt(r.v)} contre ${r.fmt(r.avg)} chez les Master+ (${r.delta > 0 ? '+' : ''}${Math.round(r.delta * 100)} %).`}</span></div>`).join('')}` : '';
  if (compact) {
    return `<div class="row" style="gap:16px;align-items:flex-start"><div class="coach-note ${a.note >= 55 ? 'good' : a.note >= 45 ? 'mid' : 'bad'}">${a.note}<small>/100</small></div>
      <div class="grow">${a.work.length ? cards(a.work.slice(0, 2), 'bad', 'À travailler') : '<p class="ok" style="margin:0">Partie au niveau des Master+ sur tous les points mesurés. Bien joué !</p>'}</div></div>`;
  }
  return `<div class="row mb" style="gap:16px"><div class="coach-note ${a.note >= 55 ? 'good' : a.note >= 45 ? 'mid' : 'bad'}">${a.note}<small>/100</small></div>
    <div><b>Comparé à ${a.n} parties Master+ (${who})</b><div class="data-note">50 = niveau moyen d'un Master+ ; au-dessus, tu as fait mieux sur l'ensemble des points mesurés.</div></div></div>
    <div class="grid g2"><div>
      <table class="ptable"><thead><tr><th>Statistique</th><th>Toi</th><th>Master+</th><th>Écart</th></tr></thead><tbody>
      ${a.res.map((r) => `<tr><td>${r.l}</td><td><b>${r.fmt(r.v)}</b></td><td class="muted">${r.fmt(r.avg)}</td>
        <td><div class="minibar"><div class="coach-bar"><i style="${r.delta >= 0 ? `left:50%;width:${r.delta * 50}%;background:var(--ok)` : `right:50%;width:${-r.delta * 50}%;background:var(--loss)`}"></i></div><span class="${r.delta >= 0 ? 'ok' : 'loss'}" style="width:46px;text-align:right">${r.delta > 0 ? '+' : ''}${Math.round(r.delta * 100)} %</span></div></td></tr>`).join('')}
      </tbody></table></div>
      <div>${a.work.length ? cards(a.work, 'bad', 'À travailler') : '<p class="ok">Rien à signaler : tu es au niveau des Master+ sur tous les points mesurés.</p>'}${cards(a.good, 'good', 'Points forts')}</div></div>`;
}

/* ================================================================ comparer deux joueurs */
const mineFor = (matches, puuid) => matches.map((m) => ({ m, me: m.parts.find((x) => x.puuid === puuid) })).filter((x) => x.me);

async function loadCompare(riotId, platform) {
  const id = parseRiotId(riotId);
  if (!id) return toast('Format attendu : Nom#TAG', true);
  S.cmp = { ...S.cmp, loading: true, b: null, bm: null };
  render();
  try {
    const b = await call('lookup', { gameName: id[0], tagLine: id[1], platform });
    let bm = await call('cached_matches', { puuid: b.puuid, limit: 40 });
    S.cmp.b = b; S.cmp.bm = bm; render();
    const fresh = await call('fetch_matches', { puuid: b.puuid, platform: b.platform, start: 0, count: 20 });
    if (S.cmp.b === b) S.cmp.bm = mergeMatches(bm, fresh);
    pushRecent(b);
    if (!S.all) loadAll();
  } catch (e) { toast(e, true); }
  S.cmp.loading = false;
  render();
}

function cmpSide(p, matches) {
  const list = mineFor(matches, p.puuid).slice(0, 20);
  const t = aggregate(list);
  const champs = champAgg(list).sort((a, b) => b.t.games - a.t.games).slice(0, 5);
  return { p, list, t, champs };
}

function vCompare() {
  if (!S.profile) return needProfile();
  const A = S.profile;
  const head = `<div class="page-title"><div><h1>Comparer <em>deux joueurs</em></h1><p>Rangs, statistiques sur les 20 dernières parties, champions et historique commun</p></div></div>`;
  const pick = `<form class="card row" id="cmpForm" style="gap:10px"><input class="input" id="cmpQ" placeholder="Joueur à comparer — Nom#TAG" value="${esc(S.cmp.q)}" spellcheck="false" style="flex:1">
    <select class="input" id="cmpReg" style="width:100px">${REGIONS.map(([v, l]) => `<option value="${v}"${v === A.platform ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn primary" type="submit">Comparer</button></form>
    ${favs().length || recents().length ? `<div class="chips mt">${[...favs(), ...recents()].filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i && f.id.toLowerCase() !== riotIdOf(A).toLowerCase()).slice(0, 8).map((f) => `<button class="chip" data-cmp="${esc(f.id)}" data-plat="${f.platform}">${esc(f.id)}</button>`).join('')}</div>` : ''}`;
  if (!S.cmp.b) return `<div class="fade-in">${head}${pick}${S.cmp.loading ? loader('Chargement du joueur…') : ''}</div>`;
  const B = S.cmp.b;
  const a = cmpSide(A, S.all || S.matches), b = cmpSide(B, S.cmp.bm || []);
  const ident = (s, side) => `<div class="cmp-id ${side}"><img src="${iconImg(s.p.icon)}" alt=""><div><h2>${esc(s.p.game_name)} <span class="dim" style="font-weight:400">#${esc(s.p.tag_line)}</span></h2>
    <div class="row wrap" style="gap:6px;margin-top:6px">${['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'].map((q) => { const r = s.p.ranks.find((x) => x.queue === q); return `<span class="row" style="gap:6px">${emblem(r?.tier, r?.rank, 'xs')}<span style="font-size:12.5px"><b style="color:${r ? TIER_COLOR[r.tier] : 'var(--dim)'}">${r ? rankLabel(r) : 'Non classé'}</b>${r ? ` <span class="dim">${r.lp} LP · ${QTYPE[q]}</span>` : ` <span class="dim">${QTYPE[q]}</span>`}</span></span>`; }).join('')}</div></div></div>`;
  const ta = a.t, tb = b.t;
  const rows = [
    ['Parties analysées', ta.games, tb.games, (v) => v, null],
    ['Winrate', pct(ta.wins, ta.games), pct(tb.wins, tb.games), (v) => v + ' %', 1],
    ['KDA', (ta.k + ta.a) / Math.max(1, ta.d), (tb.k + tb.a) / Math.max(1, tb.d), fmt2, 1],
    ['Note moyenne', ta.score / Math.max(1, ta.games), tb.score / Math.max(1, tb.games), fmt1, 1],
    ['Participation', (ta.kp * 100) / Math.max(1, ta.games), (tb.kp * 100) / Math.max(1, tb.games), (v) => Math.round(v) + ' %', 1],
    ['CS / min', ta.cs / Math.max(1, ta.min), tb.cs / Math.max(1, tb.min), fmt1, 1],
    ['Dégâts / min', ta.dmg / Math.max(1, ta.min), tb.dmg / Math.max(1, tb.min), fmt, 1],
    ['Part des dégâts', (ta.dshare * 100) / Math.max(1, ta.games), (tb.dshare * 100) / Math.max(1, tb.games), (v) => Math.round(v) + ' %', 1],
    ['Or / min', ta.gold / Math.max(1, ta.min), tb.gold / Math.max(1, tb.min), fmt, 1],
    ['Vision / min', ta.vision / Math.max(1, ta.min), tb.vision / Math.max(1, tb.min), fmt2, 1],
    ['Morts / partie', ta.d / Math.max(1, ta.games), tb.d / Math.max(1, tb.games), fmt1, -1],
  ];
  const cmpRows = rows.map(([l, va, vb, f, dir]) => {
    const mx = Math.max(va, vb, 1e-9);
    const aBest = dir && (dir > 0 ? va > vb : va < vb), bBest = dir && (dir > 0 ? vb > va : vb < va);
    return `<div class="cmp-row"><b class="${aBest ? 'gold' : ''}">${f(va)}</b><div class="l"><i style="width:${(va * 100) / mx}%;${aBest ? 'background:var(--gold2)' : 'background:#59606e'}"></i></div><div class="lab">${l}</div><div class="rr"><i style="width:${(vb * 100) / mx}%;${bBest ? 'background:var(--gold2)' : 'background:#59606e'}"></i></div><b class="right ${bBest ? 'gold' : ''}">${f(vb)}</b></div>`;
  }).join('');
  const wonA = rows.filter((r) => r[4] && (r[4] > 0 ? r[1] > r[2] : r[1] < r[2])).length, wonB = rows.filter((r) => r[4] && (r[4] > 0 ? r[2] > r[1] : r[2] < r[1])).length;
  const champList = (s) => s.champs.map((c) => { const w = pct(c.t.wins, c.t.games); return `<div class="champ-mini"><img class="cicon sm" src="${champImg(c.id, c.champ)}" alt=""><span class="grow"><b>${esc(champName(c.id, c.champ))}</b><div class="dim" style="font-size:12px">${kdaStr(c.t.k, c.t.d, c.t.a)} KDA</div></span><span class="dim">${c.t.games} p.</span><b class="${wrCls(w)}" style="width:44px;text-align:right">${w}%</b></div>`; }).join('') || '<p class="muted">—</p>';
  // historique commun
  const pool = mergeMatches(S.all || S.matches, S.cmp.bm || []);
  const shared = pool.filter((m) => m.parts.some((x) => x.puuid === A.puuid) && m.parts.some((x) => x.puuid === B.puuid));
  const together = shared.filter((m) => { const pa = m.parts.find((x) => x.puuid === A.puuid), pb = m.parts.find((x) => x.puuid === B.puuid); return teamKey(m, pa) === teamKey(m, pb); });
  const against = shared.filter((m) => !together.includes(m));
  const togW = together.filter((m) => !m.remake && m.parts.find((x) => x.puuid === A.puuid).win).length;
  const agW = against.filter((m) => !m.remake && m.parts.find((x) => x.puuid === A.puuid).win).length;
  return `<div class="fade-in">${head}
    <div class="cmp-head"><div>${ident(a, 'a')}</div><div class="cmp-vs"><span>VS</span><div class="dim" style="font-size:12px;margin-top:4px">${wonA} – ${wonB}</div></div><div>${ident(b, 'b')}</div></div>
    <div class="row mt" style="justify-content:flex-end;gap:8px"><button class="btn sm" data-act="cmp-reset">Changer de joueur</button><button class="btn sm" data-riot="${esc(riotIdOf(B))}">Ouvrir le profil de ${esc(B.game_name)}</button></div>
    <div class="card mt"><h3>Statistiques<span class="r">20 dernières parties de chacun · en or, le meilleur des deux</span></h3>${S.cmp.loading ? loader('Récupération des parties…') : cmpRows}</div>
    <div class="grid g2 mt"><div class="card"><h3>Champions de ${esc(A.game_name)}</h3>${champList(a)}</div><div class="card"><h3>Champions de ${esc(B.game_name)}</h3>${champList(b)}</div></div>
    <div class="card mt"><h3>Historique commun<span class="r">${shared.length} parties trouvées dans les parties enregistrées</span></h3>
      ${shared.length ? `<div class="grid g2 mb" style="gap:12px">
        <div class="kpi stat"><div class="label">Dans la même équipe</div><div class="value">${together.length ? pct(togW, together.length) + ' %' : '—'}</div><div class="sub">${togW}V ${together.length - togW}D</div></div>
        <div class="kpi stat"><div class="label">L'un contre l'autre</div><div class="value">${against.length ? `${agW} – ${against.length - agW}` : '—'}</div><div class="sub">victoires de ${esc(A.game_name)} – victoires de ${esc(B.game_name)}</div></div></div>
        ${shared.slice(0, 10).map((m) => { const pa = m.parts.find((x) => x.puuid === A.puuid), pb = m.parts.find((x) => x.puuid === B.puuid); const same = teamKey(m, pa) === teamKey(m, pb); return `<div class="list-row click" data-cmp-match="${esc(m.id)}"><span class="badge ${pa.win ? 'plain' : 'fb'}" style="width:62px;text-align:center">${m.remake ? 'Remake' : pa.win ? 'Victoire' : 'Défaite'}</span><img class="cicon sm" src="${champImg(pa.champ_id, pa.champ)}" alt=""><span>${pa.k}/${pa.d}/${pa.a}</span><span class="tag ${same ? 'blue' : 'red'}">${same ? 'ensemble' : 'contre'}</span><img class="cicon sm" src="${champImg(pb.champ_id, pb.champ)}" alt=""><span>${pb.k}/${pb.d}/${pb.a}</span><span class="grow"></span><span class="dim">${queueName(m.queue)} · ${ago(m.creation)}</span></div>`; }).join('')}`
      : `<p class="muted" style="margin:0">Aucune partie commune dans les parties enregistrées. Importe plus de parties (Analyse → Importer) pour chercher plus loin dans l'historique.</p>`}
    </div></div>`;
}

/* ================================================================ import Master+ automatique */
let autoMetaDone = false;
/** Au lancement : reprend un import interrompu, sinon petite mise à jour une fois par jour (désactivable). */
async function autoMeta() {
  if (autoMetaDone || !S.settings?.api_key || S.meta.sync || !S.dd) return;
  autoMetaDone = true;
  try { S.meta.status = await call('meta_status'); } catch {}
  if (S.meta.status?.running) return;
  const job = store.get('metaJob', null);
  if (job && job.patch === curPatch() && job.remaining > 0) return metaSync(job.remaining, true);
  if (store.get('autoMeta', true) === false) return;
  const last = store.get('metaDailyAt', 0);
  if (Date.now() - last < 20 * 3600 * 1000) return;
  store.set('metaDailyAt', Date.now());
  await metaSync(150, true);
}

/* ================================================================ favoris & récents */
const favs = () => store.get('favs', []);
const recents = () => store.get('recents', []);
const isFav = (p) => favs().some((f) => f.id.toLowerCase() === riotIdOf(p).toLowerCase());
function toggleFav(p) {
  const id = riotIdOf(p);
  let list = favs();
  if (isFav(p)) list = list.filter((f) => f.id.toLowerCase() !== id.toLowerCase());
  else list.push({ id, platform: p.platform, icon: p.icon });
  store.set('favs', list);
  renderFavs();
}
function pushRecent(p) {
  const id = riotIdOf(p);
  const list = [{ id, platform: p.platform, icon: p.icon }, ...recents().filter((r) => r.id.toLowerCase() !== id.toLowerCase())].slice(0, 8);
  store.set('recents', list);
}
function renderFavs() {
  const list = favs();
  $('#favs').innerHTML = list.length ? `<div class="nav-label">Favoris</div>${list.map((f) => `<div class="fav" data-open="${esc(f.id)}" data-plat="${f.platform}"><img src="${iconImg(f.icon || 29)}" alt=""><span>${esc(f.id.split('#')[0])}</span></div>`).join('')}` : '';
}
function renderSuggest() {
  const q = $('#q').value.trim().toLowerCase();
  const fv = favs().filter((f) => !q || f.id.toLowerCase().includes(q));
  const rc = recents().filter((f) => (!q || f.id.toLowerCase().includes(q)) && !fv.some((x) => x.id === f.id));
  const item = (f) => `<div class="it" data-open="${esc(f.id)}" data-plat="${f.platform}"><img src="${iconImg(f.icon || 29)}" alt=""><span>${esc(f.id.split('#')[0])}<span class="dim">#${esc(f.id.split('#')[1] || '')}</span></span><span class="reg">${regionLabel(f.platform)}</span></div>`;
  const html = (fv.length ? `<div class="h">Favoris</div>${fv.map(item).join('')}` : '') + (rc.length ? `<div class="h">Récents</div>${rc.map(item).join('')}` : '');
  $('#suggest').innerHTML = html;
  $('#suggest').classList.toggle('on', !!html && document.activeElement === $('#q'));
}

/* ================================================================ actions */
function parseRiotId(str) {
  const i = str.lastIndexOf('#');
  if (i <= 0 || i === str.length - 1) return null;
  return [str.slice(0, i).trim(), str.slice(i + 1).trim()];
}

function mergeMatches(a, b) {
  const map = new Map();
  for (const m of [...a, ...b]) map.set(m.id, m);
  return [...map.values()].sort((x, y) => y.creation - x.creation);
}

let loadSeq = 0;
async function loadProfile(name, tag, platform, champAfter = null) {
  const seq = ++loadSeq;
  Object.assign(S, { loading: true, profile: null, matches: [], openMatch: null, all: null, lpHist: null, mastery: null, live: undefined, champDetail: champAfter, histChamp: '', premades: {}, premadeLeft: 0 });
  if (S.view === 'settings') S.view = 'overview';
  render();
  try {
    const p = await call('lookup', { gameName: name, tagLine: tag, platform });
    if (seq !== loadSeq) return;
    S.profile = p;
    pushRecent(p);
    if (isFav(p)) { store.set('favs', favs().map((f) => (f.id.toLowerCase() === riotIdOf(p).toLowerCase() ? { ...f, icon: p.icon } : f))); renderFavs(); }
    S.matches = await call('cached_matches', { puuid: p.puuid, limit: 20 });
    S.loading = false;
    S.moreLoading = true;
    render();
    enterView();
    checkLive();
    const fresh = await call('fetch_matches', { puuid: p.puuid, platform: p.platform, start: 0, count: 20 });
    if (seq !== loadSeq) return;
    S.matches = mergeMatches(S.matches.filter((m) => fresh.every((f) => f.id !== m.id)), fresh);
    S.all = null;
  } catch (e) {
    if (seq === loadSeq) toast(e, true);
  } finally {
    if (seq === loadSeq) { S.loading = false; S.moreLoading = false; render(); enterView(); syncPremades(S.matches); }
  }
}

function loadMain() {
  const id = parseRiotId(S.settings.main_riot_id || '');
  if (id) loadProfile(id[0], id[1], S.settings.platform);
}

async function loadMore() {
  const p = S.profile;
  S.moreLoading = true; render();
  try {
    const start = mineOf(S.matches).length;
    const more = await call('fetch_matches', { puuid: p.puuid, platform: p.platform, start, count: 20 });
    if (p === S.profile) { S.matches = mergeMatches(S.matches, more); S.all = null; syncPremades(S.matches); }
    if (!more.length) toast('Plus aucune partie à charger.');
  } catch (e) { toast(e, true); }
  S.moreLoading = false; render();
}

async function loadAll() {
  if (!S.profile || S.allLoading) return;
  const p = S.profile;
  S.allLoading = true;
  try {
    const all = await call('cached_matches', { puuid: p.puuid, limit: 1500 });
    if (p === S.profile) { S.all = mergeMatches(all, S.matches); }
  } catch (e) { toast(e, true); S.all = S.matches; }
  S.allLoading = false;
  if (['analysis', 'champions'].includes(S.view) || S.champDetail != null) render();
}

async function sync100() {
  const p = S.profile;
  const key = 'synced:' + p.puuid;
  const start = store.get(key, 0);
  S.sync = { done: 0, total: 100 }; render();
  try {
    const got = await call('fetch_matches', { puuid: p.puuid, platform: p.platform, start, count: 100 });
    store.set(key, start + got.length);
    toast(got.length ? `${got.length} parties importées.` : 'Toutes tes parties disponibles sont déjà importées.');
  } catch (e) { toast(e, true); }
  S.sync = null;
  S.all = null; render(); loadAll();
}

async function loadLP() {
  if (!S.profile) return;
  const p = S.profile;
  const h = await call('lp_history', { puuid: p.puuid }).catch(() => []);
  if (p === S.profile) { S.lpHist = h; if (S.view === 'lp') render(); }
}

async function loadMastery() {
  if (!S.profile) return;
  const p = S.profile;
  S.masteryLoading = true; if (S.view === 'mastery') render();
  try { const m = await call('masteries', { puuid: p.puuid, platform: p.platform }); if (p === S.profile) S.mastery = m; }
  catch (e) { toast(e, true); if (p === S.profile) S.mastery = { score: 0, list: [] }; }
  S.masteryLoading = false; if (S.view === 'mastery' || S.champDetail != null) render();
}

async function checkLive(force) {
  if (!S.profile || (S.liveLoading && !force)) return;
  const p = S.profile;
  S.liveLoading = true; if (S.view === 'live') render();
  try { const g = await call('live_game', { puuid: p.puuid, platform: p.platform }); if (p === S.profile) { const prev = S.live; S.live = g || null; if (g && prev && prev.start === g.start && prev.groups) { g.groups = prev.groups; } else if (g) detectLiveGroups(); } }
  catch (e) { if (p === S.profile) S.live = null; if (force) toast(e, true); }
  S.liveLoading = false;
  if (p === S.profile) render();
}

function enterView() {
  if (S.view === 'builds' && (!S.meta.status || !S.meta.overview)) loadMeta();
  if (!S.profile) return;
  if (['analysis', 'champions'].includes(S.view) && !S.all) loadAll();
  if (S.view === 'lp') loadLP();
  if (S.view === 'mastery' && !S.mastery) loadMastery();
  if (S.view === 'live' && S.live === undefined) checkLive();
}

function go(view) {
  S.view = view;
  S.champDetail = null;
  render();
  enterView();
  $('#view').scrollTop = 0;
}

function openChamp(id) {
  S.champDetail = id;
  if (!S.all) loadAll();
  if (!S.mastery && S.profile) loadMastery();
  render();
}

function gotoMatch(id) {
  S.champDetail = null;
  S.view = 'history';
  S.histQueue = null; S.histChamp = '';
  S.openMatch = id;
  if (!S.matches.some((m) => m.id === id) && S.all) { const m = S.all.find((x) => x.id === id); if (m) S.matches = mergeMatches(S.matches, [m]); }
  render();
  requestAnimationFrame(() => document.getElementById('m-' + id)?.scrollIntoView({ block: 'start' }));
}

function openPlayer(riotId, platform) {
  const id = parseRiotId(riotId);
  if (!id) return;
  $('#q').value = riotId;
  $('#suggest').classList.remove('on');
  loadProfile(id[0], id[1], platform || S.profile?.platform || S.settings.platform);
}

/* ================================================================ suivi en arrière-plan */
async function trackMain() {
  const p = S.profile;
  if (!p || !isMain(p)) return;
  try {
    const ranks = await call('refresh_ranks', { puuid: p.puuid, platform: p.platform });
    if (p === S.profile) {
      p.ranks = ranks;
      if (S.view === 'lp') loadLP();
      else if (S.view === 'overview') render();
    }
  } catch {}
}

/* ================================================================ événements */
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});

$('#navBack').addEventListener('click', () => navGo(-1));
$('#navFwd').addEventListener('click', () => navGo(1));
// boutons « précédent / suivant » de la souris
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) { e.preventDefault(); navGo(-1); }
  if (e.button === 4) { e.preventDefault(); navGo(1); }
});
window.addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });

$('#favs').addEventListener('click', (e) => {
  const f = e.target.closest('[data-open]');
  if (f) openPlayer(f.dataset.open, f.dataset.plat);
});

$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parseRiotId($('#q').value);
  if (!id) return toast('Format attendu : Nom#TAG (ex. : Faker#KR1)', true);
  $('#suggest').classList.remove('on');
  $('#q').blur();
  loadProfile(id[0], id[1], $('#region').value);
});
$('#q').addEventListener('focus', renderSuggest);
$('#q').addEventListener('input', renderSuggest);
$('#q').addEventListener('blur', () => setTimeout(() => $('#suggest').classList.remove('on'), 150));
$('#suggest').addEventListener('mousedown', (e) => {
  const it = e.target.closest('[data-open]');
  if (it) { e.preventDefault(); $('#region').value = it.dataset.plat; openPlayer(it.dataset.open, it.dataset.plat); $('#q').blur(); }
});

$('#homeBtn').addEventListener('click', () => {
  if (!S.settings?.main_riot_id) return go('settings');
  if (isMain(S.profile)) return go('overview');
  S.view = 'overview';
  loadMain();
});

$('#view').addEventListener('click', async (e) => {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'close-drawer' && (!t.closest('[data-stop]') || t.closest('.close'))) { S.champDetail = null; return render(); }

  const goBtn = t.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const riot = t.closest('[data-riot]');
  if (riot && riot.dataset.riot.includes('#')) { S.champDetail = null; return openPlayer(riot.dataset.riot); }

  const gm = t.closest('[data-goto-match]');
  if (gm) return gotoMatch(gm.dataset.gotoMatch);

  const cm = t.closest('[data-coach-match]');
  if (cm) { S.detailTab = 'coach'; return gotoMatch(cm.dataset.coachMatch); }
  const cmpc = t.closest('[data-cmp]');
  if (cmpc) { S.cmp.q = cmpc.dataset.cmp; return loadCompare(cmpc.dataset.cmp, cmpc.dataset.plat); }
  if (act === 'cmp-reset') { S.cmp.b = null; S.cmp.bm = null; return render(); }
  if (act === 'compare') { return go('compare'); }
  const cmpm = t.closest('[data-cmp-match]');
  if (cmpm) { const m = (S.cmp.bm || []).find((x) => x.id === cmpm.dataset.cmpMatch); if (m) S.matches = mergeMatches(S.matches, [m]); return gotoMatch(cmpm.dataset.cmpMatch); }
  const msync = t.closest('[data-msync]');
  if (msync) return metaSync(+msync.dataset.msync);
  if (act === 'meta-cancel') { S.meta.cancelled = true; store.set('metaJob', null); call('meta_cancel'); toast('Arrêt de l\'import après la partie en cours…'); return; }
  if (act === 'meta-back') { S.meta.champ = null; S.meta.rows = null; return render(); }
  if (act === 'meta-build') { const id = S.champDetail; S.champDetail = null; S.view = 'builds'; if (!S.meta.status) loadMeta(); loadMetaChamp(id); return; }
  const bch = t.closest('[data-bchamp]');
  if (bch) { S.meta.bpos = bch.dataset.bchamppos || null; S.meta.tab = 'build'; return loadMetaChamp(+bch.dataset.bchamp); }
  const bpos = t.closest('[data-bpos]');
  if (bpos) { S.meta.pos = bpos.dataset.bpos || null; return render(); }
  const btab = t.closest('[data-btab]');
  if (btab) { S.meta.tab = btab.dataset.btab; return render(); }
  const mumin = t.closest('[data-mumin]');
  if (mumin) { S.meta.muMin = +mumin.dataset.mumin; return render(); }
  const musort = t.closest('[data-musort]');
  if (musort) { S.meta.muSort = musort.dataset.musort; return render(); }
  const bpos2 = t.closest('[data-bpos2]');
  if (bpos2) { S.meta.bpos = bpos2.dataset.bpos2; return render(); }
  const bpatch = t.closest('[data-bpatch]');
  if (bpatch) { S.meta.patch = bpatch.dataset.bpatch; S.meta.overview = null; S.meta.roleRows = {}; return loadMeta(); }

  const pmb = t.closest('[data-premade]');
  if (pmb) { const m = S.matches.find((x) => x.id === pmb.dataset.premade); if (m) detectMatchGroups(m); return; }

  const dt = t.closest('[data-dtab]');
  if (dt) { S.detailTab = dt.dataset.dtab; return render(); }

  const ch = t.closest('[data-champ]');
  if (ch && !t.closest('[data-match]')) return openChamp(+ch.dataset.champ);

  const uf = t.closest('[data-unfav]');
  if (uf) { store.set('favs', favs().filter((f) => f.id !== uf.dataset.unfav)); renderFavs(); return render(); }

  if (act === 'refresh') { const p = S.profile; return loadProfile(p.game_name, p.tag_line, p.platform); }
  if (act === 'more') return loadMore();
  if (act === 'sync100') return sync100();
  if (act === 'mastery') return loadMastery();
  if (act === 'live') return checkLive(true);
  if (act === 'fav') { toggleFav(S.profile); toast(isFav(S.profile) ? 'Ajouté aux favoris.' : 'Retiré des favoris.'); return render(); }
  if (act === 'clear-recents') { store.set('recents', []); return render(); }
  if (act === 'set-main') {
    const p = S.profile;
    const next = { ...S.settings, main_riot_id: riotIdOf(p), platform: p.platform };
    try { await call('save_settings', { settings: next }); S.settings = next; toast('Compte principal enregistré : ses LP seront suivis.'); render(); }
    catch (err) { toast(err, true); }
    return;
  }

  if (t.closest('.match-detail')) return;
  const match = t.closest('[data-match]');
  if (match) { S.openMatch = S.openMatch === match.dataset.match ? null : match.dataset.match; return render(); }

  const th = t.closest('th[data-sort]');
  if (th) { S.champSort = th.dataset.sort; return render(); }

  const cq = t.closest('[data-cq]');
  if (cq) { S.champQueue = cq.dataset.cq ? +cq.dataset.cq : null; return render(); }
  const hq = t.closest('[data-hq]');
  if (hq) { S.histQueue = hq.dataset.hq ? +hq.dataset.hq : null; return render(); }
  const aq = t.closest('[data-aq]');
  if (aq) { S.anQueue = aq.dataset.aq ? +aq.dataset.aq : null; return render(); }
  const mc = t.closest('[data-mc]');
  if (mc) { S.masteryClass = mc.dataset.mc || null; return render(); }

  const lq = t.closest('[data-lq]');
  if (lq) { S.lpQueue = lq.dataset.lq; return render(); }

});

$('#view').addEventListener('submit', (e) => {
  if (e.target.id === 'cmpForm') {
    e.preventDefault();
    S.cmp.q = $('#cmpQ').value.trim();
    loadCompare(S.cmp.q, $('#cmpReg').value);
  }
});

$('#view').addEventListener('input', (e) => {
  if (e.target.id === 'metaQ') {
    S.meta.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const i = $('#metaQ'); i.focus(); i.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'mastQ') {
    S.masteryQ = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const i = $('#mastQ'); i.focus(); i.setSelectionRange(pos, pos);
  }
});
$('#view').addEventListener('change', (e) => {
  if (e.target.id === 'mastSort') { S.masterySort = e.target.value; render(); }
  if (e.target.id === 'histChamp') { S.histChamp = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.champDetail != null) { S.champDetail = null; render(); }
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navGo(-1); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navGo(1); }
  if (e.key === 'BrowserBack') { e.preventDefault(); navGo(-1); }
  if (e.key === 'BrowserForward') { e.preventDefault(); navGo(1); }
});

// infobulles
const tip = $('#tip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el || !el.dataset.tip) { tip.classList.remove('on'); return; }
  tip.textContent = el.dataset.tip;
  tip.classList.add('on');
});
document.addEventListener('mousemove', (e) => {
  if (!tip.classList.contains('on')) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > innerWidth - 8) x = e.clientX - w - 10;
  if (y + h > innerHeight - 8) y = e.clientY - h - 10;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

listen('meta', (ev) => {
  if (S.meta.sync && !ev.payload.finished) {
    S.meta.sync = { ...S.meta.sync, ...ev.payload };
    if (S.view === 'builds' && S.meta.champ == null) {
      if (S.meta.sync.done && S.meta.sync.done % 50 === 0 && !S.meta.ovLoading) {
        S.meta.ovLoading = true;
        call('meta_overview', { patch: metaPatch() }).then((ov) => { S.meta.overview = ov; }).finally(() => { S.meta.ovLoading = false; });
        call('meta_status').then((st) => { S.meta.status = st; });
      }
      render();
    } else { const ms = $('#metaStatus'); if (ms) { ms.classList.add('on'); ms.querySelector('.txt').textContent = `Builds : import ${S.meta.sync.done}/${S.meta.sync.total}`; } }
  }
});

listen('sync', (ev) => {
  if (S.sync) { S.sync = ev.payload; if (['champions', 'analysis'].includes(S.view)) render(); }
});

/* ================================================================ démarrage */
(async function start() {
  $('#region').innerHTML = REGIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  try { S.settings = await call('get_settings'); } catch (e) { S.settings = {}; toast(e, true); }
  $('#region').value = S.settings.platform || 'euw1';
  renderFavs();

  call('static_data').then((d) => {
    S.dd = { ...d, byKey: Object.fromEntries(d.champs.map((c) => [+c.key, c])) };
    render();
    setTimeout(autoMeta, 20000);
  }).catch(() => {});

  setInterval(trackMain, 10 * 60 * 1000);
  setInterval(() => { if (isMain(S.profile)) checkLive(); }, 3 * 60 * 1000);

  if (!S.settings.api_key) {
    S.view = 'settings';
    render();
    toast('Bienvenue sur ShiganshinaGG ! Colle ta clé API Riot pour commencer.');
    return;
  }
  render();
  if (S.settings.main_riot_id) loadMain();
})();
