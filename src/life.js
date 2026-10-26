// Жизнь культиватора: рождение-лотерея, годы, летопись, карточки выбора, семья, смерть, наследие.
// Формулы:
//   qiMult жизни = root.qiMult * era.qiMult * region.qiMult   (множитель медитации)
//   максимальный возраст: смертный = mortalBase + wealth.lifeBonus ± spread;
//                         после пробуждения = max(смертный, realm.maxAge); плюс ageShift от событий
//   риск смерти в год = wealth.hazard * region.hazardMult * era.hazardMult * 0.4 (после пробуждения)
//                       * 0.5^realmIndex * (2 до 5 лет); после 90% срока +6%/год («старость»)
//   время: dt_игры = dt_реальное * speed.factor (0 = пауза); untilEvent — сразу до карточки или смерти
//   год = yearSeconds игровых секунд (детство в 0.15 раза)
import { newState } from "./state.js";
import * as G from "./game.js";

const pick = (a, rng) => a[Math.floor(rng() * a.length)];
function wpick(items, rng) {
  let r = rng() * items.reduce((t, x) => t + x.weight, 0);
  for (const x of items) { r -= x.weight; if (r < 0) return x; }
  return items[items.length - 1];
}
const by = (arr, id) => arr.find(x => x.id === id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (arr, k = "weight") => arr.reduce((t, x) => t + x[k], 0);

// Род в тексте: «встал(а)» → «встал» / «встала». Плейсхолдер {Spouse} — супруг/супруга.
export function gtext(t, gender) {
  return t.replace(/([А-Яа-яЁё]+)\(([а-яё]+)\)/g, (m, base, grp) => {
    if (gender === "m") return base;
    if (grp === "ла" && /[её]л$/.test(base)) return base.slice(0, -2) + grp;   // ушёл → ушла, вышел → вышла
    if (grp.startsWith("л") && base.endsWith("лся")) return base.slice(0, -3) + grp;
    if (grp === "ась" && base.endsWith("ся")) return base.slice(0, -2) + grp;
    return base + grp;
  });
}
export function fmt(s, text) {
  const L = s.life; if (!L) return text;
  const sp = L.spouse ? (L.spouse.gender === "m" ? "Супруг" : "Супруга") : "Супруг(а)";
  return gtext(text.replaceAll("{Spouse}", sp), L.gender);
}
export function logLine(s, msg, kind = "info") {
  const L = s.life; if (!L) return;
  L.chronicle.push({ age: L.age, msg: fmt(s, msg), kind });
  if (L.chronicle.length > 400) L.chronicle.splice(0, L.chronicle.length - 400);
}

function rollRoot(data, rng, elementsFrom = null) {
  const root = wpick(data.world.roots, rng);
  const elements = root.special ? [pick(root.special, rng)]
    : [...data.world.elements].sort(() => rng() - 0.5).slice(0, root.count);
  return { root, elements };
}

export function rollBirth(data, rng, heir = null) {
  const W = data.world, wl = W.life;
  let gender, region, wealth, rootId, elements, surname, given, generation = 1, odds = null, era, startAge = 0, physique;
  if (heir) {
    const { entry, child } = heir;
    gender = child.gender; surname = entry.surname; given = child.name.split(" ").slice(1).join(" ");
    region = by(W.regions, entry.regionId); generation = entry.generation + 1;
    era = by(W.eras, entry.eraId) || W.eras.find(e => e.name === entry.eraName) || wpick(W.eras, rng);
    const floor = wl.heirWealthFloor[Math.min(entry.realmIndex, wl.heirWealthFloor.length - 1)];
    wealth = W.wealth[Math.max(W.wealth.findIndex(w => w.id === entry.wealthId), floor)];
    rootId = child.rootId; elements = [...child.elements];
    startAge = Math.max(0, Math.floor(Number(child.age) || 0));
    physique = by(W.physiques, child.physiqueId) || wpick(W.physiques, rng);
  } else {
    gender = rng() < 0.5 ? "m" : "f";
    region = wpick(W.regions, rng); wealth = wpick(W.wealth, rng); era = wpick(W.eras, rng);
    physique = wpick(W.physiques, rng);
    rootId = null; elements = [];
    surname = pick(W.names.surnames, rng); given = pick(W.names[gender], rng);
    const p = (region.weight / sum(W.regions)) * (era.weight / sum(W.eras)) * (wealth.weight / sum(W.wealth)) * (physique.weight / sum(W.physiques));
    odds = Math.round(1 / p);
  }
  const root = rootId ? by(W.roots, rootId) : { qiMult: 1 };
  const awakened = startAge >= W.time.awakeningAge;
  return {
    name: `${surname} ${given}`, surname, gender, regionId: region.id, eraId: era.id, wealthId: wealth.id,
    physiqueId: physique.id,
    rootId, elements, rootRevealed: awakened, qiMult: (root.qiMult || 1) * era.qiMult * region.qiMult * (physique.qiMult || 1),
    baseLife: wl.mortalBase + wealth.lifeBonus + (physique.lifeBonus || 0) + Math.round((rng() - 0.5) * 2 * wl.mortalSpread),
    age: startAge, yearAcc: 0, awakened, alive: true, ageShift: 0, legacyBonus: 0,
    stats: { daoHeart: 0, karma: 0, connections: 0 },
    pending: null, usedEvents: [], lastEventAge: startAge - (W.time.minEventGapYears || 2), recentFlavor: [],
    spouse: null, children: [], chronicle: [], generation, odds, mercy: false, legacy: null,
    jobId: null, focusId: startAge >= 16 ? "work" : "family",
    phase: "birth", pendingRoot: false, household: null, peers: null,
  };
}

export function startLife(data, s, mode = "new", rng = Math.random, childIdx = 0) {
  const prev = s.lineage[s.lineage.length - 1];
  const child = mode === "heir" && prev ? prev.children[childIdx] : null;
  const keep = { lineage: s.lineage, settings: s.settings };
  Object.assign(s, newState(), keep);
  s.life = rollBirth(data, rng, child ? { entry: prev, child } : null);
  const L = s.life, W = data.world, wealth = by(W.wealth, L.wealthId);
  L.mercy = W.life.mercyFirstLife && s.lineage.length === 0;
  s.spiritStones = wealth.stones;
  if (child) {
    s.spiritStones += Math.floor(prev.stonesLeft * W.life.heirStoneShare) + prev.legacyBonus * W.life.legacyStones;
    L.stats.daoHeart = Math.floor(prev.daoHeart * W.life.heirTraitShare);
    L.stats.connections = Math.max(0, Math.floor(prev.connections * W.life.heirTraitShare));
    if (L.age >= (data.jobs?.workAge || 12)) {
      const d = defaultJob(data, s);
      if (d) L.jobId = d.id;
    }
    const span = lifespan(data, s);
    if (L.age >= span) L.age = Math.max(0, span - 1);
    L.phase = "play";
  } else {
    L.household = makeHousehold(data, s, rng);
    L.peers = makePeers(data, s, rng);
    L.phase = "spinRegion";
  }
  const odds = L.odds ? ` Такая судьба выпадает 1 из ${L.odds.toLocaleString("ru-RU")}.` : "";
  if (child) {
    logLine(s, `Продолжение рода: ${L.name}, ${L.age} лет — не с пелёнок. Дом после ${prev.name}. ${by(W.regions, L.regionId).name}, ${wealth.name}.${L.awakened ? " Корни уже открыты: " + rootText(data, L) + "." : ""}`, "birth");
  } else {
    logLine(s, `Новая судьба: родился(ась) ${L.name} — ${by(W.regions, L.regionId).name}, ${by(W.eras, L.eraId).name}, ${wealth.name}.${odds}`, "birth");
  }
  return s;
}

function makeHousehold(data, s, rng) {
  const L = s.life, W = data.world;
  const jobs = (data.jobs?.jobs || []).filter(j => j.id !== "home" && !j.awakened && (!j.region || j.region.includes(L.regionId)));
  const pool = jobs.length ? jobs : (data.jobs?.jobs || [{ id: "field", name: "Поле" }]);
  const momAge = 19 + Math.floor(rng() * 20);
  const dadAge = Math.max(20, momAge + Math.floor(rng() * 10) - 2);
  const nSib = rng() < 0.35 ? 0 : 1 + Math.floor(rng() * 3);
  const sibs = [];
  for (let i = 0; i < nSib; i++) {
    const g = rng() < 0.5 ? "m" : "f";
    const sib = generatePerson(data, rng, {
      gender: g,
      surname: L.surname,
      age: 1 + Math.floor(rng() * 14),
      regionId: L.regionId,
      wealthId: L.wealthId,
      noRoot: true, // братья/сёстры не имеют корней до проверки
    });
    sibs.push({
      name: sib.name,
      gender: g,
      age: sib.age,
      rel: rng() < 0.5 ? "старш." : "младш.",
      physiqueName: sib.physiqueName,
      wealthName: sib.wealthName,
      stats: sib.stats,
    });
  }
  sibs.sort((a, b) => b.age - a.age);
  
  // Мать - всегда другая фамилия
  const mother = generatePerson(data, rng, {
    gender: "f",
    age: momAge,
    regionId: L.regionId,
    wealthId: L.wealthId,
    noRoot: true,
  });
  
  // Отец - та же фамилия, что у игрока
  const father = generatePerson(data, rng, {
    gender: "m",
    surname: L.surname,
    age: dadAge,
    regionId: L.regionId,
    wealthId: L.wealthId,
    noRoot: true,
  });
  
  return {
    mother: { name: mother.name, age: momAge, job: pick(pool, rng).name, physiqueName: mother.physiqueName, stats: mother.stats },
    father: { name: father.name, age: dadAge, job: pick(pool, rng).name, physiqueName: father.physiqueName, stats: father.stats },
    siblings: sibs,
    house: by(W.wealth, L.wealthId).id === "poor" ? "лачуга внаймы" : by(W.wealth, L.wealthId).id === "noble" || by(W.wealth, L.wealthId).id === "cultclan" ? "свой двор" : "свой дом",
  };
}
function makePeers(data, s, rng) {
  const W = data.world, out = [];
  for (let i = 0; i < 4; i++) {
    const peer = generatePerson(data, rng, {
      age: s.life.age + Math.floor((rng() - 0.5) * 6),
    });
    out.push({
      name: peer.name,
      gender: peer.gender,
      region: peer.regionName,
      wealth: peer.wealthName,
      physiqueName: peer.physiqueName,
      stats: peer.stats,
      rootId: peer.rootId,
      elements: peer.elements,
    });
  }
  return out;
}
export function birthBlurb(data, s) {
  const L = s.life, W = data.world;
  const region = by(W.regions, L.regionId), wealth = by(W.wealth, L.wealthId), phy = by(W.physiques, L.physiqueId);
  const era = by(W.eras, L.eraId), h = L.household;
  const who = L.gender === "m" ? "мальчиком" : "девочкой";
  const sib = h?.siblings?.length
    ? ` В доме уже ${h.siblings.map(x => `${x.rel} ${x.gender === "m" ? "брат" : "сестра"} ${x.name.split(" ").pop()}, ${x.age} лет${x.physiqueName ? `, телосложение «${x.physiqueName}»` : ""}`).join("; ")}.`
    : " Ты первый ребёнок в этом дворе.";
  return gtext(`В ${era.name} ты родился(ась) ${who}, телосложение «${phy.name}»（${phy.han}）, ${region.kind} — ${region.name}（${region.han}）. Семья: ${wealth.name.toLowerCase()}. Мать ${h?.mother.name}, ${h?.mother.age} лет, ${h?.mother.job}; отец ${h?.father.name}, ${h?.father.age} лет, ${h?.father.job}.${sib} Корни ещё спят: проверка в ${W.time.awakeningAge} лет.`, L.gender);
}
export function acceptBirth(s) {
  if (!s.life || s.life.phase === "play") return;
  s.life.phase = "play";
}
export function finishRoot(data, s, rng = Math.random) {
  const L = s.life, W = data.world;
  if (!L || L.rootRevealed) return L;
  const r = rollRoot(data, rng);
  L.rootId = r.root.id; L.elements = r.elements; L.rootRevealed = true; L.awakened = true; L.pendingRoot = false;
  const phy = by(W.physiques, L.physiqueId), region = by(W.regions, L.regionId), era = by(W.eras, L.eraId);
  L.qiMult = r.root.qiMult * era.qiMult * region.qiMult * (phy?.qiMult || 1);
  const p = r.root.weight / sum(W.roots);
  L.rootOdds = Math.round(1 / p);
  logLine(s, `Проверка корней в ${L.age} лет: ${rootText(data, L)}. Такая жила выпадает 1 из ${L.rootOdds}. Путь открыт.`, "awaken");
  return L;
}
export function autoCultivate(data, s, rng = Math.random) {
  const L = s.life;
  if (!L?.alive || L.phase !== "play" || L.pending || L.pendingRoot || !L.awakened) return;
  if (!G.canBreakthrough(data, s)) {
    const price = G.pillPrice(data, s);
    if (s.pills < 1 && s.spiritStones >= price && G.breakthroughChance(data, s, false) < 0.45) G.buyPill(data, s);
    return;
  }
  const raw = G.breakthroughChance(data, s, false), pill = G.breakthroughChance(data, s, true);
  const usePill = s.pills >= 1 && (raw < 0.4 || pill - raw >= 0.12);
  const r = G.breakthrough(data, s, usePill, rng);
  logLine(s, "Авто: " + r.msg, "cult");
}

export function lifespan(data, s) {
  const L = s.life;
  const base = L.awakened ? Math.max(L.baseLife, data.realms.realms[s.realmIndex].maxAge) : L.baseLife;
  return base + L.ageShift;
}
export function rootText(data, L) { return `${by(data.world.roots, L.rootId).name} (${L.elements.join(", ")})`; }
export const childAge = (s, c) => s.life.age - c.born;

// Генерация NPC с уникальными характеристиками
function generatePerson(data, rng, options = {}) {
  const W = data.world;
  const gender = options.gender ?? (rng() < 0.5 ? "m" : "f");
  const surname = options.surname ?? pick(W.names.surnames, rng);
  const given = options.given ?? pick(W.names[gender], rng);
  const age = options.age ?? 20 + Math.floor(rng() * 40);
  const region = options.regionId ? by(W.regions, options.regionId) : wpick(W.regions, rng);
  const wealth = options.wealthId ? by(W.wealth, options.wealthId) : wpick(W.wealth, rng);
  const physique = options.physiqueId ? by(W.physiques, options.physiqueId) : wpick(W.physiques, rng);

  // Корни (с шансом 30% если не заданы явно)
  let rootId = options.rootId;
  let elements = options.elements || [];
  if (!rootId && !options.noRoot && rng() < 0.3) {
    const r = rollRoot(data, rng);
    rootId = r.root.id;
    elements = r.elements;
  }

  // Характеристики
  const stats = {
    daoHeart: options.daoHeart ?? Math.floor(rng() * 5),
    karma: options.karma ?? Math.floor((rng() - 0.5) * 6),
    connections: options.connections ?? Math.floor(rng() * 8),
  };

  return {
    name: `${surname} ${given}`,
    surname,
    given,
    gender,
    age,
    regionId: region.id,
    regionName: region.name,
    wealthId: wealth.id,
    wealthName: wealth.name,
    physiqueId: physique.id,
    physiqueName: physique.name,
    rootId,
    elements,
    stats,
    jobId: options.jobId,
  };
}

// Проверка на инцест: супруг не должен быть родственником по крови
function isRelatedByBlood(L, spouseSurname, forbiddenSurnames = []) {
  // Проверяем фамилию супруга против фамилии игрока и родственников
  if (spouseSurname === L.surname) return true;
  
  // Проверяем против запрещённых фамилий (родственники)
  if (forbiddenSurnames.includes(spouseSurname)) return true;
  
  return false;
}

function parentWords(L) {
  return L.gender === "m"
    ? { P: "Отец", Pd: "отцу", was: "был", he: "он", He: "Он", him: "ему", a: "" }
    : { P: "Мать", Pd: "матери", was: "была", he: "она", He: "Она", him: "ей", a: "а" };
}
function finalWords(data, s, rng) {
  const L = s.life, st = L.stats, Q = data.world.quotes, kids = L.children.filter(c => c.alive);
  if (!kids.length) return [{ who: "", text: pick(Q.none, rng) }];
  const keys = [];
  if (st.karma >= 5) keys.push("kind"); if (st.karma <= -4) keys.push("harsh");
  if (st.daoHeart >= 5) keys.push("dao"); if (st.connections >= 6) keys.push("social");
  if (!keys.length) keys.push("plain");
  const w = parentWords(L);
  return kids.slice(0, 3).map(c => ({
    who: `${c.name}, ${c.gender === "m" ? "сын" : "дочь"}`,
    text: pick(Q[pick(keys, rng)], rng).replace(/\{(\w+)\}/g, (m, k) => w[k] ?? m),
  }));
}
function epitaph(data, s) {
  const L = s.life, st = L.stats, r = data.realms.realms[s.realmIndex];
  const a = st.karma >= 6 ? "Добром поминали и через поколения." : st.karma <= -6 ? "О нём вспоминали с опаской." : "Прожил(а) жизнь, не веря ни славе, ни позору.";
  const b = L.awakened ? `Дошёл(ла) до ступени «${r.name}», слой ${s.layer}.` : "Так и не ступил(а) на Путь.";
  const c = st.connections >= 8 ? " Провожали сотни людей." : st.daoHeart >= 6 ? " Сердце было твёрже нефрита." : "";
  return fmt(s, `${a} ${b}${c}`);
}

export function die(data, s, cause, rng = Math.random) {
  const L = s.life; if (!L.alive) return;
  L.alive = false; L.pending = null;
  const kids = L.children.filter(c => c.alive).map(c => ({ name: c.name, gender: c.gender, rootId: c.rootId, elements: c.elements, age: childAge(s, c) }));
  const entry = {
    name: L.name, surname: L.surname, gender: L.gender, generation: L.generation, ageAtDeath: L.age, cause: fmt(s, cause),
    rootName: L.awakened ? rootText(data, L) : "не проверены", regionId: L.regionId, wealthId: L.wealthId,
    regionName: by(data.world.regions, L.regionId).name, eraId: L.eraId, eraName: by(data.world.eras, L.eraId).name,
    realmIndex: s.realmIndex, layer: s.layer, realmName: L.awakened ? data.realms.realms[s.realmIndex].name : "—",
    stonesLeft: s.spiritStones, legacyBonus: L.legacyBonus, awakened: L.awakened, odds: L.odds,
    daoHeart: L.stats.daoHeart, karma: L.stats.karma, connections: L.stats.connections,
    spouseName: L.spouse ? L.spouse.name : null, children: kids,
    epitaph: epitaph(data, s), words: finalWords(data, s, rng),
  };
  L.legacy = entry; s.lineage.push(entry);
  s.lineage = s.lineage.slice(-data.world.life.lineageKeep);
  logLine(s, `Смерть в ${L.age} лет. ${entry.cause}.`, "death");
}

function matches(data, s, r = {}) {
  const L = s.life;
  if (r.wealth && !r.wealth.includes(L.wealthId)) return false;
  if (r.region && !r.region.includes(L.regionId)) return false;
  if (r.era && !r.era.includes(L.eraId)) return false;
  if (r.awakened != null && r.awakened !== L.awakened) return false;
  if (r.minRealm != null && s.realmIndex < r.minRealm) return false;
  if (r.maxRealm != null && s.realmIndex > r.maxRealm) return false;
  if (r.married != null && r.married !== !!L.spouse) return false;
  if (r.single != null && r.single !== !L.spouse) return false;
  if (r.hasChildren && !L.children.some(c => c.alive)) return false;
  if (r.elder && L.age < 0.7 * lifespan(data, s)) return false;
  return true;
}
function eligible(data, s, e) {
  const L = s.life;
  return L.age >= e.minAge && L.age <= e.maxAge && !L.usedEvents.includes(e.id) && matches(data, s, e.requires);
}
export function drawEvent(data, s, rng = Math.random) {
  const list = data.events.events.filter(e => eligible(data, s, e));
  return list.length ? wpick(list, rng) : null;
}
function flavor(data, s, rng) {
  const L = s.life;
  const list = data.chronicle.lines.filter((l, i) => L.age >= l.a[0] && L.age <= l.a[1] && !L.recentFlavor.includes(i) && matches(data, s, l.r));
  if (!list.length) return;
  const line = wpick(list, rng), idx = data.chronicle.lines.indexOf(line);
  L.recentFlavor.push(idx); if (L.recentFlavor.length > 10) L.recentFlavor.shift();
  logLine(s, line.t, "year");
}

function makeChild(data, s, rng) {
  const L = s.life, W = data.world, gender = rng() < 0.5 ? "m" : "f";
  let rootId, elements;
  if (rng() < W.life.rootInheritChance) { rootId = L.rootId; elements = [...L.elements]; }
  else { const r = rollRoot(data, rng); rootId = r.root.id; elements = r.elements; }
  
  const child = generatePerson(data, rng, {
    gender,
    surname: L.surname,
    age: 0,
    regionId: L.regionId,
    wealthId: L.wealthId,
    physiqueId: L.physiqueId,
    rootId,
    elements,
    noRoot: true, // корни будут заданы явно
  });
  
  return { 
    name: child.name, 
    gender, 
    born: L.age, 
    rootId, 
    elements, 
    alive: true, 
    task: "home", 
    physiqueId: L.physiqueId,
    physiqueName: child.physiqueName,
    stats: child.stats,
  };
}
export function jobById(data, id) {
  return data.jobs?.jobs.find(x => x.id === id);
}
export function jobEligible(data, s, job, who = "self") {
  const L = s.life; if (!job || !L) return false;
  const age = who === "self" ? L.age : (L.spouse ? 20 : 0);
  if (age < (data.jobs.workAge || 12) && job.id !== "home") return false;
  if (job.region && !job.region.includes(L.regionId)) return false;
  if (job.wealth && !job.wealth.includes(L.wealthId) && job.id !== "home") return false;
  if (job.awakened && (who !== "self" || !L.awakened)) return false;
  return true;
}
export function setFocus(data, s, id) {
  const f = data.jobs?.focuses?.find(x => x.id === id);
  if (!f) return { ok: false, msg: "Нет такого фокуса." };
  if (s.life.focusId === id) return { ok: true };
  s.life.focusId = id;
  logLine(s, `Этот год: ${f.name}. ${f.text}`, "family");
  return { ok: true };
}
export function setChildTask(data, s, idx, task) {
  const c = s.life.children[idx];
  if (!c?.alive) return { ok: false, msg: "Нет такого ребёнка." };
  if (!(data.jobs?.childTasks || []).some(t => t.id === task)) return { ok: false, msg: "Нет такого занятия." };
  c.task = task;
  const names = { home: "остаётся дома", help: "помогает по дому", letters: "учит грамоту" };
  logLine(s, `${c.name} ${names[task] || task}.`, "family");
  return { ok: true };
}
export function defaultJob(data, s) {
  const list = (data.jobs?.jobs || []).filter(j => jobEligible(data, s, j));
  const byRegion = { huangfeng: "field", haiyun: "fisher", hanmu: "herder", qinglong: "woodcutter", penglai: "penglai_keeper" };
  const pref = { poor: "beggar", peasant: byRegion[s.life.regionId] || "porter", craft: "stall", noble: "scribe", cultclan: "home" }[s.life.wealthId];
  return list.find(j => j.id === pref) || list.find(j => j.id === "porter") || list[0] || null;
}
export function setJob(data, s, id, who = "self") {
  const job = jobById(data, id); if (!job || !jobEligible(data, s, job, who)) return { ok: false, msg: "Это ремесло здесь не возьмут." };
  if (who === "spouse" && s.life.spouse?.jobId === id) return { ok: true };
  if (who !== "spouse" && s.life.jobId === id) return { ok: true };
  if (who === "spouse") {
    if (!s.life.spouse) return { ok: false, msg: "Нет супруга." };
    s.life.spouse.jobId = id;
    const took = s.life.spouse.gender === "m" ? "взял" : "взяла";
    logLine(s, `${s.life.spouse.gender === "m" ? "Супруг" : "Супруга"} ${took} работу: ${job.name}.`, "family");
  } else {
    s.life.jobId = id;
    logLine(s, `Ты взял(а) работу: ${job.name}.`, "family");
  }
  return { ok: true };
}

function makeSpouse(data, s, type, rng) {
  const L = s.life, W = data.world, gender = L.gender === "m" ? "f" : "m";
  const job = defaultJob(data, s);
  
  // Собираем запрещённые фамилии (родственники)
  const forbiddenSurnames = [L.surname];
  if (L.household?.mother) {
    forbiddenSurnames.push(L.household.mother.name.split(" ")[0]);
  }
  if (L.household?.siblings) {
    L.household.siblings.forEach(sib => {
      // Сёстры/братья имеют ту же фамилию, но для расчёта всё равно
    });
  }
  
  // Генерируем супруга с проверкой на инцест
  let spouse;
  let attempts = 0;
  do {
    spouse = generatePerson(data, rng, {
      gender,
      regionId: L.regionId,
      wealthId: L.wealthId,
      noRoot: true,
    });
    attempts++;
  } while (isRelatedByBlood(L, spouse.surname, forbiddenSurnames) && attempts < 20);
  
  return { 
    name: spouse.name, 
    surname: spouse.surname,
    gender, 
    type, 
    jobId: job?.id || "home",
    physiqueName: spouse.physiqueName,
    stats: spouse.stats,
  };
}

function applyEffects(data, s, ef = {}, rng = Math.random) {
  const L = s.life, st = L.stats;
  if (ef.stones) s.spiritStones = Math.max(0, s.spiritStones + ef.stones);
  if (ef.pill) s.pills += ef.pill;
  if (ef.qiPct) s.qi = clamp(s.qi + ef.qiPct * G.qiRequired(data, s), 0, G.qiRequired(data, s));
  if (ef.daoHeart) st.daoHeart = clamp(st.daoHeart + ef.daoHeart, -5, 20);
  if (ef.karma) st.karma = clamp(st.karma + ef.karma, -20, 20);
  if (ef.connections) st.connections = clamp(st.connections + ef.connections, 0, 30);
  if (ef.years) L.ageShift += ef.years;
  if (ef.legacy) L.legacyBonus += ef.legacy;
  if (ef.spouse && !L.spouse) {
    L.spouse = makeSpouse(data, s, ef.spouse, rng);
    const how = { love: "по любви", arranged: "по воле семьи", companion: "как даолюй" }[ef.spouse];
    logLine(s, `Ты сочетался(ась) браком ${how}: ${L.spouse.name}.`, "family");
  }
  if (ef.childDeath) {
    const kid = [...L.children].reverse().find(c => c.alive);
    if (kid) { kid.alive = false; logLine(s, `Умер(ла) твой ребёнок ${kid.name}. Дом на время стал тише.`, "family"); }
  }
  if (ef.death) {
    if (L.mercy && !L.awakened) logLine(s, "Беда прошла мимо: небо хранит тебя.", "luck");
    else die(data, s, ef.death, rng);
  }
}

export function chooseOption(data, s, idx, rng = Math.random) {
  const L = s.life, e = by(data.events.events, L.pending), c = e && e.choices[idx];
  if (!c) return { ok: false, msg: "Нет такого выбора." };
  if (c.minStones && s.spiritStones < c.minStones) return { ok: false, msg: "Не хватает камней." };
  const parts = [c.text];
  applyEffects(data, s, c.effects, rng);
  if (c.bonus && rng() < c.bonus.p) { parts.push(c.bonus.text); applyEffects(data, s, c.bonus.effects, rng); }
  if (c.risk && L.alive && rng() < c.risk.p) { parts.push(c.risk.text); applyEffects(data, s, c.risk.effects, rng); }
  L.usedEvents.push(e.id); L.lastEventAge = L.age; L.pending = null;
  const out = `«${fmt(s, e.title)}» — ${c.label.toLowerCase()}. ${parts.join(" ")}`;
  if (L.alive) logLine(s, out, "event");
  return { ok: true, msg: fmt(s, out), died: !L.alive };
}

// Автовыбор по склонности: оценка ожидаемого исхода (эффекты + вероятностные бонусы и риски).
const WEIGHTS = {
  virtue: ef => (ef.karma || 0) * 3 + (ef.connections || 0) * 0.7 + (ef.death ? -100 : 0),
  dao: ef => (ef.daoHeart || 0) * 3 + (ef.qiPct || 0) * 10 + (ef.years || 0) * 0.4 + (ef.legacy || 0) + (ef.death ? -100 : 0),
  wealth: ef => (ef.stones || 0) * 0.7 + (ef.connections || 0) * 1.5 + (ef.pill || 0) * 3 + (ef.death ? -100 : 0),
  safe: ef => (ef.years || 0) * 0.5 + (ef.karma || 0) * 0.5 + (ef.stones || 0) * 0.1 + (ef.qiPct || 0) * 3 + (ef.death ? -100 : 0) + (ef.childDeath ? -30 : 0),
  best: ef => (ef.years || 0) * 2 + (ef.qiPct || 0) * 12 + (ef.daoHeart || 0) * 2 + (ef.stones || 0) * 0.5 + (ef.pill || 0) * 4 + (ef.legacy || 0) * 2 + (ef.karma || 0) * 0.4 + (ef.connections || 0) * 0.6 + (ef.spouse ? 6 : 0) + (ef.death ? -200 : 0) + (ef.childDeath ? -40 : 0),
};
function choiceScore(c, mode) {
  const f = WEIGHTS[mode];
  const riskN = (mode === "safe" || mode === "best") ? 3 : 1;
  return f(c.effects || {}) + (c.bonus ? c.bonus.p * f(c.bonus.effects) : 0) + (c.risk ? c.risk.p * f(c.risk.effects) * riskN : 0);
}
export function autoChoose(data, s, mode, rng = Math.random) {
  const e = by(data.events.events, s.life.pending);
  const use = WEIGHTS[mode] ? mode : "best";
  if (!e || !WEIGHTS[use]) return null;
  let best = [], top = -Infinity;
  e.choices.forEach((c, i) => {
    if (c.minStones && s.spiritStones < c.minStones) return;
    const sc = choiceScore(c, use);
    if (sc > top + 1e-9) { top = sc; best = [i]; } else if (Math.abs(sc - top) < 1e-9) best.push(i);
  });
  if (!best.length) return null;
  return chooseOption(data, s, pick(best, rng), rng);
}

function yearPass(data, s, rng) {
  const L = s.life, W = data.world, T = W.time, wl = W.life;
  L.age += 1;
  if (!L.awakened && !L.rootRevealed && L.age >= T.awakeningAge) {
    L.pendingRoot = true;
    return;
  }
  const J = data.jobs;
  if (J && L.age === J.workAge && !L.jobId) {
    const d = defaultJob(data, s);
    if (d) { L.jobId = d.id; logLine(s, `В ${L.age} лет ты встал(а) к делу: ${d.name}.`, "family"); }
  }
  const focus = (J?.focuses || []).find(x => x.id === L.focusId) || J?.focuses?.[0];
  if (J && L.age >= J.workAge) {
    const own = jobById(data, L.jobId), sp = L.spouse && jobById(data, L.spouse.jobId);
    let pay = (own?.stones || 0) + (sp?.stones || 0);
    pay += L.children.filter(c => c.alive && childAge(s, c) >= J.childHelpAge && c.task === "help").length * (J.childHelpStones || 0);
    pay = Math.round(pay * (focus?.payMul ?? 1));
    if (pay) s.spiritStones += pay;
    if (pay && L.age % 5 === 0) logLine(s, `Год работы (${focus?.name || "дом"}): ${pay} камней.`, "family");
  }
  for (const c of L.children) {
    if (c.alive && c.task === "letters" && childAge(s, c) >= 6 && rng() < 0.12) {
      L.stats.connections = clamp(L.stats.connections + 1, 0, 30);
      logLine(s, `${c.name} вывел(а) новый иероглиф. В доме стало тише и светлее.`, "family");
    }
  }
  if (L.spouse && rng() < wl.spouseDeathHazard + (L.age > 80 ? 0.02 : 0)) {
    const sp = L.spouse;
    logLine(s, `${sp.gender === "m" ? "Умер твой супруг" : "Умерла твоя супруга"} ${sp.name}. ${L.gender === "m" ? "Ты остался один." : "Ты осталась одна."}`, "family");
    L.spouse = null;
  }
  const [b0, b1] = wl.childBirthAges ?? [20, 50];
  if (L.spouse && L.age >= b0 && L.age <= b1 && L.children.length < wl.childMax && rng() < wl.childBirthChance * (focus?.birthMul ?? 1)) {
    const kid = makeChild(data, s, rng); L.children.push(kid);
    logLine(s, `В семье ${kid.gender === "m" ? "родился сын" : "родилась дочь"} — ${kid.name}.`, "family");
  }
  const wealth = by(W.wealth, L.wealthId);
  for (const c of L.children) if (c.alive && childAge(s, c) < 16 && rng() < wealth.hazard * 0.8) {
    c.alive = false; logLine(s, `Умер(ла) твой ребёнок ${c.name}: детская лихорадка не пощадила.`, "family");
  }
  const jobHaz = (jobById(data, L.jobId)?.hazard || 0) + (L.spouse ? (jobById(data, L.spouse.jobId)?.hazard || 0) * 0.3 : 0);
  const yishu = G.slottedTechs(data, s).yishu;
  const phy = by(W.physiques, L.physiqueId);
  let hz = (wealth.hazard + jobHaz) * by(W.regions, L.regionId).hazardMult * by(W.eras, L.eraId).hazardMult * (focus?.hazardMul ?? 1) * (phy?.hazard || 1) * (1 - (yishu?.hazardCut || 0));
  if (L.awakened) hz *= wl.awakenedHazardMult * Math.pow(0.5, s.realmIndex);
  if (L.age < 5) hz *= wl.infantHazardMult;
  const span = lifespan(data, s);
  if (L.age >= span) return die(data, s, "Дожил(а) отведённый срок", rng);
  if (rng() < hz) {
    if (L.mercy && !L.awakened) logLine(s, "Беда прошла мимо: небо хранит тебя.", "luck");
    else return die(data, s, pick(W.deathCauses[L.age < T.awakeningAge ? "child" : "adult"], rng), rng);
  }
  if (L.age >= wl.oldAgeStart * span && rng() < wl.oldAgeHazard) return die(data, s, "Ушёл(ла) от старости", rng);
  if (rng() < T.chronicleChance) flavor(data, s, rng);
  if (L.age - L.lastEventAge >= T.minEventGapYears && rng() < T.eventChancePerYear) {
    const e = drawEvent(data, s, rng); if (e) L.pending = e.id;
  }
}

function yearLength(T, age) {
  return T.yearSeconds * (age < T.awakeningAge ? T.childhoodShare : 1);
}
function advanceClock(data, s, seconds) {
  s.clockMs += seconds * 1000;
  if (s.life.awakened) G.tick(data, s, s.clockMs); else s.lastTick = s.clockMs;
}
// Хук после каждого года (авторежим: прорывы, техники, фокус). Логика хука живёт в auto.js.
let yearHook = null;
export function setYearHook(fn) { yearHook = fn; }
function afterYear(data, s, rng) {
  const L = s.life;
  if (yearHook && L.alive && !L.pending && !L.pendingRoot) yearHook(data, s, rng);
}
function consumeYear(data, s, rng) {
  const T = data.world.time, L = s.life;
  const yl = yearLength(T, L.age);
  advanceClock(data, s, yl);
  yearPass(data, s, rng);
  afterYear(data, s, rng);
}

export function lifeTick(data, s, now = Date.now(), rng = Math.random) {
  const L = s.life, T = data.world.time;
  if (!L || !L.alive || L.pending || L.pendingRoot || L.phase !== "play") { s.lastReal = now; return s; }
  if (s.lastReal == null) s.lastReal = now;
  const real = clamp((now - s.lastReal) / 1000, 0, T.maxCatchUpSec); s.lastReal = now;
  const sp = T.speeds[s.settings.speed] ?? T.speeds.normal;
  if (sp.untilEvent) {
    const cap = T.skipCapYears ?? 500;
    for (let n = 0; L.alive && !L.pending && !L.pendingRoot && n < cap; n++) consumeYear(data, s, rng);
    L.yearAcc = 0;
    return s;
  }
  const dt = real * (sp.factor ?? 1);
  if (dt <= 0) return s;
  advanceClock(data, s, dt);
  L.yearAcc += dt;
  while (L.alive && !L.pending && !L.pendingRoot) {
    const yl = yearLength(T, L.age);
    if (L.yearAcc < yl) break;
    L.yearAcc -= yl;
    yearPass(data, s, rng);
    afterYear(data, s, rng);
  }
  return s;
}
