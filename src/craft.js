// Ремёсла: мастерство в работе, алхимия, кузнечное дело, ученичество, снаряжение, духовный зверь, флаги цепочек событий.
//   Мастерство (L.craft.mastery[jobId], 0–100) растёт каждый год работы: base × фокус × (1 − xp/soft), не меньше floor × base.
//     Звание (crafts.json → ranks) умножает заработок (pay) и снижает риск ремесла (hazard). Опыт копится по каждому ремеслу отдельно.
//   Навыки (L.craft.skills.alchemy / smith) растут от работы (jobSkill), ученичества, варки/ковки и событий.
//     Шанс успеха = base + (навык − min) / perPoint. Попыток в год: base + навык / per (не больше max).
//     Алхимия: пилюли прорыва и ци дешевле рыночных (доля pillShare от цены пилюли), мирские мази — на продажу.
//     Неудача в котле иногда кончается взрывом: срок −1 год.
//   Снаряжение (L.gear.weapon / armor): множители боя × качество (грубый / добрый / отменный). Наследник получает его как реликвию.
//   Ученичество: плата один раз, затем years лет по xpPerYear в навык; в секте — за полцены. Выше cap учитель не учит.
//   Мастерская (детское занятие workshop): ребёнок учится ремеслу родителя; наследник начинает с этим опытом + heirShare опыта родителя.
import * as G from "./game.js";
import { logLine, stonesW, yearsW, lifespan, childAge, jobById, jobEligible, defaultJob, gtext } from "./life.js";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const C = data => data.crafts || null;

export function st(s) {
  const L = s.life;
  L.craft ??= { mastery: {}, skills: { alchemy: 0, smith: 0 }, appr: null, used: null, perLife: {} };
  L.craft.skills ??= { alchemy: 0, smith: 0 };
  L.craft.perLife ??= {};
  L.gear ??= { weapon: null, armor: null };
  L.flags ??= {};
  return L.craft;
}

// ───────── звания ─────────
export function rankOf(data, xp) {
  const R = C(data)?.ranks || [{ min: 0, name: "Ученик", pay: 1, hazard: 1 }];
  let r = R[0]; for (const x of R) if (xp >= x.min) r = x; return r;
}
export function nextRank(data, xp) { return (C(data)?.ranks || []).find(x => x.min > xp) || null; }
export function skillRank(data, xp) {
  const R = C(data)?.ranksSkill || [{ min: 0, name: "новичок" }];
  let r = R[0]; for (const x of R) if (xp >= x.min) r = x; return r.name;
}
export const jobXp = (s, id) => (s.life?.craft?.mastery?.[id]) || 0;
export const skill = (s, k) => (s.life?.craft?.skills?.[k]) || 0;
export function payMul(data, s, id) { return C(data) && id && id !== "home" ? rankOf(data, jobXp(s, id)).pay : 1; }
export function hazMul(data, s, id) { return C(data) && id && id !== "home" ? rankOf(data, jobXp(s, id)).hazard : 1; }

function softGain(data, cur, amount) {
  const g = C(data).gain;
  if (amount <= 0) return amount;
  return Math.max(amount * g.floor, amount * (1 - cur / g.soft));
}
export function addSkill(data, s, k, amount) {
  const c = st(s), before = c.skills[k] || 0;
  c.skills[k] = clamp(before + softGain(data, before, amount), 0, C(data).gain.cap);
  const a = skillRank(data, before), b = skillRank(data, c.skills[k]);
  if (a !== b && c.skills[k] > before) logLine(s, `${C(data).skills[k].name}: теперь ты ${b}.`, "family");
  return c.skills[k] - before;
}
export function addMastery(data, s, id, amount) {
  if (!id || id === "home") return 0;
  const c = st(s), before = c.mastery[id] || 0;
  c.mastery[id] = clamp(before + softGain(data, before, amount), 0, C(data).gain.cap);
  const a = rankOf(data, before), b = rankOf(data, c.mastery[id]);
  if (a !== b && c.mastery[id] > before) logLine(s, `${jobById(data, id)?.name || "Ремесло"}: тебя зовут «${b.name.toLowerCase()}». Заработок ×${b.pay}.`, "family");
  return c.mastery[id] - before;
}

// ───────── год ремесла (из life.js → yearPass) ─────────
export function yearCraft(data, s, rng = Math.random) {
  if (!C(data) || !s.life?.alive) return;
  const L = s.life, cfg = C(data), g = cfg.gain, c = st(s);
  const J = data.jobs;
  if (J && L.age >= J.workAge && L.jobId && L.jobId !== "home") {
    const f = g.focus[L.focusId] ?? 1;
    const got = addMastery(data, s, L.jobId, g.base * f);
    for (const [k, share] of Object.entries(cfg.jobSkill[L.jobId] || {})) addSkill(data, s, k, got * share);
  }
  applyPerks(data, s, rng);
  bizYear(data, s, rng);
  spouseYear(data, s);
  kidsJobs(data, s, rng);
  ladderOffers(data, s);
  if (c.appr) {
    addSkill(data, s, c.appr.skill, cfg.apprentice.xpPerYear);
    c.appr.years -= 1;
    if (c.appr.years <= 0) { logLine(s, `Ученичество окончено: ${c.appr.teacher} отпустил(а) тебя. ${cfg.skills[c.appr.skill].name} — ${Math.round(skill(s, c.appr.skill))}.`, "family"); c.appr = null; }
  }
  // Мастерская: дети учатся ремеслу родителя (и его алхимии/ковке).
  for (const ch of L.children) {
    if (!ch.alive || ch.task !== "workshop" || childAge(s, ch) < 6) continue;
    ch.craft ??= { jobs: {}, skills: {} };
    if (L.jobId && L.jobId !== "home") ch.craft.jobs[L.jobId] = Math.min(g.workshopCap, (ch.craft.jobs[L.jobId] || 0) + g.workshopChild);
    for (const k of Object.keys(cfg.skills)) if (skill(s, k) >= 15) ch.craft.skills[k] = Math.min(g.workshopCap, (ch.craft.skills[k] || 0) + g.workshopChild * 0.7);
  }
}

