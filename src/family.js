// Живая семья: родители, братья и сёстры живут своей жизнью; у дома есть показатели и история перемен.
//   Родители: стареют (возраст = возраст при твоём рождении + твой), умирают по сроку (span) и бедам дома.
//   Братья и сёстры — как дети (life.js → growOne, роль "sib"): в 16 камень проверки, путь, иногда секта, брак, дети, смерть.
//   Достаток семьи (L.fam.wealth, очки; ступень = band очков): шум + фокус/ремесло + опора культиватора − возврат
//     к достатку рождения (revert) ± беды и удачи. Клан культиваторов — только со ступени cultclanNeedTier.
//   Лад в доме (0–100): фокус года, браки, рождения, смерти, карма; низкий лад — реже дети, чуть больше бед.
//   L.fam.hist — по году на запись (стрелки ↑↓ за trendYears), L.fam.changes — лента «Что изменилось».
// Параметры — data/kin.json → family.
import * as G from "./game.js";
import * as L from "./life.js";
import * as CL from "./clan.js";

const by = (arr, id) => arr?.find(x => x.id === id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
export const cfg = data => data.kin?.family || {};
const given = n => String(n || "").split(" ").slice(1).join(" ") || n;
const wIdx = (data, id) => Math.max(0, data.world.wealth.findIndex(w => w.id === id));

// ───── создание ─────
function parentSpan(data, s, rng, cult) {
  const W = data.world, F = cfg(data), wealth = by(W.wealth, s.life.wealthId);
  let span = W.life.mortalBase + (wealth?.lifeBonus || 0) + Math.round((rng() - 0.5) * 2 * W.life.mortalSpread);
  if (cult) { const [a, b] = F.cultParentLife || [40, 80]; span += a + Math.floor(rng() * (b - a)); }
  return span;
}
// Довести до «живого» вида домочадцев из makeHousehold (и из старых сейвов).
export function ensureFam(data, s, rng = Math.random) {
  const L0 = s.life; if (!L0) return;
  const F = cfg(data), W = data.world, band = F.band || 25;
  const h = L0.household;
  if (h) {
    for (const k of ["mother", "father"]) {
      const p = h[k]; if (!p) continue;
      p.gender ??= k === "mother" ? "f" : "m";
      if (p.alive == null) p.alive = true;
      if (p.span == null) { const cult = rng() < (F.cultParent?.[L0.wealthId] || 0); p.cult = cult; p.span = parentSpan(data, s, rng, cult); }
    }
    for (const x of h.siblings || []) {
      if (x.alive == null) x.alive = true;
      if (x.born == null) x.born = -(x.age ?? 0); // age — возраст при твоём рождении → «родился(ась) за N лет до тебя»
      x.kids ??= []; x.task ??= "home"; x.sect ??= null; x.spouse ??= null;
      if (x.awakened == null) x.awakened = false;
      if (x.realmIndex == null) { x.realmIndex = 0; x.layer = 1; x.qi = 0; }
      if (x.lastGrown == null) x.lastGrown = 0;
    }
  }
  const fresh = !L0.fam;
  L0.fam ??= {};
  const f = L0.fam;
  // Старый сейв посреди жизни: взрослые братья и сёстры молча проживают пропущенные годы.
  if (fresh && h) for (const x of h.siblings || []) for (let a = W.time.awakeningAge; x.alive && a < L0.age - x.born; a++) L.growKin(data, s, x, a, rng, false, "sib");
  if (f.wealth == null) f.wealth = wIdx(data, L0.wealthId) * band + band / 2;
  if (f.birthWealth == null) f.birthWealth = f.wealth;
  if (f.harmony == null) f.harmony = F.harmonyStart ?? 60;
  f.hist ??= []; f.changes ??= [];
}
// Двор наследника: умерший родитель (прошлая жизнь), второй родитель, если пережил, и остальные дети — братья и сёстры.
export function heirHousehold(data, s, prev, childIdx, rng = Math.random) {
  const L0 = s.life, age = L0.age;
  const dead = { name: prev.name, gender: prev.gender, age: prev.ageAtDeath - age, alive: false, diedAt: 0, deathAge: prev.ageAtDeath, job: prev.jobName || "", prevLife: true };
  let other = null;
  if (prev.spouseName) {
    const g = prev.spouseGender || (prev.gender === "m" ? "f" : "m");
    const oa = Math.max(age + 16, Math.min(prev.spouseAge ?? prev.ageAtDeath, 95));
    other = { name: prev.spouseName, gender: g, age: oa - age, alive: true, span: oa + 2 + Math.floor(rng() * 14), job: "" };
  }
  const sibs = (prev.children || []).filter((c, i) => i !== childIdx && c.alive).map(c => {
    const x = JSON.parse(JSON.stringify(c));
    x.born = age - (c.age ?? 0); x.rel = (c.age ?? 0) > age ? "старш." : "младш."; x.kids ??= []; x.alive = true;
    x.lastGrown = Math.max(x.lastGrown ?? 0, c.age ?? 0);
    delete x.age; return x;
  });
  const h = { mother: prev.gender === "f" ? dead : other, father: prev.gender === "m" ? dead : other, siblings: sibs, house: prev.house || "родительский дом" };
  return h;
}

// Двор дальнего наследника (внук, правнук, брат, сестра, племянник) из слепка родни prev.kinTree.
//   Внук и глубже: родители — его родитель (жив или нет) и супруг(а) родителя; братья и сёстры — другие дети родителя.
//   Брат/сестра: родители — родители прошлой жизни; прошлая жизнь — умерший брат/сестра со своими детьми (племянники растут дальше).
export function kinHousehold(data, s, prev, cand, rng = Math.random) {
  const L0 = s.life, age = L0.age, kt = prev.kinTree || {};
  const strip = k => { const x = JSON.parse(JSON.stringify(k)); delete x.age; x.kids = (k.kids || []).map(strip); return x; };
  const spanOf = (p, ageNow) => {
    try { return Math.max(ageNow + 1, Math.round(L.lifespan(data, L.childState(data, s, { ...p, born: age - ageNow })))); } catch (e) { return ageNow + 2 + Math.floor(rng() * 20); }
  };
  const asSib = (k, kAge) => { const x = strip(k); x.born = age - kAge; x.rel = kAge > age ? "старш." : "младш."; x.kids ??= []; x.lastGrown = Math.max(x.lastGrown ?? 0, kAge); return x; };
  let father = null, mother = null, sibs = [];
  if (cand.role === "sib") {
    for (const p of kt.parents || []) {
      if (!p) continue;
      const q = { ...p, age: p.ageNow - age }; delete q.key; delete q.ageNow; delete q.fresh;
      if (q.alive && !q.span) q.span = p.ageNow + 2 + Math.floor(rng() * 10);
      if (p.key === "father") father = q; else mother = q;
    }
    sibs = (kt.siblings || []).filter(x => x.alive && x !== cand.node && x.name !== cand.node.name).map(x => asSib(x, x.age));
    sibs.push({ name: prev.name, gender: prev.gender, born: age - prev.ageAtDeath, rel: prev.ageAtDeath > age ? "старш." : "младш.", alive: false, diedAt: 0, deathAge: prev.ageAtDeath,
      awakened: !!prev.awakened, rootId: null, elements: [], realmIndex: 0, layer: 1, qi: 0, sect: null, spouse: null, task: "home", lastGrown: prev.ageAtDeath,
      kids: (kt.children || prev.children || []).map(strip) });
  } else {
    const p = cand.parent, pa = p.age ?? 0;
    const par = { name: p.name, gender: p.gender, age: pa - age, alive: !!p.alive, job: "", cult: !!p.awakened, physiqueName: p.physiqueName };
    if (p.alive) par.span = spanOf(p, pa); else { par.diedAt = 0; par.deathAge = p.deathAge ?? pa; }
    let other = null;
    if (p.spouse) {
      const oa = Math.max(age + 16, pa + Math.floor(rng() * 9) - 4), alive = rng() < (p.alive ? 0.85 : 0.45);
      other = { name: p.spouse.name, gender: p.spouse.gender || (p.gender === "m" ? "f" : "m"), age: oa - age, alive, job: "", physiqueName: p.spouse.physiqueName };
      if (alive) other.span = oa + 2 + Math.floor(rng() * 16); else { other.diedAt = 0; other.deathAge = oa - Math.floor(rng() * Math.max(1, Math.min(20, age))); }
    }
    if (p.gender === "m") { father = par; mother = other; } else { mother = par; father = other; }
    sibs = (p.kids || []).filter(k => k !== cand.node && k.name !== cand.node.name && k.alive).map(k => asSib(k, k.age ?? (pa - (k.born ?? 0))));
  }
  sibs.sort((a, b) => a.born - b.born);
  return { mother, father, siblings: sibs, house: prev.house || "родительский дом" };
}

// ───── запись перемен ─────
const FRESH = { death: "утрата", birth: "родился(ась)", marriage: "свадьба", awaken: "корни", sect: "секта", realm: "ступень", wealth: "достаток", leave: "ушёл(ла)", rank: "ранг" };
export function famNote(data, s, person, text, kind = "info", logKind = "family") {
  const L0 = s.life; if (!L0) return;
  L.logLine(s, text, logKind);
  const f = L0.fam; if (!f) return;
  f.changes.push({ a: L0.age, t: L.fmt(s, text), k: kind });
  const keep = cfg(data).changesKeep || 24;
  if (f.changes.length > keep) f.changes.splice(0, f.changes.length - keep);
  if (person) person.fresh = { a: L0.age, t: L.gtext(FRESH[kind] || kind, person.gender) };
  const dh = cfg(data).harmonyKinds?.[kind];
  if (dh) f.harmony = clamp(f.harmony + dh, 0, 100);
}

// ───── год семьи ─────
export function members(s) {
  const L0 = s.life; if (!L0) return 0;
  const h = L0.household;
  let n = L0.alive ? 1 : 0;
  if (h) { n += [h.mother, h.father].filter(p => p?.alive).length; n += (h.siblings || []).filter(x => x.alive).length; }
  if (L0.spouse) n += 1;
  for (const c of L0.children) if (c.alive) n += 1 + (c.kids || []).filter(k => k.alive).length + (c.spouse ? 1 : 0);
  return n;
}
function liveParents(data, s, rng) {
  const L0 = s.life, W = data.world, h = L0.household; if (!h) return;
  const wealth = by(W.wealth, L0.wealthId), wl = W.life, F = cfg(data);
  for (const k of ["father", "mother"]) {
    const p = h[k]; if (!p?.alive) continue;
    const pa = p.age + L0.age, span = p.span || 60;
    const old = (pa / span - wl.oldAgeStart) / (1 - wl.oldAgeStart);
    const hz = (wealth?.hazard || 0.004) * (F.parentHazard ?? 0.6) * (p.cult ? 0.4 : 1) * CL.feudHazardMul(data, s);
    if (pa >= span || (old >= 0 && rng() < (wl.oldAgeBase ?? 0) + wl.oldAgeHazard * old * old) || rng() < hz) {
      p.alive = false; p.diedAt = L0.age; p.deathAge = pa;
      const who = k === "father" ? `Умер отец ${p.name}` : `Умерла мать ${p.name}`;
      famNote(data, s, p, `${who}, ${L.yearsW(pa)}. ${L0.age < 16 ? "Дом стал больше и холоднее." : "На поминках ты стоял(а) первым(ой)."}`, "death");
      CL.addTablet(data, s, { name: p.name, gender: p.gender, gen: (L0.generation || 1) - 1, role: k === "father" ? "отец" : "мать", age: pa });
    }
  }
}
// Пока мать молода и оба родителя живы, в доме рождаются младшие.
function newSibling(data, s, rng) {
  const L0 = s.life, h = L0.household, F = cfg(data), W = data.world;
  const m = h?.mother, f = h?.father;
  if (!m?.alive || !f?.alive || m.prevLife || f.prevLife || L0.age < 1 || L0.age > 20) return;
  const ma = m.age + L0.age;
  if (ma < 18 || ma > (F.motherMaxAge ?? 42) || (h.siblings || []).filter(x => x.alive).length >= (F.sibMax ?? 5) || rng() >= (F.sibBirth ?? 0.05)) return;
  const g = rng() < 0.5 ? "m" : "f", used = new Set([given(L0.name), ...(h.siblings || []).map(x => given(x.name))]);
  let nm = pick(W.names[g], rng); for (let k = 0; k < 12 && used.has(nm); k++) nm = pick(W.names[g], rng);
  const p = L.generatePerson(data, rng, { gender: g, given: nm, surname: L0.surname, age: 0, regionId: L0.regionId, wealthId: L0.wealthId, noRoot: true });
  const x = { name: p.name, gender: g, age: -L0.age, born: L0.age, rel: "младш.", alive: true, awakened: false, rootId: null, elements: [], physiqueId: p.physiqueId, physiqueName: p.physiqueName,
    stats: p.stats, kids: [], task: "home", sect: null, spouse: null, realmIndex: 0, layer: 1, qi: 0, lastGrown: 0 };
  (h.siblings ??= []).push(x);
  famNote(data, s, x, `В доме родил${g === "m" ? "ся младший брат" : "ась младшая сестра"} — ${p.name}.`, "birth");
}
function liveSiblings(data, s, rng) {
  const L0 = s.life, W = data.world, T = W.time, h = L0.household;
  newSibling(data, s, rng);
  if (!h?.siblings?.length) return;
  const wealth = by(W.wealth, L0.wealthId);
  for (const x of h.siblings) {
    const a = L0.age - x.born;
    if (a < 0) continue;
    if (!x.alive) { L.growDesc(data, s, x, a, "sib", rng); continue; }
    if (a < T.awakeningAge) {
      if (rng() < (wealth?.hazard || 0.004) * 0.8 * (a < 5 ? W.life.infantHazardMult : 1)) {
        x.alive = false; x.diedAt = L0.age; x.deathAge = a;
        famNote(data, s, x, `Умер${x.gender === "f" ? "ла" : ""} ${x.gender === "m" ? "брат" : "сестра"} ${x.name}, ${L.yearsW(a)}: детская хворь.`, "death");
      }
      continue;
    }
    L.growKin(data, s, x, a, rng, true, "sib");
    L.growDesc(data, s, x, a, "sib", rng);
  }
}
function adultNudge(data, s) {
  const L0 = s.life, F = cfg(data), J = data.jobs;
  let d = 0;
  if (L0.age >= (J?.workAge || 12)) {
    d += F.focusNudge?.[L0.focusId] ?? 0;
    if ((L.jobById(data, L0.jobId)?.stones || 0) >= (F.goodJobStones ?? 6)) d += F.goodJobNudge ?? 0.4;
  }
  // Культиватор в доме — опора: камни, связи, страх соседей. Берётся наибольшая подходящая ступень.
  if (L0.awakened) { const t = G.maxTier(data, s); d += Math.max(0, ...(F.tierSupport || []).filter(([tt]) => t >= tt).map(([, v]) => v)); }
  const h = L0.household;
  if (L0.age < 16 && h && !h.mother?.alive && !h.father?.alive) d += F.orphanDrift ?? -1;
  return d;
}
function moveWealth(data, s, rng) {
  const L0 = s.life, F = cfg(data), W = data.world, f = L0.fam, band = F.band || 25;
  let d = (rng() - 0.5) * 2 * (F.noise ?? 0.8) + adultNudge(data, s) - (F.revert ?? 0.03) * (f.wealth - f.birthWealth);
  if (rng() < (F.disasterChance ?? 0.02) * (by(W.regions, L0.regionId)?.hazardMult ?? 1)) {
    d -= F.disasterLoss ?? 8;
    famNote(data, s, null, `Беда в доме: ${pick(F.disasters || ["пришла беда."], rng)}`, "wealth");
  } else if (rng() < (F.windfallChance ?? 0.01)) {
    d += F.windfallGain ?? 6;
    famNote(data, s, null, `Удача в доме: ${pick(F.windfalls || ["повезло."], rng)}`, "wealth");
  }
  shiftWealth(data, s, d);
}
// Сдвиг достатка (очки); пересечение границы ступени — запись в ленту. Клан культиваторов — только с золотого ядра.
export function shiftWealth(data, s, d) {
  const L0 = s.life, F = cfg(data), W = data.world, f = L0.fam, band = F.band || 25;
  const capTop = L0.awakened && G.maxTier(data, s) >= (F.cultclanNeedTier ?? 2) || CL.tierIdx(data, CL.clanOf(s)) >= 3;
  const max = (capTop ? W.wealth.length : W.wealth.length - 1) * band - 0.01;
  const was = wIdx(data, L0.wealthId);
  f.wealth = clamp(f.wealth + d, 0, Math.max(max, was * band + band / 2));
  const now = clamp(Math.floor(f.wealth / band), 0, W.wealth.length - 1);
  if (now !== was) {
    L0.wealthId = W.wealth[now].id;
    famNote(data, s, null, now > was ? `Дом пошёл в гору: теперь вы — ${W.wealth[now].name.toLowerCase()}.` : `Дом обеднел: теперь вы — ${W.wealth[now].name.toLowerCase()}.`, "wealth");
  }
}
function moveHarmony(data, s) {
  const L0 = s.life, F = cfg(data), f = L0.fam;
  let d = F.harmonyFocus?.[L0.focusId] ?? 0;
  if (L0.spouse) d += 0.3;
  if (L0.children.some(c => c.alive)) d += 0.2;
  if (L0.stats.karma >= 5) d += 0.5; else if (L0.stats.karma <= -4) d -= 0.5;
  d -= (F.harmonyRevert ?? 0.05) * (f.harmony - (F.harmonyMean ?? 55));
  f.harmony = clamp(f.harmony + d, 0, 100);
}
export function familyYear(data, s, rng = Math.random) {
  const L0 = s.life; if (!L0?.alive) return;
  ensureFam(data, s, rng);
  liveParents(data, s, rng);
  liveSiblings(data, s, rng);
  moveWealth(data, s, rng);
  moveHarmony(data, s);
  const f = L0.fam, keep = cfg(data).histKeep || 15;
  f.hist.push({ a: L0.age, w: Math.round(f.wealth * 10) / 10, h: Math.round(f.harmony), n: members(s), r: Math.round(CL.clanOf(s)?.rep || 0) });
  if (f.hist.length > keep) f.hist.splice(0, f.hist.length - keep);
}
// Множители лада: рождения и годовой риск.
export function birthMul(data, s) { const F = cfg(data), h = s.life?.fam?.harmony ?? 55; return h < (F.harmonyLow ?? 30) ? F.lowBirthMul ?? 0.8 : h > (F.harmonyHigh ?? 75) ? F.highBirthMul ?? 1.1 : 1; }
export function hazardMul(data, s) { const F = cfg(data), h = s.life?.fam?.harmony ?? 55; return h < (F.harmonyLow ?? 30) - 5 ? F.lowHazardMul ?? 1.05 : h > (F.harmonyHigh ?? 75) ? F.highHazardMul ?? 0.95 : 1; }
// Тренд за trendYears лет: { w, h, n, r } → +1 / 0 / −1.
export function trends(data, s) {
  const f = s.life?.fam; if (!f?.hist?.length) return { w: 0, h: 0, n: 0, r: 0 };
  const yrs = cfg(data).trendYears || 5, cur = f.hist[f.hist.length - 1];
  const old = [...f.hist].reverse().find(x => cur.a - x.a >= yrs) || f.hist[0];
  const sg = (a, b, eps) => a - b > eps ? 1 : b - a > eps ? -1 : 0;
  return { w: sg(cur.w, old.w, 1.5), h: sg(cur.h, old.h, 3), n: sg(cur.n, old.n, 0), r: sg(cur.r, old.r, 1) };
}

// ───── карточки: условия, эффекты, подстановки ─────
export function livingParents(s) { const h = s.life?.household; return h ? [h.father, h.mother].filter(p => p?.alive) : []; }
export function livingSibs(s) { return (s.life?.household?.siblings || []).filter(x => x.alive && s.life.age - x.born >= 0); }
const eldest = arr => arr.slice().sort((a, b) => a.born - b.born)[0] || null;
export function targetParent(s) { const p = livingParents(s); return p.length ? p.slice().sort((a, b) => b.age - a.age)[0] : null; }
export function targetSib(s) { return eldest(livingSibs(s)); }
export function matches(data, s, r = {}) {
  const L0 = s.life, h = L0.household;
  if (r.parentsAlive && !livingParents(s).length) return false;
  if (r.parentsDead && (!h || livingParents(s).length || (!h.mother && !h.father))) return false;
  if (r.hasSiblings && !livingSibs(s).length) return false;
  if (r.sibSingle && !livingSibs(s).some(x => !x.spouse && L0.age - x.born >= 16)) return false;
  if (r.harmonyBelow != null && !((L0.fam?.harmony ?? 55) < r.harmonyBelow)) return false;
  if (r.harmonyAbove != null && !((L0.fam?.harmony ?? 55) > r.harmonyAbove)) return false;
  if (r.stonesMin != null && s.spiritStones < r.stonesMin) return false;
  return true;
}
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  const L0 = s.life, f = L0.fam;
  if (!f) return;
  if (ef.harmony) f.harmony = clamp(f.harmony + ef.harmony, 0, 100);
  if (ef.famWealth) shiftWealth(data, s, ef.famWealth);
  if (ef.parentYears) { const p = targetParent(s); if (p) p.span = (p.span || 60) + ef.parentYears; }
  if (ef.parentDeath) {
    const p = targetParent(s);
    if (p) {
      p.alive = false; p.diedAt = L0.age; p.deathAge = p.age + L0.age;
      famNote(data, s, p, `${p.gender === "m" ? "Умер отец" : "Умерла мать"} ${p.name}, ${L.yearsW(p.deathAge)}.`, "death");
      CL.addTablet(data, s, { name: p.name, gender: p.gender, gen: (L0.generation || 1) - 1, role: p.gender === "m" ? "отец" : "мать", age: p.deathAge });
    }
  }
  if (ef.spouseLeave && L0.spouse) {
    const sp = L0.spouse; L0.spouse = null; L0.exSpouses = [...(L0.exSpouses || []), sp.name];
    famNote(data, s, null, `${sp.gender === "m" ? "Супруг ушёл" : "Супруга ушла"} из дома: ${sp.name}. Дети остались с тобой.`, "leave");
  }
  if (ef.sibMarry) {
    const x = livingSibs(s).filter(y => !y.spouse && L0.age - y.born >= 16).sort((a, b) => a.born - b.born)[0];
    if (x) L.marryKin(data, s, x, rng, true, "sib");
  }
}
export function vars(data, s) {
  const p = targetParent(s), x = targetSib(s);
  const pw = p ? `${p.gender === "m" ? "отец" : "мать"} ${given(p.name)}` : "родня";
  const sw = x ? `${x.gender === "m" ? "брат" : "сестра"} ${given(x.name)}` : "родич";
  return { parent: pw, Parent: pw[0].toUpperCase() + pw.slice(1), sib: sw, Sib: sw[0].toUpperCase() + sw.slice(1) };
}
