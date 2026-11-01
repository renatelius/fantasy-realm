// Имя в цзянху: слава, прозвище, обиды и долги (恩怨). Данные — data/jianghu.json.
//   Слава (L.jh.fame, 0–100): победы в приключениях, новые ступени, события (effects.fame); тает каждый год.
//   Сторона — карма (stats.karma): праведная / серая / дурная слава.
//   Прозвище — с fame.nickAt: прилагательное по стороне + существительное по пути или оружию + край. Переходит в эпитафию.
//   Обиды и долги (L.jh.ties): grudge — кровник, debt — тебе должны, owe — ты должен.
//     Возникают в карточках (effects.grudge / debt / owe = true или текст «кто»), в приключениях (killGrudgeChance).
//     Закрываются карточками (effects.tieClose), долг можно превратить в обиду (effects.tieTurn = "owe").
//     Карточки с requires.tie приходят не раньше чем через minGap лет после завязки. Наследнику переходят с шансом inherit.
import * as G from "./game.js";
import { logLine, gtext } from "./life.js";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const C = data => data.jianghu || null;
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
let uid = 0;
const v = (t, m, f) => (t?.g === "f" ? f : m); // глагол по полу того, с кем связь (gtext правит только форму игрока)

export function st(s) {
  const L = s.life;
  L.jh ??= { fame: 0, nick: null, ties: [], lastWins: 0, tier: 0 };
  L.jh.ties ??= [];
  return L.jh;
}
export const fame = s => s.life?.jh?.fame || 0;
export const nick = s => s.life?.jh?.nick || null;
export function side(data, s) {
  const k = s.life?.stats?.karma || 0, F = C(data)?.fame || {};
  return k >= (F.goodAt ?? 5) ? "good" : k <= (F.badAt ?? -5) ? "bad" : "mid";
}
export const sideName = (data, s) => ({ good: "праведная", bad: "дурная", mid: "ни добрая, ни дурная" })[side(data, s)];
export function fameWord(f) { return f >= 80 ? "легенда цзянху" : f >= 55 ? "знаменит(а) по всей Янь" : f >= 30 ? "знают в соседних краях" : f >= 12 ? "знают в своём краю" : f > 2 ? "о тебе слышали на рынке" : "безвестен(на)"; }

// ───────── слава ─────────
export function addFame(data, s, v) {
  const j = st(s), before = j.fame;
  j.fame = clamp(j.fame + v, 0, 100);
  checkNick(data, s);
  return j.fame - before;
}
function makeNick(data, s, rng) {
  const N = C(data).nick, L = s.life, reg = data.world.regions.find(r => r.id === L.regionId);
  const adj = pick(N.adj[side(data, s)], rng);
  const noun = L.gear?.weapon && rng() < 0.4 ? pick(N.noun.weapon, rng) : L.awakened ? pick(N.noun[s.pathId || "qi"] || N.noun.qi, rng) : pick(N.noun.mortal, rng);
  return `${adj} ${noun} из ${reg?.short || reg?.name || "Янь"}`;
}
function checkNick(data, s, rng = Math.random) {
  const j = st(s), F = C(data).fame;
  if (j.nick || j.fame < F.nickAt) return;
  j.nick = makeNick(data, s, rng);
  logLine(s, `В цзянху тебя прозвали «${j.nick}». Имя пошло впереди тебя.`, "luck");
}

// ───────── обиды и долги ─────────
const KIND = { grudge: "кровник", debt: "должен тебе", owe: "ты должен" };
export const kindName = k => KIND[k] || k;
export function addTie(data, s, kind, who, rng = Math.random) {
  const T = C(data).ties, j = st(s), W = data.world;
  const w = typeof who === "string" ? who : pick(T.who[kind], rng);
  const g = /^(вдова|дочь|сестра|мать|травница|монахиня)/.test(w) ? "f" : "m"; // пол — по тому, кто это
  const t = { id: ++uid + "-" + s.life.age, kind, g, name: `${pick(W.names.surnames, rng)} ${pick(W.names[g], rng)}`, who: w, since: s.life.age, inherited: false };
  j.ties.push(t);
  while (j.ties.length > T.max) j.ties.shift();
  const m = { grudge: `Теперь у тебя есть кровник: ${t.name}, ${t.who}. Такие не забывают.`, debt: `${t.name}, ${t.who}, ${v(t, "поклялся", "поклялась")} вернуть долг жизни.`, owe: `Ты в долгу у ${t.name} (${t.who}). Рано или поздно попросят вернуть.` }[kind];
  logLine(s, m, kind === "grudge" ? "death" : "family");
  return t;
}
// Старшая (самая давняя) связь нужного рода, созревшая для карточки.
export function oldestTie(data, s, kind, ripe = true) {
  const T = C(data)?.ties, j = s.life?.jh; if (!j) return null;
  return j.ties.filter(t => t.kind === kind && (!ripe || t.inherited || s.life.age - t.since >= (T?.minGap ?? 4))).sort((a, b) => a.since - b.since)[0] || null;
}
function closeTie(data, s, kind) {
  const j = st(s), t = oldestTie(data, s, kind, false); if (!t) return null;
  j.ties = j.ties.filter(x => x !== t); return t;
}