// ───────── найм (life.js → setJob) ─────────
// Чем меньше опыта в этом деле (или навыка из job.hire.skill), тем реже берут. Талант, ремесло родителей и связи помогают.
export function hireReq(data, job) {
  const H = C(data)?.hire; if (!H || !job || job.id === "home") return 0;
  if (job.need?.from) return 0; // повышение: берут, если опыта хватает (fromWhy)
  if (job.hire?.req != null) return job.hire.req;
  return Math.max(0, (job.stones - (H.reqFrom ?? 3)) * (H.reqPerStone ?? 4));
}
export function hireInfo(data, s, job) {
  const H = C(data)?.hire, L = s.life, req = hireReq(data, job);
  if (!H || !job || job.id === "home" || job.id === L.jobId || req <= 0) return { chance: 1, req, lv: 0, parts: [] };
  const own = jobXp(s, job.id), sk = job.hire?.skill ? skill(s, job.hire.skill) : 0;
  const parts = [];
  let lv = Math.max(own, sk);
  if (lv > 0) parts.push(sk > own ? `${(C(data).skills[job.hire.skill]?.name || "навык").toLowerCase()} ${Math.floor(sk)}` : `опыт ${Math.floor(own)}`);
  if ((C(data).talentJobs?.[L.talentId] || []).includes(job.id)) { lv += H.talent ?? 10; parts.push("талант"); }
  const parents = [L.household?.father?.job, L.household?.mother?.job].filter(Boolean);
  if (parents.includes(job.name)) { lv += H.parents ?? 10; parts.push("ремесло родителей"); }
  const cn = Math.min(H.connCap ?? 10, L.stats?.connections || 0); if (cn > 0) { lv += cn; parts.push(`связи +${cn}`); }
  const chance = clamp((H.base ?? 0.75) + (lv - req) / (H.scale ?? 40), H.min ?? 0.08, H.max ?? 0.97);
  return { chance, req, lv, parts };
}
export const hireChance = (data, s, job) => hireInfo(data, s, job).chance;
export function refusedNow(s, id) { return s.life?.craft?.refused?.[id] === s.life?.age; }
export function markRefused(s, id) { const c = st(s); c.refused ??= {}; c.refused[id] = s.life.age; }

