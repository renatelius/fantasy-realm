// Род（宗族）: живёт дольше одной жизни — s.clans[«фамилия@край»].
//   名望 (rep) → ярус: безвестный → уважаемый → знатный → великий клан культиваторов (kin.json → clan.tiers).
//   Казна: доход рода по ярусу + взносы (duesShare заработка, устав «Общий котёл» — больше).
//   Казна даёт ресурсы, НЕ ци: часть цены пилюли (pillDiscount), подарок наследнику, свиток 中乘 в родовую библиотеку.
//   Соседние дома: отношения −100..100; ниже feudAt — вражда (набеги, беды ×feudHazard), от allyRel — союз (сваты, подарки).
//   Зал предков 祠堂: таблички всех жизней рода (и «новых судеб» той же фамилии в том же краю — дальняя ветвь) и близких.
// Наследник продолжает род; новая судьба — свой род или дальняя ветвь уже известного.
import * as G from "./game.js";
import * as L from "./life.js";
import * as F from "./family.js";

const by = (arr, id) => arr?.find(x => x.id === id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
function wpickW(ws, rng) { let r = rng() * ws.reduce((a, b) => a + b, 0); for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r < 0) return i; } return ws.length - 1; }
export const cfg = data => data.kin?.clan || null;
export const clanKey = L0 => `${L0.surname}@${L0.regionId}`;
export function clanOf(s) { const k = s.life?.clanKey; return k ? s.clans?.[k] || null : null; }
export function tierIdx(data, c) {
  const T = cfg(data)?.tiers || []; let i = 0;
  T.forEach((t, k) => { if ((c?.rep || 0) >= t.rep) i = k; });
  return c ? i : 0;
}
export function tierName(data, c) { return cfg(data)?.tiers?.[tierIdx(data, c)]?.name || "род"; }
export const ruleDef = (data, id) => cfg(data)?.rules?.find(r => r.id === id) || null;
// Эффект устава: relUp/interest/arrangedRep/loveRep складываются, остальное (duesShare, множители) — значение правила.
const ADDITIVE = new Set(["relUp", "interest", "arrangedRep", "loveRep"]);
function rfx(data, c, k, dflt) {
  const vals = (c?.rules || []).map(id => ruleDef(data, id)?.fx?.[k]).filter(x => x != null);
  if (!vals.length) return dflt;
  return ADDITIVE.has(k) ? dflt + vals.reduce((x, y) => x + y, 0) : vals[vals.length - 1];
}
export const relWord = (data, n) => n.feud ? "вражда" : n.rel >= (cfg(data)?.allyRel ?? 40) ? "союз" : n.rel >= 15 ? "дружба" : n.rel > -15 ? "ровно" : "неприязнь";

