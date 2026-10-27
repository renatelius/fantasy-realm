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
    if (r.settings && r.settings.autoPlay == null) r.settings.autoPlay = false;
    if (r.life && r.life.focusId === undefined) r.life.focusId = "family";
    if (r.life && r.life.phase == null) r.life.phase = "play";
    if (r.life && r.life.physiqueId == null) r.life.physiqueId = "plain";
    if (r.life?.children) r.life.children.forEach(c => { if (!c.task) c.task = "home"; });
    return r;
  } catch (e) { return newState(); }
}

function migrate(s) {
  if (s.version < 3) return newState();
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