// ───────── варка и ковка ─────────
export const recipe = (data, id) => C(data)?.recipes.find(r => r.id === id);
export function usesLeft(data, s, k) {
  const c = st(s), U = C(data).usesPerYear;
  if (!c.used || c.used.age !== s.life.age) c.used = { age: s.life.age };
  const max = Math.min(U.max, U.base + Math.floor(skill(s, k) / U.per));
  return Math.max(0, max - (c.used[k] || 0));
}
export function recipeCost(data, s, r) {
  const sk = C(data).skills[r.skill];
  let cost = r.pillShare ? Math.round(G.pillBase(data, s) * r.pillShare) + (r.costAdd || 0) : (r.cost || 0);
  if (sk.regionCheap?.includes(s.life.regionId)) cost = Math.round(cost * sk.regionMul);
  return Math.max(1, cost);
}
export function chance(data, s, r) {
  const ch = C(data).chance;
  return clamp(ch.base + (skill(s, r.skill) - r.min) / ch.perPoint, ch.minChance, ch.maxChance);
}
export function canCraft(data, s, r) {
  const L = s.life;
  if (!r || r.special) return { ok: false, why: "так не сделать" };
  if (!L.alive) return { ok: false, why: "жизнь окончена" };
  if (L.age < 10) return { ok: false, why: "слишком мал(а)" };
  if (r.awakened && !L.awakened) return { ok: false, why: "нужна ци" };
  if (skill(s, r.skill) < r.min) return { ok: false, why: `нужен навык ${r.min}` };
  if (r.perLife && (st(s).perLife[r.id] || 0) >= r.perLife) return { ok: false, why: "больше за жизнь не выйдет" };
  if (!usesLeft(data, s, r.skill)) return { ok: false, why: `${C(data).skills[r.skill].place} остывает до следующего года` };
  if (r.perYear && (st(s).used[r.id] || 0) >= r.perYear) return { ok: false, why: "в этом году жилы больше не примут" };
  if (s.spiritStones < recipeCost(data, s, r)) return { ok: false, why: "не хватает камней" };
  return { ok: true };
}
const effMul = (m, q) => 1 + ((m || 1) - 1) * q;
export function itemStats(it) {
  if (!it) return { atk: 1, hp: 1, def: 1, crit: 0 };
  return { atk: effMul(it.atk, it.q), hp: effMul(it.hp, it.q), def: effMul(it.def, it.q), crit: (it.crit || 0) * it.q };
}
export const itemValue = it => { const x = itemStats(it); return (x.atk - 1) * 3 + (x.hp - 1) * 1.5 + (x.def - 1) * 2 + x.crit * 20; };
export function itemName(it) { return it ? `${it.name}${it.qName ? ` (${it.qName})` : ""}${it.relic ? " · реликвия рода" : ""}` : "—"; }
function makeItem(data, r, roll) {
  const Q = C(data).quality; let q = Q[0]; for (const x of Q) if (roll >= x.min) q = x;
  return { id: r.id, slot: r.slot, name: r.name, q: q.q, qName: q.name, atk: r.atk, hp: r.hp, def: r.def, crit: r.crit };
}
export function craft(data, s, id, rng = Math.random, quiet = false) {
  const r = recipe(data, id), can = canCraft(data, s, r);
  if (!can.ok) return { ok: false, msg: `Не выйдет: ${can.why}.` };
  const c = st(s), cfg = C(data), sk = cfg.skills[r.skill], cost = recipeCost(data, s, r), p = chance(data, s, r);
  s.spiritStones -= cost; c.used[r.skill] = (c.used[r.skill] || 0) + 1; c.used[r.id] = (c.used[r.id] || 0) + 1;
  const say = (m, k) => { if (!quiet || k === "death") logLine(s, m, k); };
  const lvl = skill(s, r.skill);
  if (rng() >= p) {
    addSkill(data, s, r.skill, cfg.gain.failXp);
    if (r.skill === "alchemy" && rng() < cfg.chance.explode * (1 - lvl / 100)) {
      s.life.ageShift -= 1;
      const m = `Котёл треснул и выплюнул огонь: «${r.name}» не вышла, обожжены руки и лёгкие (срок −1 год).`;
      say(m, "death"); return { ok: true, fail: true, boom: true, msg: m };
    }
    const m = `${sk.verb} «${r.name}» не вышло: ${r.skill === "alchemy" ? "в котле зола" : "металл пошёл трещинами"}. Потрачено ${stonesW(cost)}, но руки запомнили ошибку.`;
    say(m, "cult"); return { ok: true, fail: true, msg: m };
  }
  addSkill(data, s, r.skill, cfg.gain.brewXp);
  if (r.perLife) c.perLife[r.id] = (c.perLife[r.id] || 0) + 1;
  let m;
  if (r.slot) {
    const it = makeItem(data, r, 0.85 + lvl / 200 + rng() * 0.2), cur = s.life.gear[r.slot];
    if (!cur || itemValue(it) >= itemValue(cur)) { s.life.gear[r.slot] = it; m = `Выковано: ${itemName(it)}. Теперь это твоё ${r.slot === "weapon" ? "оружие" : "защита"}.`; }
    else { const price = Math.round((r.cost || 10) * 1.4 * it.q); s.spiritStones += price; m = `Выковано: ${itemName(it)} — хуже того, что у тебя есть. Продано за ${stonesW(price)}.`; }
  } else if (r.sell) {
    const price = Math.round(r.sell * (0.8 + lvl / 100 * 0.6)); s.spiritStones += price;
    m = `${r.skill === "alchemy" ? "Сварено" : "Выковано"}: «${r.name}». Продано за ${stonesW(price)}.`;
  } else {
    if (r.pill) s.pills += r.pill;
    if (r.qiPct && s.life.awakened) s.qi = clamp(s.qi + r.qiPct * G.qiRequired(data, s), 0, G.qiRequired(data, s));
    if (r.years) s.life.ageShift += r.years;
    m = `Сварено: «${r.name}». ${r.text}`;
  }
  say(m, "cult"); return { ok: true, msg: m, name: r.name };
}
export function buyCost(data, s, r) { return Math.round((r.cost || 0) * (C(data).buyMul || 3)); }
export function buy(data, s, id) {
  const r = recipe(data, id);
  if (!r?.buy || !r.slot) return { ok: false, msg: "Такого у кузнеца не купить." };
  const price = buyCost(data, s, r);
  if (s.spiritStones < price) return { ok: false, msg: "Не хватает камней." };
  const it = makeItem(data, r, 1.0), cur = st(s) && s.life.gear[r.slot];
  if (cur && itemValue(cur) >= itemValue(it)) return { ok: false, msg: "У тебя уже не хуже." };
  s.spiritStones -= price; s.life.gear[r.slot] = it;
  const m = `Куплено у кузнеца: ${itemName(it)} за ${stonesW(price)}.`; logLine(s, m, "cult"); return { ok: true, msg: m };
}