// ───── создание ─────
function makeNeighbors(data, own, rng) {
  const C = cfg(data), pool = (C.neighbors || []).filter(n => n.s !== own);
  const [a, b] = C.neighborCount || [6, 8], n = a + Math.floor(rng() * (b - a + 1)), out = [];
  const left = [...pool];
  for (let i = 0; i < n && left.length; i++) {
    const x = left.splice(Math.floor(rng() * left.length), 1)[0];
    const grudge = rng() < (C.oldGrudge ?? 0.15);
    out.push({ id: x.s, name: x.s, han: x.han, tier: wpickW(C.neighborTierWeights || [5, 4, 2, 1], rng), rel: grudge ? -65 : Math.round((rng() - 0.4) * 60), feud: grudge, since: grudge ? 0 : null });
  }
  return out;
}
function makeClan(data, s, rng) {
  const C = cfg(data), L0 = s.life;
  const c = { key: clanKey(L0), surname: L0.surname, regionId: L0.regionId, founded: L0.generation || 1,
    rep: C.startRep?.[L0.wealthId] ?? 0, treasury: C.startTreasury?.[L0.wealthId] ?? 0, rules: [], rivals: makeNeighbors(data, L0.surname, rng), tablets: [], lastTake: -99, lives: 0 };
  const rules = [...(C.rules || [])];
  const nr = tierIdx(data, c) >= 2 ? 2 : 1;
  for (let i = 0; i < nr && rules.length; i++) c.rules.push(rules.splice(Math.floor(rng() * rules.length), 1)[0].id);
  return c;
}
// Вызывается из startLife: наследник — тот же род (и подарок из казны), новая судьба — новый род или дальняя ветвь.
export function startClan(data, s, mode, rng = Math.random) {
  const C = cfg(data), L0 = s.life; if (!C || !L0) return null;
  s.clans ??= {};
  const key = clanKey(L0);
  let c = s.clans[key];
  const W = data.world, region = by(W.regions, L0.regionId)?.name;
  if (c && mode === "heir") {
    const t = tierIdx(data, c), grant = Math.min(Math.round((c.treasury || 0) * (C.heirShare ?? 0.15)), C.heirCap?.[t] ?? 0);
    if (grant > 0) { c.treasury -= grant; s.spiritStones += grant; }
    L0.clanKey = key; c.lives = (c.lives || 0) + 1;
    L.logLine(s, `Род ${c.surname}: ${tierName(data, c)}, 名望 ${Math.round(c.rep)}.${grant ? ` Казна рода выделила наследнику ${L.stonesW(grant)}.` : ""}`, "clan");
  } else if (c) {
    L0.clanKey = key; L0.clanBranch = "far"; c.lives = (c.lives || 0) + 1;
    L.logLine(s, `Ты родился(ась) в дальней ветви рода ${c.surname} из края «${region}»: ${tierName(data, c)}. На табличках Зала предков есть и твои прежние жизни.`, "clan");
  } else {
    c = makeClan(data, s, rng); c.lives = 1;
    s.clans[key] = c; L0.clanKey = key;
    // Не больше clansKeep родов в сейве: старые, не нынешние, забываются.
    const keys = Object.keys(s.clans);
    if (keys.length > (C.clansKeep || 6)) for (const k of keys.slice(0, keys.length - (C.clansKeep || 6))) if (k !== key) delete s.clans[k];
  }
  L0.clanTierSeen = 0;
  return c;
}
export function ensureClan(data, s, rng = Math.random) {
  if (!cfg(data) || !s.life) return;
  s.clans ??= {};
  if (!clanOf(s)) {
    const key = clanKey(s.life);
    if (!s.clans[key]) {
      s.clans[key] = makeClan(data, s, rng);
      // Сейв до v10: прошлые жизни рода — в Зал предков.
      for (const e of s.lineage || []) if (e.surname === s.life.surname && e.regionId === s.life.regionId) s.clans[key].tablets.push(tabletOf(e));
    }
    s.life.clanKey = key;
  }
  s.life.clanTierSeen ??= s.life.awakened ? G.maxTier(data, s) : 0;
}

// ───── Зал предков ─────
const tabletOf = e => ({ name: e.name, gender: e.gender, gen: e.generation || 1, role: e.far ? "дальняя ветвь" : `${e.generation || 1}-е поколение`, age: e.ageAtDeath, realm: e.awakened ? `${e.pathName && e.pathName !== "—" ? e.pathName + ": " : ""}${e.realmName}, слой ${e.layer}` : "", cause: e.cause, life: true, far: !!e.far, sect: e.sectName || null });
export function addTablet(data, s, t) {
  const c = clanOf(s); if (!c) return;
  c.tablets.push(t);
  const keep = cfg(data)?.tabletsKeep || 80;
  if (c.tablets.length > keep) {
    // Таблички прожитых жизней хранятся дольше, чем таблички родни.
    const i = c.tablets.findIndex(x => !x.life);
    c.tablets.splice(i >= 0 ? i : 0, 1);
  }
}
export function lifeTablet(data, s, entry) { const c = clanOf(s); if (!c) return; addTablet(data, s, tabletOf({ ...entry, far: s.life.clanBranch === "far" })); }