// ───────── год (life.js → yearPass) ─────────
export function yearJh(data, s, rng = Math.random) {
  if (!C(data) || !s.life?.alive) return;
  const L = s.life, j = st(s), F = C(data).fame, T = C(data).ties;
  j.fame *= F.decay;
  const dw = Math.max(0, (s.wins || 0) - (j.lastWins || 0)); j.lastWins = s.wins || 0;
  if (dw) {
    addFame(data, s, Math.min(F.winFameYearCap, dw * F.winFame));
    if (rng() < T.killGrudgeChance) addTie(data, s, "grudge", null, rng);
  }
  if (L.awakened) { const t = G.maxTier(data, s); if (t > (j.tier || 0)) { addFame(data, s, F.tierFame * t); j.tier = t; } }
  if (j.fame > 0 && rng() < j.fame / F.connPer) L.stats.connections = clamp(L.stats.connections + 1, 0, 30);
  checkNick(data, s, rng);
}

// ───────── карточки ─────────
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  if (!C(data) || !s.life) return;
  if (ef.fame) addFame(data, s, ef.fame);
  for (const k of ["grudge", "debt", "owe"]) if (ef[k]) addTie(data, s, k, ef[k], rng);
  if (ef.tieClose) { const t = closeTie(data, s, ef.tieClose); if (t) logLine(s, { grudge: `Между тобой и ${t.name} больше нет крови.`, debt: `${t.name} ${v(t, "вернул", "вернула")} долг сполна. Вы квиты.`, owe: `Долг перед ${t.name} возвращён. Можно спать спокойно.` }[t.kind], "family"); }
  if (ef.tieTurn) { const t = oldestTie(data, s, ef.tieTurn, false); if (t) { t.kind = "grudge"; t.since = s.life.age; logLine(s, `${t.name} не простит отказа. Был долг — стала обида.`, "death"); } }
}
export function matches(data, s, r = {}) {
  const L = s.life;
  if (r.tie && !oldestTie(data, s, r.tie)) return false;
  if (r.noTie && (L.jh?.ties || []).some(t => t.kind === r.noTie)) return false;
  if (r.minFame != null && fame(s) < r.minFame) return false;
  if (r.maxFame != null && fame(s) > r.maxFame) return false;
  if (r.hasNick && !nick(s)) return false;
  if (r.minKarma != null && (L.stats?.karma || 0) < r.minKarma) return false;
  if (r.maxKarma != null && (L.stats?.karma || 0) > r.maxKarma) return false;
  if (r.maxStones != null && s.spiritStones > r.maxStones) return false;
  return true;
}
export function scoreFx(ef = {}) {
  return (ef.fame || 0) * 0.3 + (ef.grudge ? -6 : 0) + (ef.debt ? 4 : 0) + (ef.owe ? -2 : 0)
    + (ef.tieClose === "grudge" ? 6 : ef.tieClose === "owe" ? 2 : ef.tieClose === "debt" ? -1 : 0) + (ef.tieTurn ? -5 : 0);
}
// Подстановки в тексты карточек (life.js → fmt): {grudge}, {grudgeWho}, {debtor}, {debtorWho}, {creditor}, {creditorWho}, {nick}.
export function vars(data, s) {
  const out = {}, map = { grudge: "grudge", debt: "debtor", owe: "creditor" };
  for (const [k, v] of Object.entries(map)) { const t = oldestTie(data, s, k, false); if (t) { out[v] = t.name; out[v + "Who"] = t.who; } }
  out.nick = nick(s) || "безымянный";
  return out;
}

// ───────── наследие ─────────
export function snapshot(s) { const j = s.life?.jh; return j ? { fame: j.fame, nick: j.nick, ties: j.ties.map(t => ({ ...t })) } : null; }
export function inherit(data, s, prev, isChild, rng = Math.random) {
  if (!C(data) || !s.life || !prev?.jh) return;
  const j = st(s), T = C(data).ties, F = C(data).fame;
  j.fame = isChild ? prev.jh.fame * F.heirShare : prev.jh.fame * F.heirShare * 0.5;
  const got = [];
  for (const t of prev.jh.ties || []) if (rng() < (T.inherit[t.kind] ?? 0)) { j.ties.push({ ...t, inherited: true, since: s.life.age }); got.push(t); }
  const who = prev.jh.nick ? `«${prev.jh.nick}»` : "предка";
  if (prev.jh.nick) logLine(s, `Ты — родня ${who}. Имя открывает двери. И старые счёты.`, "family");
  for (const t of got) logLine(s, { grudge: `Кровь за кровь переходит по наследству: ${t.name} помнит, что сделал(а) ${who}.`, debt: `${t.name} помнит, что ${v(t, "задолжал", "задолжала")} ${who}, — и ${v(t, "готов", "готова")} вернуть тебе.`, owe: `Долг ${who} перед ${t.name} теперь твой.` }[t.kind], t.kind === "grudge" ? "death" : "family");
}
export function epitaphBit(s) { const n = nick(s); return n ? ` В цзянху звали «${n}».` : ""; }
// Слава помогает при найме (craft.js → hireInfo).
export function hireBonus(data, s) { const F = C(data)?.fame; return F ? fame(s) / (F.hirePer || 5) : 0; }