// ───────── ученичество ─────────
export function apprenticeCost(data, s, k) {
  const A = C(data).apprentice;
  return Math.round((A.baseCost + A.costPerPoint * skill(s, k)) * (s.life.sect ? A.sectMul : 1));
}
export function canApprentice(data, s, k) {
  const A = C(data).apprentice, L = s.life, c = st(s);
  if (!L.alive) return { ok: false, why: "жизнь окончена" };
  if (L.age < A.minAge) return { ok: false, why: `с ${A.minAge} лет` };
  if (c.appr) return { ok: false, why: "ты уже в учениках" };
  if (skill(s, k) >= A.cap) return { ok: false, why: "учить больше нечему — дальше только сам(а)" };
  if (s.spiritStones < apprenticeCost(data, s, k)) return { ok: false, why: "не хватает камней" };
  return { ok: true };
}
export function apprentice(data, s, k, rng = Math.random, free = false) {
  const A = C(data).apprentice;
  if (!free) { const can = canApprentice(data, s, k); if (!can.ok) return { ok: false, msg: `Не выйдет: ${can.why}.` }; s.spiritStones -= apprenticeCost(data, s, k); }
  else if (st(s).appr) return { ok: false, msg: "Ты уже в учениках." };
  const T = A.teachers[k], teacher = s.life.sect && !free ? `${C(data).skills[k].place === "котёл" ? "алхимический павильон" : "оружейня"} секты` : T[Math.floor(rng() * T.length)];
  st(s).appr = { skill: k, years: A.years, teacher };
  const m = `Ты пошёл(ла) в ученики: ${teacher}. ${C(data).skills[k].name} — ${yearsW(A.years)} учёбы.`;
  logLine(s, m, "family"); return { ok: true, msg: m };
}

// ───────── бой: снаряжение и зверь (combat.js → playerStats) ─────────
export function gearStats(data, s) {
  const L = s.life, out = { atk: 1, hp: 1, def: 1, crit: 0 };
  if (!L) return out;
  for (const it of [L.gear?.weapon, L.gear?.armor]) { const x = itemStats(it); out.atk *= x.atk; out.hp *= x.hp; out.def *= x.def; out.crit += x.crit; }
  const b = L.beast && C(data)?.beasts?.[L.beast];
  if (b) { out.atk *= b.atk || 1; out.hp *= b.hp || 1; }
  const jp = jobById(data, L.jobId)?.perk; // стража, эскорт, охотники: служба закаляет
  if (jp) { out.atk *= jp.atk || 1; out.hp *= jp.hp || 1; }
  return out;
}

// ───────── эффекты и условия карточек ─────────
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  if (!C(data) || !s.life) return;
  const L = s.life; st(s);
  if (ef.craftXp) for (const [k, v] of Object.entries(ef.craftXp)) {
    if (k === "job") { if (L.jobId && L.jobId !== "home") { if (v > 0) addMastery(data, s, L.jobId, v); else L.craft.mastery[L.jobId] = Math.max(0, jobXp(s, L.jobId) + v); } }
    else if (v > 0) addSkill(data, s, k, v); else L.craft.skills[k] = Math.max(0, skill(s, k) + v);
  }
  if (ef.gear) { const r = recipe(data, ef.gear); if (r?.slot) { const it = makeItem(data, r, ef.gearQ ?? 1.0), cur = L.gear[r.slot]; if (!cur || itemValue(it) > itemValue(cur)) { L.gear[r.slot] = it; logLine(s, `Теперь при тебе: ${itemName(it)}.`, "luck"); } } }
  if (ef.gearLoss && L.gear[ef.gearLoss]) { logLine(s, `Утрачено: ${itemName(L.gear[ef.gearLoss])}.`, "cult"); L.gear[ef.gearLoss] = null; }
  if (ef.beast && !L.beast) { L.beast = ef.beast; const b = C(data).beasts[ef.beast]; if (b) logLine(s, `${b.name} теперь с тобой. ${b.text}`, "luck"); }
  if (ef.flag) for (const f of [].concat(ef.flag)) L.flags[f] = L.age;
  if (ef.stonesPct) s.spiritStones = Math.max(0, Math.round(s.spiritStones * (1 + ef.stonesPct)));
  if (ef.qiLoss && L.awakened) s.qi = Math.floor(s.qi * (1 - ef.qiLoss));
  if (ef.layerLoss && L.awakened && s.layer > 1) { s.layer = Math.max(1, s.layer - ef.layerLoss); s.qi = 0; logLine(s, `Ци повернула вспять: ты откатился(ась) на слой ${s.layer}.`, "death"); }
  if (ef.apprentice) apprentice(data, s, ef.apprentice, rng, true);
  if (ef.jobLoss && L.jobId && L.jobId !== "home") {
    const was = jobById(data, L.jobId), d = defaultJob(data, s);
    L.jobId = d && d.id !== was?.id ? d.id : "home"; markRefused(s, was?.id);
    logLine(s, `Тебя прогнали с места «${was?.name || "работа"}». Теперь: ${jobById(data, L.jobId)?.name || "дом и двор"}.`, "family");
  }
  if (ef.biz && L.biz) {
    const B = C(data).business, k = bizKind(data, L.biz.id);
    if (ef.biz === "up" && L.biz.lvl < B.lvlMul.length) { L.biz.lvl++; logLine(s, `«${k?.name}» теперь ${B.lvlNames[L.biz.lvl - 1]}.`, "family"); }
    else if (ef.biz === "down") { if (L.biz.lvl > 1) { L.biz.lvl--; logLine(s, `«${k?.name}» сдало: теперь ${B.lvlNames[L.biz.lvl - 1]}.`, "family"); } }
    else if (ef.biz === "close") { logLine(s, `«${k?.name}» закрыто.`, "family"); L.biz = null; }
  }
}
export function matches(data, s, r = {}) {
  const L = s.life, fl = L.flags || {};
  if (r.flag && (fl[r.flag] == null || L.age - fl[r.flag] < (r.flagAge || 0))) return false;
  if (r.noFlag && fl[r.noFlag] != null) return false;
  if (r.minMastery != null && (!L.jobId || L.jobId === "home" || jobXp(s, L.jobId) < r.minMastery)) return false;
  if (r.minSkill) for (const [k, v] of Object.entries(r.minSkill)) if (skill(s, k) < v) return false;
  if (r.maxSkill) for (const [k, v] of Object.entries(r.maxSkill)) if (skill(s, k) > v) return false;
  if (r.job && !r.job.includes(L.jobId)) return false;
  if (r.hasGear && !L.gear?.[r.hasGear]) return false;
  if (r.noBeast && L.beast) return false;
  if (r.minStonesHave != null && s.spiritStones < r.minStonesHave) return false;
  if (r.hasBiz && !L.biz) return false;
  if (r.noBiz && L.biz) return false;
  return true;
}
// Оценка эффектов для авторежима (life.js → choiceScore).
export function scoreFx(ef = {}) {
  const xp = Object.values(ef.craftXp || {}).reduce((a, b) => a + b, 0);
  return xp * 0.4 + (ef.gear ? 6 : 0) + (ef.beast ? 7 : 0) + (ef.gearLoss ? -6 : 0) + (ef.stonesPct || 0) * 40 + (ef.qiLoss || 0) * -12 + (ef.layerLoss || 0) * -18 + (ef.apprentice ? 5 : 0)
    + (ef.jobLoss ? -8 : 0) + (ef.biz === "up" ? 6 : ef.biz === "down" ? -6 : ef.biz === "close" ? -12 : 0);
}