// ───── год рода ─────
export function feudClan(c) { return c?.rivals?.find(n => n.feud) || null; }
export function rivalClan(c) { const f = feudClan(c); if (f) return f; const r = (c?.rivals || []).filter(n => n.rel < 0).sort((a, b) => a.rel - b.rel)[0]; return r || null; }
export function allyClan(data, c) { const a = (c?.rivals || []).filter(n => !n.feud && n.rel >= (cfg(data)?.allyRel ?? 40)).sort((x, y) => y.rel - x.rel)[0]; return a || null; }
export function feudHazardMul(data, s) { return feudClan(clanOf(s)) ? cfg(data)?.feudHazard ?? 1.1 : 1; }
export function headName(s) {
  const L0 = s.life, h = L0?.household;
  if (h?.father?.alive && !h.father.prevLife && L0.age < 50 && h.father.name.split(" ")[0] === L0.surname) return h.father.name;
  if (L0?.age >= 16) return L0.name;
  if (h?.mother?.alive) return h.mother.name;
  return "старший дядя";
}
export const isHead = s => s.life?.age >= 16 && headName(s) === s.life.name;
function setRel(data, s, n, d, why = "") {
  const C = cfg(data); if (!n) return;
  const was = n.feud;
  n.rel = clamp(Math.round(n.rel + d), -100, 100);
  if (!n.feud && n.rel <= (C.feudAt ?? -60)) { n.feud = true; n.since = s.life.generation || 1; F.famNote(data, s, null, `Между родом ${s.life.surname} и домом ${n.name}（${n.han}）началась вражда${why}.`, "feud", "clan"); }
  else if (was && n.rel > (C.feudEndAt ?? -30)) { n.feud = false; F.famNote(data, s, null, `Вражда с домом ${n.name} утихла.`, "peace", "clan"); }
}
function awakenedKin(s) {
  const L0 = s.life, h = L0.household;
  return [...(h?.siblings || []), ...L0.children].filter(x => x.alive && x.awakened).length + (L0.awakened ? 1 : 0);
}
export function clanYear(data, s, rng = Math.random, pay = 0) {
  const C = cfg(data), c = clanOf(s), L0 = s.life; if (!C || !c || !L0?.alive) return;
  const t0 = tierIdx(data, c);
  // Казна: доход рода + взносы с заработка.
  const dues = pay > 0 ? Math.round(pay * rfx(data, c, "duesShare", C.duesShare ?? 0.1)) : 0;
  if (dues > 0) { s.spiritStones = Math.max(0, s.spiritStones - dues); }
  c.treasury = Math.round((c.treasury || 0) + dues + (C.baseIncome?.[t0] ?? 0) + (c.treasury || 0) * rfx(data, c, "interest", 0));
  // 名望: живые культиваторы рода, новые ступени, медленное забвение.
  c.rep += Math.min(C.repAwakenCap ?? 4, (C.repPerAwakened ?? 0.15) * awakenedKin(s));
  if (L0.awakened) { const mt = G.maxTier(data, s); if (mt > (L0.clanTierSeen ?? 0)) { c.rep += (C.repPerTier ?? 4) * (mt - (L0.clanTierSeen ?? 0)); L0.clanTierSeen = mt; } }
  c.rep = Math.max(0, c.rep - c.rep * (C.repDecay ?? 0.01));
  // Соседи: отношения дрейфуют к нулю; устав «Мир» тянет вверх, «Кровь» — вниз.
  const up = rfx(data, c, "relUp", 0);
  for (const n of c.rivals) setRel(data, s, n, (rng() - 0.5) * (C.relDrift ?? 4) - n.rel * (C.relRevert ?? 0.03) * (n.feud ? 0.3 : 1) + up);
  const fd = feudClan(c);
  if (fd && rng() < (C.feudIncident ?? 0.04)) feudIncident(data, s, fd, rng);
  const al = allyClan(data, c);
  if (al && rng() < (C.allyGift ?? 0.03)) { const g = 5 + Math.round(rng() * 10) * (1 + al.tier); c.treasury += g; L.logLine(s, `Дом ${al.name} прислал подарок роду: ${L.stonesW(g)} в казну.`, "clan"); }
  const t1 = tierIdx(data, c);
  if (t1 !== t0) F.famNote(data, s, null, t1 > t0 ? `Род ${c.surname} поднялся: теперь это ${tierName(data, c)}.` : `Род ${c.surname} потускнел: теперь это ${tierName(data, c)}.`, "clan", "clan");
}
function feudIncident(data, s, n, rng) {
  const c = clanOf(s), L0 = s.life, r = rng();
  if (r < 0.5) { const loss = Math.round((c.treasury || 0) * 0.15); c.treasury -= loss; F.famNote(data, s, null, `Люди дома ${n.name} ограбили амбары рода${loss ? `: казна потеряла ${L.stonesW(loss)}` : ""}.`, "feud", "clan"); }
  else if (r < 0.85) { if (L0.fam) L0.fam.harmony = clamp(L0.fam.harmony - 5, 0, 100); F.famNote(data, s, null, `Стычка с домом ${n.name} у колодца: родичей отнесли к лекарю.`, "feud", "clan"); }
  else {
    const pool = [...F.livingSibs(s).filter(x => s.life.age - x.born >= 16), ...L0.children.filter(x => x.alive && L.childAge(s, x) >= 16)];
    if (pool.length) {
      const v = pick(pool, rng); v.alive = false; v.diedAt = L0.age; v.deathAge = s.life.age - v.born;
      F.famNote(data, s, v, `${v.name} погиб${v.gender === "f" ? "ла" : ""} в стычке с домом ${n.name}. Вражда стала кровной.`, "death", "clan");
      addTablet(data, s, { name: v.name, gender: v.gender, gen: L0.generation || 1, role: "пал(а) во вражде", age: v.deathAge });
      n.rel = Math.max(-100, n.rel - 20);
    }
  }
}

