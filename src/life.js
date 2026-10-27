// Жизнь культиватора: рождение-лотерея, годы, летопись, карточки выбора, семья, смерть, наследие.
// Формулы:
//   qiMult жизни = root.qiMult * era.qiMult * region.qiMult   (множитель медитации)
//   максимальный возраст: смертный = mortalBase + wealth.lifeBonus ± spread;
//                         после пробуждения — плавно по слоям к realm.maxAge ступени; плюс ageShift от событий
//   старость: с 78% срока риск 1% + 30% × x², x = доля пути от 78% до 100%
//   риск смерти в год = wealth.hazard * region.hazardMult * era.hazardMult * 0.4 (после пробуждения)
//                       * 0.5^realmIndex * (2 до 5 лет); после 90% срока +6%/год («старость»)
//   время: dt_игры = dt_реальное * speed.factor (0 = пауза); untilEvent — сразу до карточки или смерти
//   год = yearSeconds игровых секунд (детство в 0.15 раза)
import { newState } from "./state.js";
import * as G from "./game.js";

const pick = (a, rng) => a[Math.floor(rng() * a.length)];
// Вес: weight (миры, события) или w (строки летописи). Раньше у летописи читался weight → NaN → всегда последняя строка.
const wOf = x => x.weight ?? x.w ?? 1;
function wpick(items, rng) {
  let r = rng() * items.reduce((t, x) => t + wOf(x), 0);
  for (const x of items) { r -= wOf(x); if (r < 0) return x; }
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

function rollSoul(data, rng) { return data.world.souls ? wpick(data.world.souls, rng) : null; }

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
    rootId = child.rootId; elements = [...(child.elements || [])];
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
  const root = rootId ? (by(W.roots, rootId) || { qiMult: 1 }) : { qiMult: 1 };
  const awakened = startAge >= W.time.awakeningAge;
  return {
    name: `${surname} ${given}`, surname, gender, regionId: region.id, eraId: era.id, wealthId: wealth.id,
    physiqueId: physique.id,
    rootId, elements, soulId: heir ? (heir.child.soulId ?? null) : null, rootRevealed: awakened, qiMult: (root.qiMult ?? 1) * era.qiMult * region.qiMult * (physique.qiMult || 1),
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
  s.familyTechs = child ? [...(prev.familyTechs || [])] : [];
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
    if (L.awakened) {
      if (!L.soulId) L.soulId = rollSoul(data, rng)?.id || null;
      // Ребёнок жил своей жизнью, пока ты играл(а) за родителя: путь, ступень, секта — его.
      if (child.awakened && child.pathId) { s.pathId = child.pathId; s.realmIndex = child.realmIndex || 0; s.layer = child.layer || 1; s.qi = Math.floor(child.qi || 0); }
      else s.pathId = bestPath(data, s);
      if (child.sect) L.sect = { id: child.sect, since: L.age };
    }
    if (child.spouse) L.spouse = { ...child.spouse };
    L.children = (child.kids || []).map(k => ({ ...k }));
    catchUpChildren(data, s, rng);
    const span = lifespan(data, s);
    if (L.age >= span) L.age = Math.max(0, span - 1);
    L.phase = "play";
  } else {
    L.household = makeHousehold(data, s, rng);
    L.peers = makePeers(data, s, rng);
    L.phase = "spinRegion";
    // Знатные и культиваторские дома хранят свои свитки: тайны клана с рождения в родовой библиотеке.
    const take = (gr, n) => { const p = data.techniques.techniques.filter(t => t.owner === "clan" && t.grade === gr);
      for (let i = 0; i < n && p.length; i++) s.familyTechs.push(p.splice(Math.floor(rng() * p.length), 1)[0].id); };
    if (wealth.id === "cultclan") { take("zhong", 2); take("shang", 1); }
    else if (wealth.id === "noble") take("zhong", 1);
  }
  const phyS = by(W.physiques, L.physiqueId);
  if (phyS?.start) for (const [k, v] of Object.entries(phyS.start)) L.stats[k] = (L.stats[k] || 0) + v;
  const odds = L.odds ? ` Такая судьба выпадает 1 из ${L.odds.toLocaleString("ru-RU")}.` : "";
  if (child) {
    logLine(s, `Продолжение рода: ${L.name}, ${L.age} лет — не с пелёнок. Дом после ${prev.name}. ${by(W.regions, L.regionId).name}, ${wealth.name}.${L.awakened ? " Корни уже открыты: " + rootText(data, L) + ". " + pathOf(data, s).name + ": «" + G.realmsOf(data, s)[s.realmIndex].name + "», слой " + s.layer + "." : ""}${L.spouse ? ` В доме ${L.spouse.gender === "m" ? "муж" : "жена"} ${L.spouse.name}.` : ""}${L.children.length ? ` Детей: ${L.children.length}.` : ""}${s.familyTechs.length ? ` Родовая библиотека: ${s.familyTechs.length} свитк.` : ""}`, "birth");
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
  // Душа проверяется тем же камнем. «Память без забвения» — не ниже «Ясной».
  if (!L.soulId) {
    let soul = rollSoul(data, rng);
    if (phy?.soulFloor && W.souls) {
      const floor = W.souls.findIndex(x => x.id === phy.soulFloor);
      if (W.souls.indexOf(soul) < floor) soul = W.souls[floor];
    }
    L.soulId = soul?.id || null;
  }
  s.pathId = bestPath(data, s);
  if (phy?.capAge) logLine(s, `Старейшина нащупал холод в жилах: «${phy.han}». Без ${phy.capLayer}-го слоя первой ступени дольше ${phy.capAge} лет не прожить. Путь — единственное лекарство.`, "death");
  const soul = W.souls?.find(x => x.id === L.soulId);
  const tail = r.root.qiMult > 0 ? "Путь ци открыт." : "Корней нет, как у большинства людей. Путь ци закрыт — но есть тело" + (soul?.mult ? " и душа." : ".");
  logLine(s, `Проверка корней в ${L.age} лет: ${rootText(data, L)}. Такая жила выпадает 1 из ${L.rootOdds}.${soul ? ` Душа: ${soul.name}（${soul.han}）.` : ""} ${tail}`, "awaken");
  return L;
}

// ───── Три пути ─────
export function pathOf(data, s) { return G.pathOf(data, s); }
// Варианты пути: [{path, ok, why, mult, score}]. Тело открыто всем; ци — с корнями; дух — с ясной душой.
export function pathOptions(data, s) {
  const L = s.life, W = data.world;
  const root = by(W.roots, L.rootId), soul = W.souls?.find(x => x.id === L.soulId);
  return (data.realms.paths || []).map(p => {
    const mult = G.pathMult(data, s, p.id);
    let ok = true, why = "";
    if (p.requires === "root" && !(root?.qiMult > 0)) { ok = false; why = "нет духовных корней"; }
    if (p.requires === "soul" && !(soul?.mult > 0)) { ok = false; why = "душа тусклая"; }
    // Вес выбора: тело — для тех, у кого корней нет или они слабые (5/4 корня); с тремя корнями и лучше — путь ци.
    const score = mult * (p.id === "body" ? 0.85 : p.id === "spirit" ? 1.2 : 1);
    return { path: p, ok, why, mult, score };
  });
}
export function bestPath(data, s) {
  const opts = pathOptions(data, s).filter(o => o.ok);
  if (!opts.length) return "body";
  return opts.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a)).path.id;
}
// Выбор пути — только на пороге (до первого прорыва).
export function choosePath(data, s, id) {
  const o = pathOptions(data, s).find(x => x.path.id === id);
  if (!o?.ok) return { ok: false, msg: o ? `Путь закрыт: ${o.why}.` : "Нет такого пути." };
  if (s.realmIndex > 0 || s.layer > 1) return { ok: false, msg: "Путь уже выбран: назад дороги нет." };
  s.pathId = id;
  logLine(s, `Ты вступил(а) на ${o.path.name}（${o.path.han}）. Первая ступень — «${o.path.realms[0].name}».`, "awaken");
  return { ok: true };
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

// «Девять тёмных жил»: потолок срока снимается, когда общий слой (ступень*9 + слой) дорос до capLayer.
function capLifted(data, s, phy) {
  return s.realmIndex * 9 + s.layer >= (phy.capLayer ?? 10);
}
export function lifespan(data, s) {
  const L = s.life;
  // Срок растёт по слоям: от потолка прошлой ступени к потолку текущей (realm.maxAge = срок на 9-м слое).
  // Первый слой первой ступени — почти смертный срок. Без культивации долгой жизни нет.
  let base = L.baseLife;
  if (L.awakened) {
    const rs = G.realmsOf(data, s), r = rs[s.realmIndex];
    const prev = s.realmIndex > 0 ? Math.max(L.baseLife, rs[s.realmIndex - 1].maxAge) : L.baseLife;
    const cur = Math.max(prev, r.maxAge);
    base = Math.round(prev + (cur - prev) * (s.layer / r.layers));
  }
  const phy = by(data.world.physiques, L.physiqueId);
  if (phy?.capAge && !capLifted(data, s, phy)) return Math.min(base, phy.capAge) + L.ageShift;
  return base + L.ageShift;
}
// Эффекты телосложения человеческим языком: [{t, good}]
export function physiqueEffects(p) {
  if (!p) return [];
  const out = [], pc = v => `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`, x = v => `×${+v.toFixed(2)}`;
  const add = (t, good) => out.push({ t, good });
  if (p.qiMult && p.qiMult !== 1) add(`ци ${x(p.qiMult)}`, p.qiMult > 1);
  if (p.breakAdd) add(`прорыв ${pc(p.breakAdd)}`, p.breakAdd > 0);
  if (p.lifeBonus) add(`срок ${p.lifeBonus > 0 ? "+" : "−"}${Math.abs(p.lifeBonus)} лет`, p.lifeBonus > 0);
  if (p.hazard && p.hazard !== 1) add(`беды ${pc(p.hazard - 1)}`, p.hazard < 1);
  if (p.hpMult && p.hpMult !== 1) add(`тело ${x(p.hpMult)}`, p.hpMult > 1);
  if (p.atkMult && p.atkMult !== 1) add(`удар ${x(p.atkMult)}`, p.atkMult > 1);
  if (p.defMult && p.defMult !== 1) add(`защита ${x(p.defMult)}`, p.defMult > 1);
  if (p.critAdd) add(`крит ${pc(p.critAdd)}`, p.critAdd > 0);
  if (p.pillMul && p.pillMul !== 1) add(`пилюли ${pc(p.pillMul - 1)}`, p.pillMul < 1);
  if (p.techCostMul && p.techCostMul !== 1) add(`техники ${pc(p.techCostMul - 1)}`, p.techCostMul < 1);
  if (p.payMul && p.payMul !== 1) add(`заработок ${pc(p.payMul - 1)}`, p.payMul > 1);
  if (p.spouseHazardMul && p.spouseHazardMul !== 1) add(`близкие гибнут ×${p.spouseHazardMul}`, false);
  if (p.birthMul && p.birthMul !== 1) add(`дети ${pc(p.birthMul - 1)}`, p.birthMul > 1);
  if (p.capAge) add(`без ${p.capLayer}-го слоя — не дольше ${p.capAge} лет`, false);
  const ST = { daoHeart: "дао-сердце", connections: "связи", karma: "карма" };
  for (const [k, v] of Object.entries(p.start || {})) add(`${ST[k] || k} ${v > 0 ? "+" : "−"}${Math.abs(v)}`, v > 0);
  return out;
}
export function rootText(data, L) {
  const r = by(data.world.roots, L.rootId);
  if (!r) return "не проверены";
  return L.elements?.length ? `${r.name} (${L.elements.join(", ")})` : r.name;
}
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
  // Дети не повторяют друг друга: сначала цитаты подходящих групп, потом «plain», без повторов.
  const pool = [...new Set([...keys.flatMap(k => Q[k] || []), ...(Q.plain || [])])], used = new Set();
  return kids.slice(0, 3).map(c => {
    const left = pool.filter(q => !used.has(q));
    const q = left.length ? pick(left, rng) : pick(pool, rng); used.add(q);
    return { who: `${c.name}, ${c.gender === "m" ? "сын" : "дочь"}`, text: q.replace(/\{(\w+)\}/g, (m, k) => w[k] ?? m) };
  });
}
function epitaph(data, s) {
  const L = s.life, st = L.stats, r = G.realmsOf(data, s)[s.realmIndex];
  const a = st.karma >= 6 ? "Добром поминали и через поколения." : st.karma <= -6 ? "О нём вспоминали с опаской." : "Прожил(а) жизнь, не веря ни славе, ни позору.";
  const b = L.awakened ? `Дошёл(ла) до ступени «${r.name}», слой ${s.layer}.` : "Так и не ступил(а) на Путь.";
  const c = st.connections >= 8 ? " Провожали сотни людей." : st.daoHeart >= 6 ? " Сердце было твёрже нефрита." : "";
  return fmt(s, `${a} ${b}${c}`);
}