// ───────── наследие ─────────
export function snapshot(s) {
  const c = s.life?.craft; return c ? { jobId: s.life.jobId, mastery: { ...c.mastery }, skills: { ...c.skills } } : null;
}
// Наследник: опыт мастерской + доля опыта родителя (только у детей), снаряжение предка — реликвией.
export function inherit(data, s, prev, node, isChild) {
  if (!C(data) || !s.life) return;
  const L = s.life, c = st(s), g = C(data).gain;
  for (const [id, v] of Object.entries(node?.craft?.jobs || {})) c.mastery[id] = Math.max(c.mastery[id] || 0, v);
  for (const [k, v] of Object.entries(node?.craft?.skills || {})) c.skills[k] = Math.max(c.skills[k] || 0, v);
  if (isChild && prev?.craft) {
    const pj = prev.craft.jobId;
    if (pj && pj !== "home") c.mastery[pj] = Math.min(40, (c.mastery[pj] || 0) + (prev.craft.mastery?.[pj] || 0) * g.heirShare);
    for (const [k, v] of Object.entries(prev.craft.skills || {})) c.skills[k] = Math.min(40, (c.skills[k] || 0) + v * g.heirShare);
  }
  for (const slot of ["weapon", "armor"]) if (prev?.gear?.[slot]) L.gear[slot] = { ...prev.gear[slot], relic: true };
  if (isChild && prev?.biz && bizKind(data, prev.biz.id)) {
    L.biz = { id: prev.biz.id, lvl: prev.biz.lvl || 1, since: L.age - Math.min(20, prev.biz.years || 0), total: 0 };
    logLine(s, `Наследство: «${bizKind(data, prev.biz.id).name}» (${C(data).business.lvlNames[L.biz.lvl - 1]}) теперь твоё.`, "family");
  }
  if (L.age >= (data.jobs?.workAge || 12)) {
    const best = Object.entries(c.mastery).filter(([id]) => jobEligible(data, s, jobById(data, id))).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 10) L.jobId = best[0];
  }
}