// ───── действия игрока ─────
export function scrollCost(data, s) {
  const C = cfg(data), c = clanOf(s); if (!C || !c) return null;
  const t = tierIdx(data, c); if (t < (C.scroll?.minTier ?? 1)) return null;
  return C.scroll.cost[t] || null;
}
function scrollPool(data, s) {
  const C = cfg(data), c = clanOf(s), t = tierIdx(data, c), fam = new Set(s.familyTechs || []);
  const grades = t >= (C.scroll?.shangTier ?? 3) ? ["zhong", "shang"] : ["zhong"];
  const all = data.techniques.techniques.filter(x => x.owner === "clan" && grades.includes(x.grade) && !fam.has(x.id));
  const mine = all.filter(x => G.techUsable(data, s, x));
  return mine.length ? mine : all;
}
export function canBuyScroll(data, s) { const cost = scrollCost(data, s), c = clanOf(s); return cost != null && (c.treasury || 0) >= cost && scrollPool(data, s).length > 0; }
export function buyScroll(data, s, rng = Math.random) {
  if (!canBuyScroll(data, s)) return { ok: false, msg: "Казне рода это не по силам." };
  const c = clanOf(s), cost = scrollCost(data, s), pool = scrollPool(data, s), t = pick(pool, rng);
  c.treasury -= cost; (s.familyTechs ??= []).push(t.id);
  const msg = `Казна рода купила свиток «${t.name}» за ${L.stonesW(cost)}: теперь он в родовой библиотеке — бесплатно тебе и потомкам.`;
  L.logLine(s, msg, "clan"); return { ok: true, msg };
}
export function donate(data, s) {
  const C = cfg(data), c = clanOf(s); if (!c) return { ok: false, msg: "Рода нет." };
  const amt = Math.max(10, Math.floor(s.spiritStones * (C.donateShare ?? 0.2)));
  if (s.spiritStones < amt) return { ok: false, msg: "Не хватает камней." };
  s.spiritStones -= amt; c.treasury += amt; c.rep += amt / (C.donateRepPer ?? 15);
  const msg = `Ты внёс(ла) в казну рода ${L.stonesW(amt)}. Старейшины запомнили.`;
  L.logLine(s, msg, "clan"); return { ok: true, msg };
}
export function takeWait(data, s) { const c = clanOf(s); return c ? Math.max(0, (c.lastTake ?? -99) + (cfg(data)?.takeGap ?? 5) - s.life.age) : 0; }
export function take(data, s) {
  const C = cfg(data), c = clanOf(s);
  if (!c || !isHead(s)) return { ok: false, msg: "Казной распоряжается глава рода." };
  if (takeWait(data, s)) return { ok: false, msg: "Старейшины не дадут: брал(а) недавно." };
  const amt = Math.floor((c.treasury || 0) * (C.takeShare ?? 0.2));
  if (amt < 1) return { ok: false, msg: "Казна пуста." };
  c.treasury -= amt; c.lastTake = s.life.age; s.spiritStones += amt; c.rep = Math.max(0, c.rep - 1);
  const msg = `Как глава рода ты взял(а) из казны ${L.stonesW(amt)}. По двору пошёл шёпот.`;
  L.logLine(s, msg, "clan"); return { ok: true, msg };
}
// Доля цены пилюли, которую платит казна (game.js → pillPrice/buyPill).
export function pillShare(data, s, price) {
  const C = cfg(data), c = clanOf(s); if (!C || !c) return 0;
  return Math.max(0, Math.min(Math.floor(c.treasury || 0), Math.round(price * (C.pillDiscount?.[tierIdx(data, c)] || 0))));
}
export function payPillShare(data, s, share) { const c = clanOf(s); if (c && share > 0) c.treasury = Math.max(0, c.treasury - share); }
// Авторежим: свиток в библиотеку, если казна позволяет с запасом на пилюли.
export function autoClan(data, s, rng) {
  const cost = scrollCost(data, s), c = clanOf(s);
  if (cost != null && c && c.treasury >= cost * 1.3 && canBuyScroll(data, s)) buyScroll(data, s, rng);
}

