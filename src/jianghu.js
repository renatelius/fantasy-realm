// Имя в цзянху: слава, прозвище, обиды и долги (恩怨), тёмный путь (邪道), затвор (闭关),
// тайный трактат (秘籍), собрание героев (武林大会), свои ученики (师徒). Данные — data/jianghu.json.
//   Слава (L.jh.fame, 0–100): победы в приключениях, новые ступени, события (effects.fame); тает каждый год.
//   Сторона — карма (stats.karma): праведная / серая / дурная слава.
//   Прозвище — с fame.nickAt: прилагательное по стороне + существительное по пути или оружию + край. Переходит в эпитафию.
//   Обиды и долги (L.jh.ties): grudge — кровник, debt — тебе должны, owe — ты должен.
//     Возникают в карточках (effects.grudge / debt / owe = true или текст «кто»), в приключениях (killGrudgeChance).
//     Закрываются карточками (effects.tieClose), долг можно превратить в обиду (effects.tieTurn = "owe").
//     Карточки с requires.tie приходят не раньше чем через minGap лет после завязки. Наследнику переходят с шансом inherit.
import * as G from "./game.js";
import * as CB from "./combat.js";
import * as CR from "./craft.js";
import * as SE from "./seal.js";
import * as HT from "./heart.js";
import { logLine, gtext, lifespan, die } from "./life.js";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const C = data => data.jianghu || null;
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
let uid = 0;
const v = (t, m, f) => (t?.g === "f" ? f : m); // глагол по полу того, с кем связь (gtext правит только форму игрока)

export function st(s) {
  const L = s.life;
  L.jh ??= { fame: 0, nick: null, ties: [], lastWins: 0, tier: 0 };
  L.jh.ties ??= []; L.jh.pupils ??= [];
  L.flags ??= {};
  return L.jh;
}
export const fame = s => s.life?.jh?.fame || 0;
export const nick = s => s.life?.jh?.nick || null;
export function side(data, s) {
  const k = s.life?.stats?.karma || 0, F = C(data)?.fame || {};
  return k >= (F.goodAt ?? 5) ? "good" : k <= (F.badAt ?? -5) ? "bad" : "mid";
}
export const sideName = (data, s) => ({ good: "праведная", bad: "дурная", mid: "ни добрая, ни дурная" })[side(data, s)];
export function fameWord(f, g = "m") { return f >= 80 ? "легенда цзянху" : f >= 55 ? `${g === "f" ? "знаменита" : "знаменит"} по всей Янь` : f >= 30 ? "знают в соседних краях" : f >= 12 ? "знают в своём краю" : f > 2 ? "о тебе слышали на рынке" : g === "f" ? "безвестна" : "безвестен"; }

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
  const trade = tradeNoun(data, s), wf = workFame(data, s);
  const noun = trade && (!L.awakened ? rng() < 0.8 : wf >= 0.3 && rng() < 0.4) ? trade
    : L.gear?.weapon && rng() < 0.4 ? pick(N.noun.weapon, rng) : L.awakened ? pick(N.noun[s.pathId || "qi"] || N.noun.qi, rng) : pick(N.noun.mortal, rng);
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
  if (dw && L.awakened) drainYear(data, s, dw, rng);
  if (L.awakened) { const t = G.maxTier(data, s); if (t > (j.tier || 0)) { addFame(data, s, F.tierFame * t); j.tier = t; } }
  workYear(data, s);
  retreatYear(data, s, rng);
  wulinYear(data, s, rng);
  pupilsYear(data, s, rng);
  if (j.fame > 0 && rng() < j.fame / F.connPer) L.stats.connections = clamp(L.stats.connections + 1, 0, 30);
  checkNick(data, s, rng);
}