// ───────── авторежим ─────────
export function autoCraft(data, s, rng = Math.random) {
  if (!C(data) || !s.life?.alive) return;
  const L = s.life, c = st(s), A = C(data).apprentice;
  autoBiz(data, s);
  // Ученичество: в навык своего ремесла или, на Пути, в алхимию (свои пилюли).
  if (!c.appr && L.age >= A.minAge && L.age <= 45) {
    const own = Object.keys(C(data).jobSkill[L.jobId] || {}).find(k => skill(s, k) < A.cap);
    const want = own || (L.awakened ? ["alchemy", "smith"].find(k => skill(s, k) < A.cap) : null);
    if (want && skill(s, want) < A.cap && s.spiritStones >= apprenticeCost(data, s, want) * (L.awakened ? 3 : 2)) apprentice(data, s, want, rng);
  }
  const R = C(data).recipes, old = L.age >= 0.7 * lifespan(data, s);
  const made = [], fails = { n: 0 };
  const run = id => { const r = craft(data, s, id, rng, true); if (r.fail) fails.n++; else if (r.ok) made.push(r.name); };
  const ok = r => canCraft(data, s, r).ok;
  // Алхимия: пилюля прорыва → ци → долголетие на закате → мирские на продажу.
  for (let guard = 0; guard < 6 && usesLeft(data, s, "alchemy"); guard++) {
    const pick = [
      L.awakened && s.pills < 2 && R.find(r => r.id === "break_pill" && ok(r) && chance(data, s, r) >= 0.5 && recipeCost(data, s, r) <= s.spiritStones * 0.5),
      old && R.find(r => r.id === "long_pill" && ok(r) && chance(data, s, r) >= 0.4),
      old && R.find(r => r.id === "heal_pill" && ok(r) && chance(data, s, r) >= 0.45 && recipeCost(data, s, r) <= s.spiritStones * 0.4),
      L.awakened && R.find(r => r.id === "qi_pill" && ok(r) && chance(data, s, r) >= 0.5 && recipeCost(data, s, r) <= s.spiritStones * 0.3),
      R.filter(r => r.skill === "alchemy" && r.sell && ok(r) && chance(data, s, r) * r.sell * (0.8 + skill(s, "alchemy") / 100 * 0.6) > recipeCost(data, s, r) * 1.2).pop(),
    ].find(Boolean);
    if (!pick) break; run(pick.id);
  }
  // Кузня: лучше, чем на тебе, — ковать; без навыка — купить простое; остаток попыток — на продажу.
  for (let guard = 0; guard < 6 && usesLeft(data, s, "smith"); guard++) {
    const better = R.filter(r => r.skill === "smith" && r.slot && ok(r) && chance(data, s, r) >= 0.45 && recipeCost(data, s, r) <= s.spiritStones * 0.4
      && itemValue({ ...r, q: 1 }) > itemValue(L.gear[r.slot]) * 1.05).sort((a, b) => itemValue({ ...b, q: 1 }) - itemValue({ ...a, q: 1 }))[0];
    const sell = R.filter(r => r.skill === "smith" && r.sell && ok(r) && chance(data, s, r) * r.sell * (0.8 + skill(s, "smith") / 100 * 0.6) > recipeCost(data, s, r) * 1.2).pop();
    const pick = better || sell; if (!pick) break; run(pick.id);
  }
  if (made.length || fails.n) {
    const cnt = {}; for (const n of made) cnt[n] = (cnt[n] || 0) + 1;
    const list = Object.entries(cnt).map(([n, k]) => `${k > 1 ? `${k}× ` : ""}«${n}»`).join(", ");
    logLine(s, `Котёл и горн за год: ${list || "ничего не вышло"}${fails.n ? `${list ? "; " : ""}неудач — ${fails.n}` : ""}.`, "cult");
  }
  if (L.age >= 14) for (const slot of ["weapon", "armor"]) {
    const r = R.filter(x => x.slot === slot && x.buy && buyCost(data, s, x) <= s.spiritStones * 0.25 && itemValue({ ...x, q: 1 }) > itemValue(L.gear[slot])).pop();
    if (r) buy(data, s, r.id);
  }
}

// ───────── польза работы (jobs.json → perk) ─────────
//   haz — беды семьи ×; conn / karma / dao — шанс +1 в год; harmony — лад в доме за год; find — находки (камни, навык);
//   deal / bounty — сделка или награда (камни от min до max); scroll — свиток (на Пути); atk / hp — бой (gearStats).
export const bizKind = (data, id) => C(data)?.business?.kinds?.find(k => k.id === id) || null;
function perks(data, s) {
  const L = s.life; return [jobById(data, L?.jobId)?.perk, L?.biz && bizKind(data, L.biz.id)?.perk].filter(Boolean);
}
export function hazardMul(data, s) { return perks(data, s).reduce((m, p) => m * (p.haz || 1), 1); }
export function perkValue(p, aw) {
  if (!p) return 0;
  let v = (1 - (p.haz || 1)) * 25 + (p.conn || 0) * 4 + (p.karma || 0) * 2 + (p.dao || 0) * 6 + (p.harmony || 0) * 0.6;
  if (p.find) v += p.find.p * ((p.find.stones || 0) + ((p.find.alchemy || 0) + (p.find.smith || 0)) * 1.5);
  for (const k of ["deal", "bounty"]) if (p[k]) v += p[k].p * (p[k].min + p[k].max) / 2 * 0.7; // разово и не каждый год — ценится ниже жалования
  if (aw) v += (p.scroll || 0) * 60 + ((p.atk || 1) - 1) * 60 + ((p.hp || 1) - 1) * 40;
  return v;
}
const roll = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
function applyPerks(data, s, rng) {
  const L = s.life, J = data.jobs; if (!J || L.age < J.workAge) return;
  const st0 = L.stats, job = jobById(data, L.jobId);
  for (const p of perks(data, s)) {
    if (p.conn && rng() < p.conn) st0.connections = clamp(st0.connections + 1, 0, 30);
    if (p.karma && rng() < p.karma) st0.karma = clamp(st0.karma + 1, -20, 20);
    if (p.dao && rng() < p.dao) st0.daoHeart = clamp(st0.daoHeart + 1, -5, 20);
    if (p.harmony && L.fam) L.fam.harmony = clamp((L.fam.harmony ?? 55) + p.harmony, 0, 100);
    if (p.find && rng() < p.find.p) {
      const f = p.find; if (f.stones) s.spiritStones += f.stones;
      for (const k of ["alchemy", "smith"]) if (f[k]) addSkill(data, s, k, f[k]);
      logLine(s, `${job?.name || "Работа"}: удачная находка${f.stones ? ` — ${stonesW(f.stones)}` : ""}${f.alchemy ? ", редкие травы" : ""}${f.smith ? ", шкуры и руда" : ""}.`, "luck");
    }
    if (p.deal && rng() < p.deal.p) { const v = roll(rng, p.deal.min, p.deal.max); s.spiritStones += v; logLine(s, `${job?.name || "Дело"}: выгодная сделка, +${stonesW(v)}.`, "luck"); }
    if (p.bounty && rng() < p.bounty.p) { const v = roll(rng, p.bounty.min, p.bounty.max); s.spiritStones += v; logLine(s, `Награда за голову разбойника: +${stonesW(v)}.`, "adv"); }
    if (p.scroll && L.awakened && rng() < p.scroll) { const tt = G.luckyScroll(data, s, rng); if (tt) logLine(s, `Среди пыльных полок нашёлся свиток «${tt.name}».`, "luck"); }
  }
}

