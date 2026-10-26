import { newState, SAVE_VERSION, emptySlots } from "./state.js";
const KEY = "fantasy-realm-save";
const SPEED_ALIAS = { fast: "x2", sprint: "x8" };

export function save(state) {
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

export function reset() { localStorage.removeItem(KEY); return newState(); }