// ───────── карточки ─────────
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  if (!C(data) || !s.life) return;
  if (ef.fame) addFame(data, s, ef.fame);
  for (const k of ["grudge", "debt", "owe"]) if (ef[k]) addTie(data, s, k, ef[k], rng);
  if (ef.tieClose) { const t = closeTie(data, s, ef.tieClose); if (t) logLine(s, { grudge: `Между тобой и ${t.name} больше нет крови.`, debt: `${t.name} ${v(t, "вернул", "вернула")} долг сполна. Вы квиты.`, owe: `Долг перед ${t.name} возвращён. Можно спать спокойно.` }[t.kind], "family"); }
  if (ef.darkTech) giveDark(data, s, rng);
  if (ef.manualTech) giveManual(data, s, rng);
  if (ef.wulin === "fight") wulinFight(data, s, rng);
  if (ef.wulin === "defend") wulinDefend(data, s, rng);
  if (ef.wulin === "end") wulinEnd(data, s, "Ты сам(а) передал(а) место главы молодым. Цзянху поклонился.");
  if (ef.pupil) addPupil(data, s, rng, typeof ef.pupil === "string" ? ef.pupil : null);
  if (ef.pupilLoss) losePupil(data, s, rng);
  if (ef.duel) duel(data, s, ef.duel === true ? {} : ef.duel, rng);
  if (ef.forgetDark) forgetDark(data, s);
  if (ef.retreatEnd && s.life.retreat) endRetreat(data, s, true);
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
  if (r.darkTech && !hasDark(data, s)) return false;
  if (r.noDark && hasDark(data, s)) return false;
  if (r.sectNot && L.sect?.id === r.sectNot) return false;
  if (r.inRetreat && !L.retreat) return false;
  if (r.notRecent && L.flags?.[r.notRecent.flag] != null && L.age - L.flags[r.notRecent.flag] < r.notRecent.years) return false;
  if (r.wulinLeader && !L.jh?.wulin) return false;
  if (r.hasPupil && !(L.jh?.pupils || []).length) return false;
  if (r.pupilLow && !(L.jh?.pupils || []).some(p => p.loyalty < 40)) return false;
  if (r.pupilGrown && !(L.jh?.pupils || []).some(p => p.lvl >= 25)) return false;
  if (r.pupilRoom && (L.jh?.pupils || []).length >= (C(data)?.pupils?.max ?? 3)) return false;
  if (r.retreatYears != null && (!L.retreat || L.age - L.retreat.from < r.retreatYears)) return false;
  return true;
}
export function scoreFx(ef = {}) {
  return (ef.fame || 0) * 0.3 + (ef.grudge ? -6 : 0) + (ef.debt ? 4 : 0) + (ef.owe ? -2 : 0)
    + (ef.darkTech ? -6 : 0) + (ef.manualTech ? 50 : 0) + ([].concat(ef.flag || []).includes("manual") ? 6 : 0) + (ef.wulin === "fight" ? 5 : ef.wulin === "defend" ? 2 : ef.wulin === "end" ? -3 : 0) + (ef.pupil ? 4 : 0) + (ef.pupilLoss ? -4 : 0) + (ef.duel ? 2 - 2 * (ef.duel.lvl ?? 0) + (ef.duel.fame ?? 5) * 0.15 : 0) + (ef.forgetDark ? -2 : 0) + (ef.retreatEnd ? -8 : 0)
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
export function snapshot(s) { const j = s.life?.jh; return j ? { fame: j.fame, nick: j.nick, ties: j.ties.map(t => ({ ...t })), pupils: (j.pupils || []).map(p => ({ ...p })), wulin: !!j.wulin } : null; }
export function inherit(data, s, prev, isChild, rng = Math.random) {
  if (!C(data) || !s.life || !prev?.jh) return;
  const j = st(s), T = C(data).ties, F = C(data).fame;
  j.fame = isChild ? prev.jh.fame * F.heirShare : prev.jh.fame * F.heirShare * 0.5;
  const got = [];
  for (const t of prev.jh.ties || []) if (rng() < (T.inherit[t.kind] ?? 0)) { j.ties.push({ ...t, inherited: true, since: s.life.age }); got.push(t); }
  const who = prev.jh.nick ? `«${prev.jh.nick}»` : "предка";
  // Верные ученики предка помнят учителя — и его дом.
  for (const p of prev.jh.pupils || []) if (p.loyalty >= (C(data).pupils?.heirLoyal ?? 50)) { const t = { id: ++uid + "-p", kind: "debt", g: p.g, name: p.name, who: `ученик ${who}`, since: s.life.age, inherited: true }; j.ties.push(t); got.push(t); }
  if (prev.jh.wulin) addFame(data, s, 5);
  if (prev.jh.nick) logLine(s, `Ты — родня ${who}. Имя открывает двери. И старые счёты.`, "family");
  for (const t of got) logLine(s, { grudge: `Кровь за кровь переходит по наследству: ${t.name} помнит, что сделал(а) ${who}.`, debt: `${t.name} помнит, что ${v(t, "задолжал", "задолжала")} ${who}, — и ${v(t, "готов", "готова")} вернуть тебе.`, owe: `Долг ${who} перед ${t.name} теперь твой.` }[t.kind], t.kind === "grudge" ? "death" : "family");
}
export function epitaphBit(s) { const n = nick(s); return n ? ` В цзянху звали «${n}».` : ""; }
// Слава помогает при найме (craft.js → hireInfo).
export function hireBonus(data, s) { const F = C(data)?.fame; return F ? fame(s) / (F.hirePer || 5) : 0; }

// ───────── тёмный путь (邪道) ─────────
export const isDark = t => !!t?.fx?.dark;
// Тёмный путь — то, чем занимаешься (техника в слоте), а не свиток на полке.
export function hasDark(data, s) { return Object.values(s.techniqueSlots || {}).some(id => id && isDark(G.techById(data, id))); }
// Тёмная техника для своего пути (ведущая — внутренняя работа или закал тела), иначе — боевая.
function giveDark(data, s, rng) {
  const all = data.techniques.techniques.filter(t => t.owner === "dark" && !s.ownedTechniques.includes(t.id) && G.techUsable(data, s, t));
  const lead = all.filter(t => t.path && t.path === (s.pathId || "qi")), pool = lead.length ? lead : all;
  if (!pool.length) { s.spiritStones += 30; logLine(s, "Человек в красном ушёл, оставив кошель: «В следующий раз — свиток».", "cult"); return; }
  const t = pool[Math.floor(rng() * pool.length)];
  s.ownedTechniques.push(t.id);
  if ((t.minRealm || 0) <= G.tierOf(data, s)) G.equipTechnique(data, s, t.id);
  logLine(s, `В руках — тёмный свиток «${t.name}». ${t.text}`, "death");
}
export function forgetDark(data, s) {
  const bad = new Set((s.ownedTechniques || []).filter(id => isDark(G.techById(data, id))));
  if (!bad.size) return;
  s.ownedTechniques = s.ownedTechniques.filter(id => !bad.has(id));
  s.familyTechs = (s.familyTechs || []).filter(id => !bad.has(id));
  const clean = slots => { for (const k of Object.keys(slots || {})) if (bad.has(slots[k])) slots[k] = k === "neigong" ? "breath_of_mist" : null; };
  clean(s.techniqueSlots); for (const r of Object.values(s.paths || {})) clean(r.slots);
  if (bad.has(s.techniqueId)) s.techniqueId = "breath_of_mist";
  if (!s.ownedTechniques.includes("breath_of_mist")) s.ownedTechniques.push("breath_of_mist");
  logLine(s, "Тёмные свитки сгорели в жаровне. Жилы долго ныли, будто у них отняли привычную еду.", "cult");
}
// Ци побеждённых (fx.drain): после побед доля ци до слоя, карма падает.
function drainYear(data, s, wins, rng) {
  const d = G.techFx(data, s).drain || 0, D = C(data).dark || {}; if (!d) return;
  const need = G.qiRequired(data, s), n = Math.min(wins, D.drainWins ?? 4);
  s.qi = Math.min(need, s.qi + d * need * n);
  if (rng() < (D.drainKarma ?? 0.4)) s.life.stats.karma = clamp(s.life.stats.karma - 1, -20, 20);
}

// ───────── затвор (闭关) ─────────
const R = data => C(data)?.retreat || {};
export const inRetreat = s => !!s.life?.retreat;
export function canRetreat(data, s, years) {
  const L = s.life, Rc = R(data);
  if (!C(data)) return { ok: false, why: "нет" };
  if (!L?.alive || !L.awakened) return { ok: false, why: "нужна ци" };
  if (L.retreat) return { ok: false, why: "ты уже в затворе" };
  if (L.pending) return { ok: false, why: "сначала реши дело" };
  if (L.age < (Rc.minAge ?? 20)) return { ok: false, why: `с ${Rc.minAge ?? 20} лет` };
  if (L.age + years >= lifespan(data, s)) return { ok: false, why: "столько тебе не отпущено" };
  return { ok: true };
}
export function startRetreat(data, s, years) {
  const can = canRetreat(data, s, years); if (!can.ok) return { ok: false, msg: `Не выйдет: ${can.why}.` };
  const L = s.life;
  L.retreat = { from: L.age, to: L.age + years, years, prevFocus: L.focusId, lvl: G.maxLevel(data, s), dev: 0 };
  L.focusId = "retreat";
  const m = `Ты ушёл(ла) в затвор на ${years} ${years % 10 === 1 && years !== 11 ? "год" : [2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years) ? "года" : "лет"}. Вход в пещеру заложили камнем.`;
  logLine(s, m, "cult"); return { ok: true, msg: m };
}
export function endRetreat(data, s, early = false) {
  const L = s.life, r = L.retreat; if (!r) return;
  const Rc = R(data);
  if (early) s.qi = Math.floor(s.qi * (1 - (Rc.earlyQiLoss ?? 0.3)));
  L.retreat = null;
  L.focusId = r.prevFocus && r.prevFocus !== "retreat" ? r.prevFocus : "practice";
  const yrs = L.age - r.from, gained = Math.max(0, G.maxLevel(data, s) - r.lvl);
  const since = (L.chronicle || []).filter(x => x.age > r.from);
  const deaths = since.filter(x => x.kind === "death" && /^Умер|^Умерла|^Не стало/.test(x.msg)).length;
  const births = since.filter(x => /^В семье родил/.test(x.msg)).length;
  const world = [deaths ? `ушли ${deaths}` : "", births ? `родились ${births}` : ""].filter(Boolean).join(", ");
  logLine(s, `${early ? "Ты вышел(ла) из затвора раньше срока" : "Ты вышел(ла) из затвора"} через ${yrs} ${yrs % 10 === 1 && yrs !== 11 ? "год" : [2, 3, 4].includes(yrs % 10) && ![12, 13, 14].includes(yrs % 100) ? "года" : "лет"}: ${gained ? `+${gained} ${gained === 1 ? "слой" : gained < 5 ? "слоя" : "слоёв"}` : "без новых слоёв"}${r.dev ? `, срывов ${r.dev}` : ""}${early ? ", часть ци рассеялась" : ""}. Мир не ждал${world ? `: в роду ${world}` : ""}.`, "cult");
}
function retreatYear(data, s, rng) {
  const L = s.life, r = L.retreat; if (!r || !L.alive) return;
  const Rc = R(data);
  if (L.focusId !== "retreat") L.focusId = "retreat";
  // Срыв в затворе: несовместимая техника и тёмные свитки — опаснее.
  const fx = G.techFx(data, s), fit = G.techFit(data, s, G.leadTech(data, s));
  const p = (Rc.devPerYear ?? 0.025) * (1 - (fx.devCut || 0)) * (1 + 0.5 * Math.max(0, -fit.score)) * (fx.dark ? 1.5 : 1) * HT.slipMul(data, s);
  if (rng() < p) {
    r.dev++;
    const heavy = rng() < (Rc.heavyShare ?? 0.25);
    s.qi = Math.floor(s.qi * 0.4);
    if (heavy) { L.ageShift -= 1; logLine(s, "В затворе огонь пошёл не туда: жилы обожгло, срок −1 год. Ученики разобрали камни у входа.", "death"); endRetreat(data, s, true); return; }
    logLine(s, "В затворе ци повернула вспять. Ты удержал(а) её, но месяцы ушли впустую.", "cult");
  }
  s.qi = Math.min(G.qiRequired(data, s), s.qi + (Rc.qiShareYear ?? 0.7) * G.qiRequired(data, s)); // тишина пещеры
  // Прорывы в пещере идут сами; пилюли, взятые с собой, тратятся, когда шанс ниже 60%.
  for (let k = 0; k < (Rc.tries ?? 4) && G.canBreakthrough(data, s) && !G.atPeak(data, s) && L.alive; k++) G.breakthrough(data, s, s.pills > 0 && G.breakthroughChance(data, s) < 0.6, rng);
  if (L.age >= r.to) endRetreat(data, s, false);
}
// Авторежим: изредка уходит в затвор, когда дети подросли и до конца срока далеко.
export function autoRetreat(data, s, rng = Math.random) {
  const L = s.life, Rc = R(data); if (!C(data) || !L?.awakened || L.retreat || L.pending) return;
  const yrs = Rc.autoYears ?? 10;
  if (L.children.some(c => c.alive && L.age - c.born < (Rc.kidsAge ?? 12))) return;
  if (L.age + yrs > 0.85 * lifespan(data, s)) return;
  if (rng() < (Rc.autoChance ?? 0.03)) startRetreat(data, s, yrs);
}

// ───────── тайный трактат (秘籍) ─────────
// Легендарный свиток своего пути (owner "manual"); если такого нет — обычная удача со свитком.
function giveManual(data, s, rng) {
  const pool = data.techniques.techniques.filter(t => t.owner === "manual" && !s.ownedTechniques.includes(t.id) && G.techUsable(data, s, t));
  if (!pool.length) { const t = G.luckyScroll(data, s, rng); logLine(s, t ? `Трактат оказался не тем — но в переплёте нашёлся «${t.name}».` : "В переплёте трактата — пустые листы. Кто-то успел раньше.", "luck"); return; }
  const t = pool[Math.floor(rng() * pool.length)];
  s.ownedTechniques.push(t.id);
  if ((t.minRealm || 0) <= G.tierOf(data, s)) G.equipTechnique(data, s, t.id);
  logLine(s, `В руках — «${t.name}». ${t.text}`, "luck");
}

// ───────── собрание героев (武林大会) ─────────
const WU = data => C(data)?.wulin || {};
export function wulinChance(data, s) {
  const W = WU(data), odds = s.life?.awakened ? CB.adventureOdds(data, s, 8).win : 0;
  return clamp((W.base ?? 0.2) + (W.perTier ?? 0.07) * G.maxTier(data, s) + fame(s) / (W.fameDiv ?? 300) + (odds - 0.5) * (W.oddsK ?? 0.3), W.min ?? 0.08, W.max ?? 0.85);
}
function wulinFight(data, s, rng) {
  const W = WU(data), j = st(s), p = wulinChance(data, s), n = W.rounds ?? 3;
  let won = 0; while (won < n && rng() < p) won++;
  if (won === n) {
    j.wulin = { since: s.life.age, until: s.life.age + (W.termYears ?? 20) };
    addFame(data, s, 15);
    logLine(s, `Собрание героев: ${n} боя — ${n} победы. Тебя избрали главой Союза Улинь на ${W.termYears ?? 20} лет. Шесть сект поклонились — не все искренне.`, "luck");
  } else if (won === n - 1) { addFame(data, s, 6); s.spiritStones += 30; logLine(s, "Собрание героев: ты дошёл(ла) до последнего боя и проиграл(а) его. Имя гремит и так.", "adv"); }
  else if (won >= 1) { addFame(data, s, 2); logLine(s, `Собрание героев: ${won} победа, потом поражение. Хороший урок.`, "adv"); }
  else { if (rng() < 0.3) s.life.ageShift -= 1; logLine(s, "Собрание героев: первый же бой — поражение. На помосте свистели.", "cult"); }
}
function wulinDefend(data, s, rng) {
  const j = st(s); if (!j.wulin) return;
  if (rng() < wulinChance(data, s)) { addFame(data, s, 4); logLine(s, "Вызов главе Союза отбит. Молодой мастер ушёл с поклоном.", "adv"); }
  else { addFame(data, s, -5); wulinEnd(data, s, "Ты проиграл(а) вызов. Печать главы Союза Улинь перешла к победителю."); }
}
function wulinEnd(data, s, msg) { const j = st(s); if (!j.wulin) return; j.wulin = null; logLine(s, msg, "family"); }
function wulinYear(data, s, rng) {
  const j = st(s), W = WU(data); if (!j.wulin) return;
  s.spiritStones += W.stonesYear ?? 15; addFame(data, s, W.famePerYear ?? 1);
  if (rng() < (W.connYear ?? 0.3)) s.life.stats.connections = clamp(s.life.stats.connections + 1, 0, 30);
  if (s.life.age >= j.wulin.until) wulinEnd(data, s, "Срок главы Союза Улинь истёк. Новое собрание выберет другого.");
}
export const wulin = s => s.life?.jh?.wulin || null;

// ───────── свои ученики (师徒) ─────────
const PU = data => C(data)?.pupils || {};
export const pupils = s => s.life?.jh?.pupils || [];
export function canAskPupil(data, s) {
  const P = PU(data), L = s.life;
  if (!C(data) || !L?.alive || !L.awakened) return { ok: false, why: "нужна ци" };
  if (L.retreat) return { ok: false, why: "ты в затворе" };
  if (G.maxTier(data, s) < (P.minTier ?? 1)) return { ok: false, why: `со ${(P.minTier ?? 1) + 1}-й ступени` };
  if (fame(s) < (P.minFame ?? 10)) return { ok: false, why: `нужна слава ${P.minFame ?? 10}` };
  if (pupils(s).length >= (P.max ?? 3)) return { ok: false, why: "учеников и так полный двор" };
  const last = L.flags?.pupilAsk; if (last != null && L.age - last < (P.askGap ?? 5)) return { ok: false, why: `снова — через ${(P.askGap ?? 5) - (L.age - last)} г.` };
  return { ok: true };
}
export function askPupil(data, s, rng = Math.random) {
  const c = canAskPupil(data, s); if (!c.ok) return { ok: false, msg: `Не выйдет: ${c.why}.` };
  st(s); s.life.flags.pupilAsk = s.life.age;
  if (rng() < clamp(fame(s) / (PU(data).askFameDiv ?? 60), 0.15, 0.9)) { addPupil(data, s, rng); return { ok: true }; }
  const m = "Ты повесил(а) у ворот табличку «Беру учеников». Пришли только воробьи."; logLine(s, m, "family"); return { ok: true, msg: m };
}
function addPupil(data, s, rng, who = null) {
  const j = st(s), P = PU(data), W = data.world;
  if (j.pupils.length >= (P.max ?? 3)) return;
  const g = rng() < 0.7 ? "m" : "f", age = 10 + Math.floor(rng() * 8);
  const p = { name: `${pick(W.names.surnames, rng)} ${pick(W.names[g], rng)}`, g, age0: age, since: s.life.age, talent: +(0.6 + rng() * 0.9).toFixed(2),
    lvl: 0, loyalty: clamp(55 + (s.life.stats.karma || 0) * 2, 20, 90), tech: null, who: who || null };
  j.pupils.push(p);
  const tw = p.talent >= 1.3 ? "дар редкий" : p.talent >= 0.95 ? "руки толковые" : "упрямство вместо дара";
  logLine(s, `${p.name}, ${age} лет, ${g === "m" ? "пришёл" : "пришла"} проситься в ученики${who ? ` (${who})` : ""}. Ты ${g === "m" ? "его" : "её"} взял(а): ${tw}.`, "family");
}
export function teachPupil(data, s, i) {
  const p = pupils(s)[i], t = G.leadTech(data, s);
  if (!p) return { ok: false, msg: "Нет такого ученика." };
  if (!t) return { ok: false, msg: "Нечего передать: ведущей техники нет." };
  if (p.tech === t.id) return { ok: false, msg: "Эту технику ты уже передал(а)." };
  p.tech = t.id; p.loyalty = clamp(p.loyalty + 15, 0, 100);
  const m = `Ты передал(а) ${p.name} «${t.name}». ${p.g === "m" ? "Он слушал" : "Она слушала"} так, будто это последняя ночь на земле.`;
  logLine(s, m, "family"); return { ok: true, msg: m };
}
export function freePupil(data, s, i) {
  const j = st(s), p = j.pupils[i]; if (!p) return { ok: false, msg: "Нет такого ученика." };
  j.pupils.splice(i, 1);
  if (p.loyalty >= 50) addTie(data, s, "debt", p.g === "m" ? "ученик, которого ты отпустил(а) с миром" : "ученица, которую ты отпустил(а) с миром");
  else logLine(s, `${p.name} ${p.g === "m" ? "ушёл" : "ушла"}, не оглядываясь.`, "family");
  return { ok: true };
}
function losePupil(data, s, rng) {
  const j = st(s); if (!j.pupils.length) return;
  const i = j.pupils.reduce((b, p, k) => (p.loyalty < j.pupils[b].loyalty ? k : b), 0), p = j.pupils.splice(i, 1)[0];
  addTie(data, s, "grudge", p.g === "m" ? "бывший ученик, ушедший к твоим врагам" : "бывшая ученица, ушедшая к твоим врагам", rng);
  if (p.tech) addFame(data, s, -3);
}
function pupilsYear(data, s, rng) {
  const j = st(s), P = PU(data), L = s.life; if (!j.pupils.length) return;
  const tier = L.awakened ? G.maxTier(data, s) : 0;
  for (const p of [...j.pupils]) {
    if (rng() < (P.deathYear ?? 0.008)) { j.pupils = j.pupils.filter(x => x !== p); logLine(s, `Не стало ${p.g === "m" ? "твоего ученика" : "твоей ученицы"} ${p.name}. Цзянху не щадит молодых.`, "death"); continue; }
    if (!L.retreat) p.lvl = Math.min(100, p.lvl + p.talent * (tier + 1) * (P.growth ?? 1.2) * (p.tech ? (P.techMul ?? 1.5) : 1));
    p.loyalty = clamp(p.loyalty + ((L.stats.karma || 0) >= 0 ? 1 : -2) - (L.retreat ? 2 : 0), 0, 100);
    addFame(data, s, P.teachFame ?? 0.15);
    if (p.loyalty < (P.betrayAt ?? 25) && rng() < (P.betrayChance ?? 0.15)) {
      j.pupils = j.pupils.filter(x => x !== p);
      const t = p.tech && G.techById(data, p.tech);
      addTie(data, s, "grudge", `${p.g === "m" ? "бывший ученик" : "бывшая ученица"}${t ? `, ${p.g === "m" ? "унёсший" : "унёсшая"} «${t.name}»` : ""}`, rng);
      if (t) addFame(data, s, -3);
      continue;
    }
    if (p.lvl >= (P.gradAt ?? 40) && L.age - p.since >= (P.gradYears ?? 10) && rng() < (P.gradChance ?? 0.2)) {
      j.pupils = j.pupils.filter(x => x !== p);
      addFame(data, s, P.gradFame ?? 4);
      if (p.loyalty >= 50) j.ties.push({ id: ++uid + "-g", kind: "debt", g: p.g, name: p.name, who: `${p.g === "m" ? "ученик, ушедший" : "ученица, ушедшая"} в цзянху под своим именем`, since: L.age, inherited: false });
      logLine(s, `${p.name} ${p.g === "m" ? "ушёл" : "ушла"} в цзянху под своим именем. О тебе теперь говорят: «${p.g === "m" ? "его" : "её"} учитель».`, "luck");
    }
  }
}
// Авторежим: берёт учеников, когда есть имя, и передаёт им ведущую технику.
export function autoPupils(data, s, rng = Math.random) {
  if (!C(data) || !s.life?.awakened) return;
  if (pupils(s).length < 2 && canAskPupil(data, s).ok && rng() < 0.15) askPupil(data, s, rng);
  const t = G.leadTech(data, s);
  if (t) pupils(s).forEach((p, i) => { if (p.tech !== t.id) teachPupil(data, s, i); });
}

// ───────── поединок по имени (enemies.json → duel) ─────────
// Соперник — мастер твоего уровня: его сила = твоя × (1 + perLvl × lvl) × разброс (spread). lvl от −2 до +3.
// Так поединок остаётся поединком и в 300 лет: шанс при lvl 0 — около половины, при +2 — заметно хуже.
// opt: { lvl, fame, name, kill (победа убивает: кровник), stones, tieClose ("grudge" — бой с кровником решает дело) }.
function duelFight(data, s, lvl, rng) {
  const D = data.enemies.duel || {}, cfg = data.enemies.player, P = CB.playerStats(data, s);
  const sp = D.spread ?? 0.35, m = (1 + (D.perLvl ?? 0.12) * lvl) * (1 - sp / 2 + sp * rng());
  let ph = P.hp, eh = P.hp * m, r = 0;
  const hit = (atk, def) => Math.max(1, atk * (0.9 + 0.2 * rng()) - def * 0.5);
  while (ph > 0 && eh > 0 && r < (data.enemies.adventure.maxRounds || 40)) {
    r++;
    eh -= hit(P.atk, P.def * m) * (rng() < (P.crit ?? cfg.critChance) ? cfg.critMult : 1);
    if (eh <= 0) break;
    ph -= hit(P.atk * m, P.def) * (rng() < cfg.critChance ? cfg.critMult : 1);
  }
  return { win: eh <= 0, rounds: r };
}
export function duelChance(data, s, lvl = 0, n = 40, rng = Math.random) {
  if (!s.life?.awakened) return 0;
  let w = 0; for (let i = 0; i < n; i++) if (duelFight(data, s, lvl, rng).win) w++; return w / n;
}
function duel(data, s, opt = {}, rng = Math.random) {
  const L = s.life; if (!L?.alive) return;
  const D = data.enemies.duel || {}, name = opt.name || "соперник";
  if (!L.awakened) { addFame(data, s, -1); if (rng() < 0.5) L.ageShift -= 1; logLine(s, "Без ци против мастера — это не бой, а урок. Тебя проучили при всех.", "cult"); return; }
  const r = duelFight(data, s, opt.lvl ?? 0, rng);
  if (r.win) {
    addFame(data, s, opt.fame ?? 5);
    if (opt.stones) s.spiritStones += opt.stones;
    if (opt.tieClose) { const t = closeTie(data, s, opt.tieClose); if (t) logLine(s, `Бой решил давний спор: ${t.name} больше не придёт.`, "family"); }
    if (opt.kill) addTie(data, s, "grudge", typeof opt.kill === "string" ? opt.kill : null, rng);
    if (opt.onWin) SE.applyEffects(data, s, opt.onWin, rng);
    const w = r.rounds % 10 === 1 && r.rounds % 100 !== 11 ? "сход" : [2, 3, 4].includes(r.rounds % 10) && ![12, 13, 14].includes(r.rounds % 100) ? "схода" : "сходов";
    logLine(s, `Поединок: ${name} повержен за ${r.rounds} ${w}. Свидетели разнесут по краю.`, "adv");
    return;
  }
  addFame(data, s, D.famePerLoss ?? -4);
  const body = data.world.physiques?.find(x => x.id === L.physiqueId);
  if (rng() < (D.deathOnLoss ?? 0.02) * Math.pow(1 / (body?.hpMult || 1), 2)) { die(data, s, `Пал(а) в поединке: ${name}`, rng); return; }
  const hurt = rng() < (D.woundChance ?? 0.5); if (hurt) L.ageShift -= 1;
  logLine(s, `Поединок проигран: ${name} оказался сильнее.${opt.tieClose ? " Спор остался открытым." : ""}${hurt ? " Рана отняла год." : ""} Позор заживёт дольше.`, "cult");
}

// ───────── слава от работы (jianghu.json → work) ─────────
// Мастера знают по делу: великий лекарь или купец к старости получает прозвище, даже без ци.
function rankIdx(data, xp) { const R = data.crafts?.ranks || []; let k = 0; R.forEach((r, i) => { if (xp >= r.min) k = i; }); return k; }
export function workFame(data, s) {
  const W = C(data)?.work, L = s.life; if (!W || !L?.alive || !data.jobs || L.age < (data.jobs.workAge || 12) || L.retreat) return 0;
  let v = 0;
  if (L.jobId && L.jobId !== "home") v += (W.rankFame[rankIdx(data, CR.jobXp(s, L.jobId))] || 0) * (W.renown?.[L.jobId] ?? 1);
  for (const k of Object.keys(data.crafts?.skills || {})) { let b = 0; for (const [min, f] of W.skillFame || []) if (CR.skill(s, k) >= min) b = f; v += b; }
  if (L.biz) v += W.bizFame || 0;
  return v;
}
function tradeNoun(data, s) {
  const W = C(data)?.work, L = s.life; if (!W) return null;
  const sk = Object.keys(W.skillNoun || {}).filter(k => CR.skill(s, k) >= 55).sort((a, b) => CR.skill(s, b) - CR.skill(s, a))[0];
  const jobN = L.jobId && CR.jobXp(s, L.jobId) >= 45 ? W.nickNoun?.[L.jobId] : null;
  return jobN || (sk ? W.skillNoun[sk] : null);
}
function workYear(data, s) {
  const W = C(data)?.work, L = s.life; if (!W) return;
  const v = workFame(data, s), room = Math.max(0, (W.cap ?? 35) - st(s).fame); if (v > 0 && room > 0) addFame(data, s, Math.min(v, room));
  if (!L.jobId || L.jobId === "home") return;
  const j = st(s), k = rankIdx(data, CR.jobXp(s, L.jobId)), seen = (j.workRanks ??= {})[L.jobId] ?? 0;
  if (k > seen) {
    j.workRanks[L.jobId] = k;
    const add = (W.rankUp[k] || 0) * Math.max(0.5, W.renown?.[L.jobId] ?? 1);
    if (add) addFame(data, s, Math.min(add, Math.max(0, (W.cap ?? 35) + 5 - st(s).fame)));
    const job = data.jobs.jobs.find(x => x.id === L.jobId)?.name || "Своё дело", big = (W.renown?.[L.jobId] ?? 1) >= 1;
    if (k >= 3) logLine(s, big ? `«${job}»: тебя зовут великим мастером. Люди едут издалека, чтобы посмотреть, как ты работаешь.` : `«${job}»: в округе знают — лучше тебя это дело никто не делает.`, "luck");
    else if (k === 2 && big) logLine(s, `«${job}»: в округе тебя зовут мастером и знают по имени.`, "family");
  }
}