// ───────── карьерная лестница (jobs.json → need.from) ─────────
// Должность открывает опыт на ступень ниже. Кто уже служил на этой должности (опыт ≥ 10), может вернуться без проверки.
export function fromWhy(data, s, job) {
  const f = job?.need?.from; if (!f) return "";
  if (jobXp(s, job.id) >= 10) return "";
  const best = Math.max(0, ...f.jobs.map(id => jobXp(s, id)));
  if (best >= f.xp) return "";
  return `нужен опыт ${f.jobs.map(id => `«${jobById(data, id)?.name || id}»`).join(" или ")} ${f.xp} (сейчас ${Math.floor(best)})`;
}
// Повышение переносит часть опыта: старшина артели не начинает учеником.
export function promote(data, s, job) {
  const f = job?.need?.from; if (!f) return false;
  const c = st(s), best = Math.max(0, ...f.jobs.map(id => jobXp(s, id)));
  c.mastery[job.id] = Math.max(c.mastery[job.id] || 0, best * 0.6);
  return true;
}
function ladderOffers(data, s) {
  const L = s.life; if (!L.jobId || L.jobId === "home") return;
  for (const j of data.jobs.jobs) {
    if (!j.need?.from?.jobs.includes(L.jobId) || L.flags["offer:" + j.id] != null) continue;
    if (fromWhy(data, s, j) || !jobEligible(data, s, j)) continue;
    L.flags["offer:" + j.id] = L.age;
    logLine(s, `Старшие зовут тебя на место «${j.name}» — ${j.stones} камн./год. Оно в списке работ.`, "family");
  }
}

// ───────── своё дело (crafts.json → business) ─────────
export function bizNeedWhy(data, s, k) {
  const B = C(data).business, L = s.life, n = k.need || {};
  if (L.age < B.minAge) return `с ${B.minAge} лет`;
  if (L.biz) return "у тебя уже есть дело";
  if (n.mastery != null) {
    const ids = n.jobs || [L.jobId];
    const best = Math.max(0, ...ids.filter(id => id && id !== "home").map(id => jobXp(s, id)));
    if (best < n.mastery) return n.jobs ? `нужен опыт ${n.jobs.map(id => `«${jobById(data, id)?.name || id}»`).join(" или ")} ${n.mastery}` : `нужен опыт в своём ремесле ${n.mastery}`;
  }
  for (const [kk, v] of Object.entries(n.skill || {})) if (skill(s, kk) < v) return `нужна ${C(data).skills[kk].name.toLowerCase()} ${v}`;
  if (s.spiritStones < k.cost) return "не хватает камней";
  return "";
}
const bizKids = s => (s.life.children || []).filter(c => c.alive && c.task === "biz" && childAge(s, c) >= 10).length;
export function bizIncome(data, s) {
  const L = s.life, b = L.biz, k = b && bizKind(data, b.id), B = C(data)?.business; if (!k) return 0;
  const yrs = Math.max(0, L.age - b.since);
  return Math.round(k.income * B.lvlMul[(b.lvl || 1) - 1] * (1 + Math.min(B.growthCap, yrs * B.growth))
    * (1 + B.kidBonus * Math.min(B.kidMax, bizKids(s))) * (L.focusId === "work" ? B.workMul : 1));
}
export function bizSellPrice(data, s) {
  const b = s.life.biz, k = b && bizKind(data, b.id), B = C(data).business;
  return k ? Math.round(k.cost * B.sellShare * B.lvlMul[(b.lvl || 1) - 1]) : 0;
}
export function openBiz(data, s, id) {
  const k = bizKind(data, id); if (!k) return { ok: false, msg: "Такого дела нет." };
  const why = bizNeedWhy(data, s, k); if (why) return { ok: false, msg: `Не выйдет: ${why}.` };
  s.spiritStones -= k.cost; s.life.biz = { id, lvl: 1, since: s.life.age, total: 0 };
  const m = `Ты открыл(а) своё дело: «${k.name}» за ${stonesW(k.cost)}.`; logLine(s, m, "family"); return { ok: true, msg: m };
}
export function sellBiz(data, s) {
  const b = s.life.biz, k = b && bizKind(data, b.id); if (!k) return { ok: false, msg: "Дела нет." };
  const v = bizSellPrice(data, s); s.spiritStones += v; s.life.biz = null;
  const m = `«${k.name}» продано за ${stonesW(v)}.`; logLine(s, m, "family"); return { ok: true, msg: m };
}
function bizYear(data, s, rng) {
  const L = s.life, b = L.biz; if (!b) return;
  const k = bizKind(data, b.id), B = C(data).business; if (!k) { L.biz = null; return; }
  const inc = bizIncome(data, s); s.spiritStones += inc; b.total = (b.total || 0) + inc;
  const yrs = L.age - b.since;
  if (yrs > 0 && yrs % 10 === 0) logLine(s, `«${k.name}»: ${stonesW(inc)} в год, за всё время — ${stonesW(b.total)}.`, "family");
  if (yrs > 0 && yrs % B.upYears === 0 && b.lvl < B.lvlMul.length && rng() < B.upChance) { b.lvl++; logLine(s, `«${k.name}» разрослось: теперь оно ${B.lvlNames[b.lvl - 1]}.`, "luck"); }
  if (rng() < k.risk) {
    if (b.lvl > 1 && rng() < 0.7) { b.lvl--; logLine(s, `Тяжёлый год для «${k.name}»: долги и пустые полки. Теперь оно ${B.lvlNames[b.lvl - 1]}.`, "family"); }
    else { logLine(s, `«${k.name}» прогорело: долги съели всё. Дело закрыто.`, "death"); L.biz = null; }
  }
}
function autoBiz(data, s) {
  const L = s.life, B = C(data)?.business; if (!B || L.biz) return;
  if (L.age < B.minAge + 4 || L.age > 0.75 * lifespan(data, s)) return;
  const k = B.kinds.filter(x => !bizNeedWhy(data, s, x) && s.spiritStones >= x.cost * (L.awakened ? 3 : 2)).sort((a, b) => b.cost - a.cost)[0];
  if (k) openBiz(data, s, k.id);
}