export function die(data, s, cause, rng = Math.random) {
  const L = s.life; if (!L.alive) return;
  L.alive = false; L.pending = null;
  const kids = L.children.filter(c => c.alive).map(c => ({ ...c, age: childAge(s, c) })); // со всей прожитой жизнью: путь, ступень, брак, внуки
  const entry = {
    name: L.name, surname: L.surname, gender: L.gender, generation: L.generation, ageAtDeath: L.age, cause: fmt(s, cause),
    rootName: L.awakened ? rootText(data, L) : "не проверены", regionId: L.regionId, wealthId: L.wealthId,
    regionName: by(data.world.regions, L.regionId).name, eraId: L.eraId, eraName: by(data.world.eras, L.eraId).name,
    realmIndex: s.realmIndex, layer: s.layer, realmName: L.awakened ? G.realmsOf(data, s)[s.realmIndex].name : "—", pathId: s.pathId, pathName: L.awakened ? G.pathOf(data, s).name : "—",
    stonesLeft: s.spiritStones, legacyBonus: L.legacyBonus, awakened: L.awakened, odds: L.odds,
    daoHeart: L.stats.daoHeart, karma: L.stats.karma, connections: L.stats.connections,
    spouseName: L.spouse ? L.spouse.name : null, children: kids,
    epitaph: epitaph(data, s), words: finalWords(data, s, rng),
    familyTechs: [...new Set([...(s.familyTechs || []), ...s.ownedTechniques])],
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
  if (r.root && !r.root.includes(L.rootId)) return false;                              // корень: ["single","mutant",...]
  if (r.path && !(L.awakened && r.path.includes(s.pathId || "qi"))) return false;      // путь: ["qi","body","spirit"]
  if (r.noRoot != null && r.noRoot !== !(by(data.world.roots, L.rootId)?.qiMult > 0)) return false;
  if (r.minRealm != null && s.realmIndex < r.minRealm) return false;
  if (r.maxRealm != null && s.realmIndex > r.maxRealm) return false;
  if (r.married != null && r.married !== !!L.spouse) return false;
  if (r.single != null && r.single !== !L.spouse) return false;
  if (r.hasChildren && !L.children.some(c => c.alive)) return false;
  if (r.noSect && L.sect) return false;
  if (r.inSect && !L.sect) return false;
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

// ───── Дети живут своей жизнью, пока ты играешь за родителя ─────
//   16 лет: камень проверки (корни, душа) и путь — как у игрока (bestPath); у членов секты ребёнок с шансом 50% идёт туда же.
//   Рост за год: ци = qiPerSecond(его путь, тело, душа, лучшие свитки родовой библиотеки) × yearSeconds × CHILD_K
//                     + CHILD_A × ци до слоя (наставники, приключения); прорыв без пилюль, порог легенды дети не штурмуют.
//   Брак 18–40 лет — 9%/год; внуки 20–50 лет — 8%/год, до 3. Смерть: старость по сроку своей ступени + 0.4×беды дома.
const CHILD_K = 0.6, CHILD_A = 0.12;
function familyBest(data, s, cs) {
  const ids = new Set([...(s.familyTechs || []), ...(s.ownedTechniques || [])]);
  const pool = [...ids].map(id => G.techById(data, id)).filter(t => t && G.techUsable(data, cs, t) && (t.minRealm || 0) <= cs.realmIndex);
  const best = (type, f) => pool.filter(t => t.type === type).sort((a, b) => f(b) - f(a))[0]?.id || null;
  return { neigong: best("neigong", t => G.neigongMult(data, cs, t)), body: best("body", t => t.hpMult || 1), martial: null, qinggong: null, yishu: null, anqi: null };
}
export function childState(data, s, c) {
  const L = s.life, W = data.world;
  const root = by(W.roots, c.rootId), phy = by(W.physiques, c.physiqueId), era = by(W.eras, L.eraId), region = by(W.regions, L.regionId), wealth = by(W.wealth, L.wealthId);
  const cs = { pathId: c.pathId || "qi", realmIndex: c.realmIndex || 0, layer: c.layer || 1, qi: c.qi || 0, ownedTechniques: [], familyTechs: [], spiritStones: 0, pills: 0,
    life: { physiqueId: c.physiqueId, eraId: L.eraId, regionId: L.regionId, wealthId: L.wealthId, soulId: c.soulId, rootId: c.rootId, elements: c.elements || [],
      qiMult: (root?.qiMult ?? 0) * (era?.qiMult ?? 1) * (region?.qiMult ?? 1) * (phy?.qiMult || 1),
      stats: { daoHeart: 1, karma: 0, connections: 0 }, focusId: "practice", awakened: !!c.awakened, age: childAge(s, c),
      baseLife: W.life.mortalBase + (wealth?.lifeBonus || 0) + (phy?.lifeBonus || 0), ageShift: 0 } };
  cs.techniqueSlots = familyBest(data, s, cs);
  return cs;
}
export function childSummary(data, s, c) {
  const bits = [];
  if (c.awakened && c.pathId) { const cs = childState(data, s, c); bits.push(`${G.pathOf(data, cs).name}: ${G.realmsOf(data, cs)[c.realmIndex || 0].name} ${c.layer || 1}`); }
  if (c.sect) bits.push(G.sectById(data, c.sect)?.name);
  if (c.spouse) bits.push(c.gender === "m" ? "женат" : "замужем");
  const k = (c.kids || []).filter(x => x.alive).length;
  if (k) bits.push(`${k} ${k === 1 ? "ребёнок" : k < 5 ? "ребёнка" : "детей"}`);
  return bits.filter(Boolean).join(" · ");
}
function makeGrandchild(data, s, c, rng) {
  const L = s.life, W = data.world, gender = rng() < 0.5 ? "m" : "f";
  let rootId, elements;
  if (c.rootId && rng() < W.life.rootInheritChance) { rootId = c.rootId; elements = [...(c.elements || [])]; }
  else { const r = rollRoot(data, rng); rootId = r.root.id; elements = r.elements; }
  const soulId = rng() < W.life.rootInheritChance ? c.soulId : rollSoul(data, rng)?.id;
  const p = generatePerson(data, rng, { gender, surname: L.surname, age: 0, regionId: L.regionId, wealthId: L.wealthId, physiqueId: c.physiqueId, rootId, elements, noRoot: true });
  return { name: p.name, gender, born: childAge(s, c), rootId, elements, soulId: soulId || null, physiqueId: c.physiqueId, physiqueName: p.physiqueName, stats: p.stats,
    alive: true, task: "home", awakened: false, pathId: null, realmIndex: 0, layer: 1, qi: 0, spouse: null, kids: [], sect: null };
}
function growChildren(data, s, rng) {
  for (const c of s.life.children) if (c.alive) growOne(data, s, c, childAge(s, c), rng, true);
}
// Наследник получил взрослых детей, чья молодость прошла «за кадром»: проживаем им пропущенные годы молча.
function catchUpChildren(data, s, rng) {
  const T = data.world.time;
  for (const c of s.life.children) {
    const now = childAge(s, c);
    for (let a = Math.max(T.awakeningAge, c.lastGrown ?? 0); a < now && c.alive; a++) growOne(data, s, c, a, rng, false);
  }
}
function growOne(data, s, c, a, rng, loud) {
  const L = s.life, W = data.world, T = W.time;
  const say = (msg) => { if (loud) logLine(s, msg, "family"); };
  if (a < T.awakeningAge) return;
  c.lastGrown = a + 1;
  if (!c.awakened) {
    c.awakened = true;
    if (!c.rootId) { const r = rollRoot(data, rng); c.rootId = r.root.id; c.elements = r.elements; }
    if (!c.soulId) c.soulId = rollSoul(data, rng)?.id || null;
    c.pathId = bestPath(data, childState(data, s, c)); c.realmIndex = 0; c.layer = 1; c.qi = 0;
    if (L.sect && rng() < 0.5) { const sd = G.sectById(data, L.sect.id); if (!sd?.paths || sd.paths.includes(c.pathId)) c.sect = L.sect.id; }
    say(gtext(`${c.name} прошёл(ла) камень проверки: ${rootText(data, c)}. ${G.pathOf(data, childState(data, s, c)).name}${c.sect ? `, секта ${G.sectById(data, c.sect).name}` : ""}.`, c.gender));
  }
  // рост
  const cs = childState(data, s, c), rs = G.realmsOf(data, cs), need = G.qiRequired(data, cs);
  c.qi = (c.qi || 0) + G.qiPerSecond(data, cs) * T.yearSeconds * CHILD_K + CHILD_A * need;
  if (c.qi >= need && !G.legendGate(data, cs)) {
    if (rng() < G.breakthroughChance(data, cs)) {
      const r = rs[c.realmIndex || 0];
      if ((c.layer || 1) < r.layers) c.layer = (c.layer || 1) + 1;
      else if ((c.realmIndex || 0) < rs.length - 1) { c.realmIndex = (c.realmIndex || 0) + 1; c.layer = 1;
        say(gtext(`${c.name} вошёл(ла) в ступень «${rs[c.realmIndex].name}».`, c.gender)); }
      c.qi = 0;
    } else c.qi = need * 0.7;
  } else c.qi = Math.min(c.qi, need);
  // брак и внуки
  if (a >= 18 && a <= 40 && !c.spouse && rng() < 0.09) {
    const sg = c.gender === "m" ? "f" : "m";
    let p, n = 0;
    do { p = generatePerson(data, rng, { gender: sg, regionId: L.regionId, wealthId: L.wealthId, noRoot: true }); n++; } while (p.surname === L.surname && n < 20);
    c.spouse = { name: p.name, surname: p.surname, gender: sg, type: "arranged", jobId: defaultJob(data, s)?.id || "home", physiqueName: p.physiqueName, stats: p.stats };
    say(gtext(`${c.name} сочетался(ась) браком: ${p.name}.`, c.gender));
  }
  c.kids ??= [];
  if (c.spouse && a >= 20 && a <= 50 && c.kids.length < 3 && rng() < 0.08) {
    const gk = makeGrandchild(data, s, c, rng); gk.born = a; c.kids.push(gk);
    say(`У ${c.name} ${gk.gender === "m" ? "родился сын — твой внук" : "родилась дочь — твоя внучка"} ${gk.name}.`);
  }
  // старость и беды взрослого
  const span = lifespan(data, childState(data, s, c));
  const old = (a / span - W.life.oldAgeStart) / (1 - W.life.oldAgeStart);
  if (a >= span || (old >= 0 && rng() < (W.life.oldAgeBase ?? 0) + W.life.oldAgeHazard * old * old) || rng() < by(W.wealth, L.wealthId).hazard * 0.4) {
    c.alive = false;
    say(gtext(`Умер(ла) ${c.name}, ${a} лет.`, c.gender) + " Ты пережил(а) своего ребёнка.");
  }
}

function makeChild(data, s, rng) {
  const L = s.life, W = data.world, gender = rng() < 0.5 ? "m" : "f";
  let rootId, elements;
  if (rng() < W.life.rootInheritChance) { rootId = L.rootId; elements = [...L.elements]; }
  else { const r = rollRoot(data, rng); rootId = r.root.id; elements = r.elements; }
  
  const soulId = rng() < W.life.rootInheritChance ? L.soulId : rollSoul(data, rng)?.id;
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
    soulId: soulId || null,
    awakened: false, pathId: null, realmIndex: 0, layer: 1, qi: 0, spouse: null, kids: [], sect: null,
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
  if (ef.tech) { // техника в подарок: учится бесплатно и встаёт в слот, если лучше пустого
    const t = G.techById(data, ef.tech);
    if (t && !s.ownedTechniques.includes(t.id)) {
      s.ownedTechniques.push(t.id);
      if (!s.techniqueSlots[t.type]) G.equipTechnique(data, s, t.id);
      logLine(s, `Освоено без платы: «${t.name}».`, "cult");
    }
  }
  if (ef.sect && !L.sect && L.awakened) {
    const sd = G.sectById(data, ef.sect);
    if (sd) { L.sect = { id: sd.id, since: L.age }; logLine(s, `Ты вступил(а) в секту ${sd.name}（${sd.han}）: ${G.sectRankName(s)}. Её 中乘 открыты сразу, 上乘 — внутренним ученикам, 绝学 — личным.`, "awaken"); }
  }
  if (ef.scroll && L.awakened) { const t = G.luckyScroll(data, s, rng); logLine(s, t ? `Свиток в руках: «${t.name}». Теперь он и в родовой библиотеке.` : "Свиток оказался пустым: всё это ты уже знаешь.", "luck"); }
  if (ef.sectTech && L.sect) {
    const t = G.luckyScroll(data, s, rng, L.sect.id);
    if (t) logLine(s, `Старейшина открыл тебе «${t.name}». Об этом не говорят вслух.`, "luck"); else { s.spiritStones += 30; logLine(s, "Свитков твоего ранга больше нет — старейшина выдал 30 камней на пилюли.", "cult"); }
  }
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
  best: ef => (ef.years || 0) * 2 + (ef.qiPct || 0) * 12 + (ef.daoHeart || 0) * 2 + (ef.stones || 0) * 0.5 + (ef.pill || 0) * 4 + (ef.legacy || 0) * 2 + (ef.karma || 0) * 0.4 + (ef.connections || 0) * 0.6 + (ef.spouse ? 6 : 0) + (ef.tech ? 5 : 0) + (ef.sect ? 8 : 0) + (ef.scroll ? 5 : 0) + (ef.sectTech ? 5 : 0) + (ef.death ? -200 : 0) + (ef.childDeath ? -40 : 0),
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
  const phyY = by(W.physiques, L.physiqueId);
  if (J && L.age >= J.workAge) {
    const own = jobById(data, L.jobId), sp = L.spouse && jobById(data, L.spouse.jobId);
    let pay = (own?.stones || 0) + (sp?.stones || 0);
    pay += L.children.filter(c => c.alive && childAge(s, c) >= J.childHelpAge && c.task === "help").length * (J.childHelpStones || 0);
    pay = Math.round(pay * (focus?.payMul ?? 1) * (phyY?.payMul ?? 1));
    if (pay) s.spiritStones += pay;
    if (pay && L.age % 5 === 0) logLine(s, `Год работы (${focus?.name || "дом"}): ${pay} камней.`, "family");
  }
  for (const c of L.children) {
    if (c.alive && c.task === "letters" && childAge(s, c) >= 6 && rng() < 0.12) {
      L.stats.connections = clamp(L.stats.connections + 1, 0, 30);
      logLine(s, `${c.name} вывел(а) новый иероглиф. В доме стало тише и светлее.`, "family");
    }
  }
  if (L.spouse && rng() < (wl.spouseDeathHazard + (L.age > 80 ? 0.02 : 0)) * (phyY?.spouseHazardMul ?? 1)) {
    const sp = L.spouse;
    logLine(s, `${sp.gender === "m" ? "Умер твой супруг" : "Умерла твоя супруга"} ${sp.name}. ${L.gender === "m" ? "Ты остался один." : "Ты осталась одна."}`, "family");
    L.spouse = null;
  }
  const [b0, b1] = wl.childBirthAges ?? [20, 50];
  if (L.spouse && L.age >= b0 && L.age <= b1 && L.children.length < wl.childMax && rng() < wl.childBirthChance * (focus?.birthMul ?? 1) * (phyY?.birthMul ?? 1)) {
    const kid = makeChild(data, s, rng); L.children.push(kid);
    logLine(s, `В семье ${kid.gender === "m" ? "родился сын" : "родилась дочь"} — ${kid.name}.`, "family");
  }
  const wealth = by(W.wealth, L.wealthId);
  for (const c of L.children) if (c.alive && childAge(s, c) < 16 && rng() < wealth.hazard * 0.8) {
    c.alive = false; logLine(s, `Умер(ла) твой ребёнок ${c.name}: детская лихорадка не пощадила.`, "family");
  }
  growChildren(data, s, rng);
  // Друзья делятся свитками: с 8 связей, 0.4% за каждую связь сверх 6.
  if (L.awakened && L.stats.connections >= 8 && rng() < 0.004 * (L.stats.connections - 6)) {
    const t = G.luckyScroll(data, s, rng);
    if (t) logLine(s, `Старый друг из цзянху переписал для тебя «${t.name}» — по дружбе, не по уставу.`, "luck");
  }
  const jobHaz = (jobById(data, L.jobId)?.hazard || 0) + (L.spouse ? (jobById(data, L.spouse.jobId)?.hazard || 0) * 0.3 : 0);
  const yishu = G.slottedTechs(data, s).yishu;
  const phy = by(W.physiques, L.physiqueId);
  let hz = (wealth.hazard + jobHaz) * by(W.regions, L.regionId).hazardMult * by(W.eras, L.eraId).hazardMult * (focus?.hazardMul ?? 1) * (phy?.hazard || 1) * (1 - (yishu?.hazardCut || 0));
  if (L.awakened) hz *= wl.awakenedHazardMult * Math.pow(wl.realmHazardDecay ?? 0.5, s.realmIndex) * (G.pathOf(data, s).hazardMul ?? 1);
  if (L.age < 5) hz *= wl.infantHazardMult;
  const span = lifespan(data, s);
  if (L.age >= span) return die(data, s, "Дожил(а) отведённый срок", rng);
  if (rng() < hz) {
    if (L.mercy && !L.awakened) logLine(s, "Беда прошла мимо: небо хранит тебя.", "luck");
    else return die(data, s, pick(W.deathCauses[L.age < T.awakeningAge ? "child" : "adult"], rng), rng);
  }
  // Старость: с oldAgeStart срока риск растёт квадратично — смерть размазана, а не «все в последний год».
  const old = (L.age / span - wl.oldAgeStart) / (1 - wl.oldAgeStart);
  if (old >= 0 && rng() < (wl.oldAgeBase ?? 0) + wl.oldAgeHazard * old * old) return die(data, s, "Ушёл(ла) от старости", rng);
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
  const phy = by(data.world.physiques, L.physiqueId);
  if (L.alive && phy?.capAge && !L.capLifted && capLifted(data, s, phy)) {
    L.capLifted = true;
    logLine(s, `Своя ци впервые прогрела тёмные жилы. Холод отступил: срок больше не меряют лекари.`, "luck");
  }
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