// ───── карточки ─────
export function matches(data, s, r = {}) {
  const c = clanOf(s);
  if (r.feud && !feudClan(c)) return false;
  if (r.noFeud && feudClan(c)) return false;
  if (r.hasAlly && !allyClan(data, c)) return false;
  if (r.hasRival && !rivalClan(c)) return false;
  if (r.clanTierMin != null && (!c || tierIdx(data, c) < r.clanTierMin)) return false;
  if (r.treasuryMin != null && (!c || (c.treasury || 0) < r.treasuryMin)) return false;
  if (r.hasTablets && !(c?.tablets?.length)) return false;
  if (r.isHead && !isHead(s)) return false;
  if (r.notHead && isHead(s)) return false;
  return true;
}
function marryInto(data, s, n, rng, how) {
  const L0 = s.life;
  if (L0.spouse || !n) return false;
  if (L.marriageBlocked(data, s)) return false;
  const sp = L.makeSpouse(data, s, "arranged", rng);
  sp.surname = n.name; sp.name = `${n.name} ${sp.name.split(" ").slice(1).join(" ")}`; sp.clan = n.id;
  L0.spouse = sp;
  F.famNote(data, s, sp, `Ты сочетался(ась) браком ${how}: ${sp.name} из дома ${n.name}（${n.han}）.`, "marriage");
  return true;
}
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  const C = cfg(data), c = clanOf(s), L0 = s.life; if (!C || !c) return;
  if (ef.rep) c.rep = Math.max(0, c.rep + ef.rep * (ef.rep > 0 && feudClan(c) ? rfx(data, c, "feudRepMul", 1) : 1));
  if (ef.treasury) c.treasury = Math.max(0, (c.treasury || 0) + ef.treasury);
  if (ef.rivalRel) setRel(data, s, rivalClan(c), ef.rivalRel);
  if (ef.allyRel) setRel(data, s, allyClan(data, c), ef.allyRel);
  if (ef.feudEnd) { const f = feudClan(c); if (f) { f.rel = -10; f.feud = false; F.famNote(data, s, null, `С домом ${f.name} заключили мир.`, "peace", "clan"); } }
  if (ef.allyMarriage) { const a = allyClan(data, c); if (marryInto(data, s, a, rng, "по сговору домов")) { setRel(data, s, a, 15); c.rep += 4 + rfx(data, c, "arrangedRep", 0); L0.stats.connections = clamp(L0.stats.connections + 2, 0, 30); c.treasury += 10 * (1 + a.tier); } }
  if (ef.rivalMarriage) { const f = feudClan(c) || rivalClan(c); if (marryInto(data, s, f, rng, "ради мира между домами")) { f.feud = false; f.rel = 50; c.rep += 3; } }
  if (ef.clanRule) {
    const def = ruleDef(data, ef.clanRule);
    if (def && !c.rules.includes(def.id)) { c.rules.push(def.id); if (c.rules.length > 2) c.rules.shift(); L.logLine(s, `Устав рода дополнен: «${def.name}». ${def.text}`, "clan"); }
  }
}
// Брак без сговора (карточки со spouse: "love"): по уставу «Слово старших» — пересуды.
export function onMarriage(data, s, type) {
  const c = clanOf(s); if (!c) return;
  if (type === "love") c.rep = Math.max(0, c.rep + rfx(data, c, "loveRep", 0));
  if (type === "arranged") c.rep += rfx(data, c, "arrangedRep", 0);
}
export function lettersMul(data, s) { return rfx(data, clanOf(s), "lettersMul", 1); }
export function vars(data, s) {
  const c = clanOf(s), r = rivalClan(c), a = allyClan(data, c);
  return { clan: s.life?.surname || "", rival: r?.name || "соседей", ally: a?.name || "соседей" };
}