// ───────── супруг и взрослые дети ─────────
export const spouseXp = (s, id) => s.life?.spouse?.xp?.[id] || 0;
export const spouseRankPay = (data, s, id) => C(data) && id && id !== "home" ? rankOf(data, spouseXp(s, id)).pay : 1;
export const spousePayMul = (data, s) => spouseRankPay(data, s, s.life?.spouse?.jobId);
export function spouseRankTag(data, s) {
  const sp = s.life?.spouse; if (!C(data) || !sp?.jobId || sp.jobId === "home") return "";
  const x = spouseXp(s, sp.jobId); return x >= 20 ? ` · ${rankOf(data, x).name.toLowerCase()}` : "";
}
function spouseYear(data, s) {
  const sp = s.life.spouse; if (!sp?.jobId || sp.jobId === "home") return;
  sp.xp ??= {}; const cur = sp.xp[sp.jobId] || 0, g = C(data).gain;
  sp.xp[sp.jobId] = clamp(cur + softGain(data, cur, g.base * 0.8), 0, g.cap);
  const a = rankOf(data, cur), b = rankOf(data, sp.xp[sp.jobId]);
  if (a !== b) logLine(s, `${sp.gender === "m" ? "Супруга" : "Супругу"} теперь зовут «${b.name.toLowerCase()}» в деле «${jobById(data, sp.jobId)?.name}».`, "family");
}
const hashStr = t => { let h = 2166136261; for (const ch of String(t)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
function childJobPick(data, s, ch) {
  const L = s.life, T = C(data).talentJobs || {}, h = hashStr(ch.name);
  const list = (data.jobs?.jobs || []).filter(j => j.id !== "home" && !j.awakened && !j.need && (!j.region || j.region.includes(L.regionId)) && (!j.wealth || j.wealth.includes(L.wealthId)));
  const sib = id => L.children.filter(x => x !== ch && x.alive && x.jobId === id).length; // братья и сёстры расходятся по разным делам
  let best = null, bv = -1e9;
  list.forEach((j, i) => {
    const v = j.stones - j.hazard * 1500 + (ch.craft?.jobs?.[j.id] || 0) * 0.3 + (T[ch.talentId]?.includes(j.id) ? 4 : 0) + (j.id === L.jobId ? 3 : 0) - sib(j.id) * 2.5 + ((h >>> (i % 24)) & 7);
    if (v > bv) { bv = v; best = j; }
  });
  return best;
}
// Взрослые дети (16+) встают к своему делу: мастерская, талант, ремесло родителя. Опыт растёт, бывают повышения;
// неженатые живут с тобой и отдают в дом пятую часть заработка. Наследник продолжает своё дело (inherit → node.craft.jobs).
function kidsJobs(data, s, rng) {
  const L = s.life;
  for (const ch of L.children) {
    if (!ch.alive || ch.sect || childAge(s, ch) < 16) continue;
    ch.craft ??= { jobs: {}, skills: {} };
    if (!ch.jobId) { const j = childJobPick(data, s, ch); if (j) { ch.jobId = j.id; logLine(s, gtext(`${ch.name} встал(а) к своему делу: ${j.name}.`, ch.gender), "family"); } }
    if (!ch.jobId) continue;
    const x = ch.craft.jobs[ch.jobId] || 0; ch.craft.jobs[ch.jobId] = Math.min(70, x + 3 * (1 - x / 115));
    const up = data.jobs.jobs.find(j => j.need?.from?.jobs.includes(ch.jobId) && !j.awakened && ch.craft.jobs[ch.jobId] >= j.need.from.xp && (!j.region || j.region.includes(L.regionId)));
    if (up && rng() < 0.25) {
      ch.craft.jobs[up.id] = Math.max(ch.craft.jobs[up.id] || 0, ch.craft.jobs[ch.jobId] * 0.6); ch.jobId = up.id;
      logLine(s, gtext(`${ch.name} пошёл(ла) в гору: теперь ${up.name.toLowerCase()}.`, ch.gender), "family");
    }
    if (!ch.spouse) { const h = Math.round((jobById(data, ch.jobId)?.stones || 0) * 0.2); if (h) s.spiritStones += h; }
  }
}
