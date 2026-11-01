// Печать и стёртое Чжао (data/seal.json, канон — content/lore.md, «Печать, осколки, имена»).
// Родовая память: стёртые имена (осколок Человека), осколки Земли и Неба, внимание Восточной канцелярии.
// Память переходит детям. Каждое сохранённое имя приближает осколок — и привлекает людей в сером.
import { logLine, gtext, die } from "./life.js";
import * as JH from "./jianghu.js";

const C = data => data.seal || null;
export function st(s) { return s.life.seal ??= { names: 0, earth: 0, sky: 0, heat: 0, end: null, rootSeen: false }; }
export const manShard = (data, s) => Math.min(100, Math.round(st(s).names * (C(data)?.namePct ?? 10)));
export function shards(data, s) { const x = st(s); return { man: manShard(data, s), earth: Math.min(100, Math.round(x.earth)), sky: Math.min(100, Math.round(x.sky)) }; }
export const heatWord = h => h < 15 ? "тихо" : h < 35 ? "косятся" : h < 60 ? "следят" : "ищут";
export function visible(s) { const x = s.life?.seal; return !!x && (x.names > 0 || x.earth > 0 || x.sky > 0 || x.heat >= 5 || !!x.end); }
export const namesW = n => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? "имя" : a >= 2 && a <= 4 && (b < 12 || b > 14) ? "имени" : "имён"}`; };
const kidAge = (s, c) => s.life.age - c.born;
function rareKid(data, s) {
  const R = C(data)?.kidRoots || [], max = C(data)?.kidMaxAge ?? 15;
  return (s.life.children || []).filter(c => c.alive && !c.sealHidden && !c.sealTallied && R.includes(c.rootId) && kidAge(s, c) <= max)
    .sort((a, b) => R.indexOf(b.rootId) - R.indexOf(a.rootId))[0] || null;
}
export function addHeat(data, s, v) { const x = st(s); x.heat = Math.max(0, Math.min(100, x.heat + v)); }
function addNames(data, s, n) {
  const x = st(s), before = x.names; x.names = Math.max(0, x.names + n);
  if (n > 0) addHeat(data, s, n * (C(data)?.heatPerName ?? 4));
  const d = x.names - before;
  if (d > 0) logLine(s, d === 1 ? "Ещё одно стёртое имя записано в родовую книгу." : `В родовую книгу легло ещё ${namesW(d)} из стёртых.`, "luck");
  else if (d < 0) logLine(s, `Из родовой книги пропало ${namesW(-d)}. Память рода стала короче.`, "cult");
  if (d > 0 && before * (C(data)?.namePct ?? 10) < 100 && manShard(data, s) >= 100) logLine(s, "Осколок Человека собран: род помнит достаточно имён, чтобы печать их услышала.", "luck");
}
function shardAdd(data, s, k, v) {
  const x = st(s), was = x[k]; x[k] = Math.max(0, Math.min(100, x[k] + v));
  const nm = k === "earth" ? "Земли" : "Неба";
  if (x[k] >= 100 && was < 100) logLine(s, `Осколок ${nm} собран. Он тяжелее, чем выглядит.`, "luck");
  else if (v > 0) logLine(s, `Осколок ${nm}: ${Math.round(x[k])}%.`, "luck");
}
function finale(data, s, kind, rng) {
  const x = st(s), L = s.life, cfg = C(data) || {};
  x.end = kind;
  if (kind === "gave") {
    L.legacyBonus += cfg.gaveLegacy ?? 8; JH.addFame(data, s, cfg.gaveFame ?? 30);
    logLine(s, "Ты написал(а) своё имя кровью рядом с именем Первого Писца. Нефритовая пластина стала тёплой. Больше тебя никто не позовёт по имени — даже ты сам(а).", "death");
    die(data, s, "Отдал(а) своё имя Печати. Бездонь уснула ещё на триста лет", rng);
  } else if (kind === "spoke") {
    x.heat = 100; JH.addFame(data, s, cfg.spokeFame ?? 15);
    logLine(s, "Ты сказал(а) имя Чжао на площади, громко, по чертам. Толпа молчала — потом кто-то повторил. Потом ещё. Стереть всех канцелярия не сможет.", "luck");
  } else if (kind === "sold") {
    x.names = 0; x.earth = 0; x.sky = 0; x.heat = 0;
    logLine(s, "Человек в сером принял осколки двумя руками и поклонился. Родовая книга сгорела в его жаровне. Теперь у императора есть поводок — а у тебя есть покой.", "cult");
  }
}
function hideKid(data, s) {
  const c = rareKid(data, s); if (!c) return;
  c.sealHidden = true; addHeat(data, s, -15);
  logLine(s, gtext(`${c.name} ушёл(ла) с монахинями Эмэй. В книге учёта талантов против этого имени теперь пометка: «умер(ла) в детстве».`, c.gender), "family");
}
function giveKid(data, s) {
  const c = rareKid(data, s); if (!c) return;
  c.sealTallied = true; addHeat(data, s, -15);
  logLine(s, gtext(`Писарь вписал ${c.name} в книгу учёта талантов. Двор «помнит своих гениев». Теперь помнит и твоё дитя.`, c.gender), "family");
}
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  if (!s.life) return;
  if (ef.sealName) addNames(data, s, ef.sealName);
  if (ef.sealHeat) addHeat(data, s, ef.sealHeat);
  if (ef.sealEarth) shardAdd(data, s, "earth", ef.sealEarth);
  if (ef.sealSky) shardAdd(data, s, "sky", ef.sealSky);
  if (ef.sealHideKid) hideKid(data, s);
  if (ef.sealGiveKid) giveKid(data, s);
  if (ef.sealEnd && !st(s).end) finale(data, s, ef.sealEnd, rng);
}
export function matches(data, s, r = {}) {
  if (!s.life) return true;
  const x = s.life.seal || { names: 0, earth: 0, sky: 0, heat: 0, end: null };
  if (r.sealNamesMin != null && x.names < r.sealNamesMin) return false;
  if (r.sealHeatMin != null && x.heat < r.sealHeatMin) return false;
  if (r.sealHeatMax != null && x.heat > r.sealHeatMax) return false;
  if (r.sealEarthMin != null && x.earth < r.sealEarthMin) return false;
  if (r.sealEarthMax != null && x.earth >= r.sealEarthMax) return false;
  if (r.sealSkyMin != null && x.sky < r.sealSkyMin) return false;
  if (r.sealSkyMax != null && x.sky >= r.sealSkyMax) return false;
  if (r.sealAll && !(x.names * (C(data)?.namePct ?? 10) >= 100 && x.earth >= 100 && x.sky >= 100)) return false;
  if (r.sealNoEnd && x.end) return false;
  if (r.sealEnd && x.end !== r.sealEnd) return false;
  if (r.sealKidRare && !rareKid(data, s)) return false;
  return true;
}
export function scoreFx(ef = {}) {
  return (ef.sealName || 0) * 6 + (ef.sealEarth || 0) * 0.25 + (ef.sealSky || 0) * 0.25 - (ef.sealHeat || 0) * 0.15
    + (ef.sealHideKid ? 3 : 0) + (ef.sealGiveKid ? -4 : 0) + (ef.sealEnd === "spoke" ? 6 : ef.sealEnd === "sold" ? -100 : 0);
}
// Год: внимание канцелярии тает; Союз нищих приносит имена своим; камень проверки выдаёт редкий корень.
export function yearSeal(data, s, rng = Math.random) {
  const cfg = C(data), L = s.life; if (!cfg || !L?.alive) return;
  const x = st(s);
  x.heat *= cfg.heatDecay ?? 0.93;
  if (L.awakened && !x.rootSeen) {
    x.rootSeen = true;
    if ((cfg.rareRoots || []).includes(L.rootId)) { addHeat(data, s, cfg.rareRootHeat ?? 20); logLine(s, "Камень проверки вспыхнул так, что писарь канцелярии поднял голову. Твой корень вписали в книгу учёта талантов — теперь тебя знают там, где лучше бы не знали.", "cult"); }
  }
  if (!x.end && L.sect?.id === "beggars" && rng() < (cfg.beggarNameChance ?? 0.08)) { logLine(s, "Братья по чаше шепнули имя, которое двор вычеркнул в этом году.", "sect"); addNames(data, s, 1); }
}
// ───────── наследие ─────────
export function snapshot(s) { const x = s.life?.seal; return x ? { ...x } : null; }
export function inherit(data, s, prev, child, isChild) {
  const cfg = C(data); if (!cfg || !s.life || !prev?.seal) return;
  const p = prev.seal, k = isChild ? 1 : (cfg.kinShare ?? 0.7), x = st(s);
  x.names = Math.round(p.names * k); x.earth = Math.round(p.earth * k); x.sky = Math.round(p.sky * k); x.end = p.end || null;
  x.heat = child?.sealHidden ? 0 : p.heat * (cfg.heirHeatShare ?? 0.4) + (child?.sealTallied ? 15 : 0);
  if (child?.awakened) x.rootSeen = true;
  if (child?.sealHidden) { s.life.stats.daoHeart += 1; logLine(s, "Тебя растили монахини Эмэй под чужим именем. Канцелярия считает тебя умершим в детстве — и это лучший подарок рода.", "family"); }
  if (x.end) logLine(s, (cfg.ends || {})[x.end] || "", "family");
  else if (x.names || x.earth || x.sky) logLine(s, `Родовая книга перешла к тебе: ${[x.names ? `${namesW(x.names)} из стёртых` : "", x.earth ? `осколок Земли — ${x.earth}%` : "", x.sky ? `осколок Неба — ${x.sky}%` : ""].filter(Boolean).join(", ")}.`, "family");
}
export function epitaphBit(s) {
  const x = s.life?.seal; if (!x || x.end === "gave") return "";
  return x.end === "spoke" ? " Сказал(а) имя Чжао вслух." : x.names >= 3 ? ` Помнил(а) ${namesW(x.names)} из стёртых.` : "";
}
