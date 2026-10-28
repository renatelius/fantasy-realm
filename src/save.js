import { newState, SAVE_VERSION, emptySlots } from "./state.js";
const KEY = "fantasy-realm-save";
const SPEED_ALIAS = { fast: "x2", sprint: "x8" };

export function save(state) {
  if (!tabLock()) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn("save failed", e); }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newState();
    const s = JSON.parse(raw);
    const r = s.version === SAVE_VERSION ? s : migrate(s);
    r.lastReal = null;
    if (r.settings?.speed && SPEED_ALIAS[r.settings.speed]) r.settings.speed = SPEED_ALIAS[r.settings.speed];
    r.techniqueSlots = { ...emptySlots(), ...(r.techniqueSlots || { neigong: r.techniqueId }) };
    if (r.life && r.life.jobId === undefined) r.life.jobId = null;
    if (!r.familyTechs) r.familyTechs = [];
    if (!r.paths) r.paths = {};
    if (r.settings && r.settings.autoPlay == null) r.settings.autoPlay = false;
    if (r.life && r.life.focusId === undefined) r.life.focusId = "family";
    if (r.life && r.life.phase == null) r.life.phase = "play";
    if (r.life && r.life.physiqueId == null) r.life.physiqueId = "plain";
    if (r.life?.children) r.life.children.forEach(c => { if (!c.task) c.task = "home"; });
    return r;
  } catch (e) {
    // Сейв не читается — не затираем молча: копия уходит под отдельный ключ, интерфейс скажет об этом в летописи.
    try { const raw = localStorage.getItem(KEY); if (raw) localStorage.setItem(KEY + "-broken", raw); } catch (_) {}
    console.warn("load failed, raw save kept in", KEY + "-broken", e);
    const r = newState(); r.brokenSave = true; return r;
  }
}

// v9: в каждый путь вставлены две промежуточные ступени (после 1-й и 2-й). Старые номера ступеней 0..4 → 0, 2, 4, 5, 6.
// Ярус (tier) старой ступени равен её старому номеру — его запоминаем в записях рода (наследство, достаток наследника).
const REALM_V9 = [0, 2, 4, 5, 6];
const remapRealm = i => REALM_V9[Math.max(0, Math.min(REALM_V9.length - 1, i | 0))];
function remapPerson(c) {
  if (!c) return;
  if (c.realmIndex != null) c.realmIndex = remapRealm(c.realmIndex);
  (c.kids || []).forEach(remapPerson);
}
function migrateRealms(r) {
  r.realmIndex = remapRealm(r.realmIndex || 0);
  for (const p of Object.values(r.paths || {})) if (p) p.realmIndex = remapRealm(p.realmIndex || 0);
  (r.life?.children || []).forEach(remapPerson);
  for (const e of r.lineage || []) {
    if (e.realmIndex != null) { if (e.tier == null) e.tier = e.realmIndex; e.realmIndex = remapRealm(e.realmIndex); }
    (e.children || []).forEach(remapPerson);
  }
}
// v10: живая семья, род и секта с рангами. Здесь — только каркас; домочадцев, род и ранг секты по данным
// достраивает life.js → ensureKin после загрузки (main.js): ему нужны data/*.json.
function migrateKin(r) {
  r.clans ??= {};
  const L = r.life; if (!L) return;
  if (L.household) {
    for (const k of ["mother", "father"]) if (L.household[k] && L.household[k].alive == null) L.household[k].alive = true;
    for (const x of L.household.siblings || []) { if (x.alive == null) x.alive = true; if (x.born == null) x.born = -(x.age ?? 0); }
  }
  if (L.sect && L.sect.rank == null) L.sect.legacyV9 = true; // ранг — по ярусу, см. sect.js → ensureSect
}
function migrate(s) {
  if (s.version < 3) return newState();
  if (s.version < 9) migrateRealms(s);
  if (s.version < 10) migrateKin(s);
  const r = { ...newState(), ...s, version: SAVE_VERSION };
  if (r.settings?.speed && SPEED_ALIAS[r.settings.speed]) r.settings.speed = SPEED_ALIAS[r.settings.speed];
  return r;
}

// Одна вкладка — одна жизнь. Иначе две вкладки по очереди сохраняют своё и затирают друг друга.
// Вкладка-владелец раз в 2 с пишет «пульс»; чужой пульс моложе 6 с — значит игра открыта где-то ещё.
const LOCK = "fantasy-realm-tab";
// id вкладки живёт в sessionStorage: переживает перезагрузку той же вкладки, но у новой вкладки — свой.
const TAB = (() => { try { let t = sessionStorage.getItem(LOCK); if (!t) { t = Math.random().toString(36).slice(2); sessionStorage.setItem(LOCK, t); } return t; } catch (e) { return Math.random().toString(36).slice(2); } })();
// Закрыли вкладку — отпускаем замок сразу, не ждём 6 с.
try { addEventListener("pagehide", () => { try { const cur = JSON.parse(localStorage.getItem(LOCK) || "null"); if (cur?.id === TAB) localStorage.removeItem(LOCK); } catch (e) {} }); } catch (e) {}
export function tabLock(take = false) {
  try {
    const now = Date.now(), cur = JSON.parse(localStorage.getItem(LOCK) || "null");
    if (!take && cur && cur.id !== TAB && now - cur.t < 6000) return false;
    localStorage.setItem(LOCK, JSON.stringify({ id: TAB, t: now }));
    return true;
  } catch (e) { return true; }
}
export function reset() { localStorage.removeItem(KEY); return newState(); }
