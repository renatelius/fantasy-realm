// Жизнь культиватора: рождение-лотерея, годы, летопись, карточки выбора, семья, смерть, наследие.
// Формулы:
//   qiMult жизни = root.qiMult * era.qiMult * region.qiMult   (множитель медитации)
//   максимальный возраст: смертный = mortalBase + wealth.lifeBonus ± spread;
//                         после пробуждения — плавно по слоям к realm.maxAge ступени сильнейшего пути; плюс ageShift от событий
//   старость: с 78% срока риск 1% + 30% × x², x = доля пути от 78% до 100%
//   риск смерти в год = wealth.hazard * region.hazardMult * era.hazardMult * 0.4 (после пробуждения)
//                       * realmHazardDecay^(ступень сильнейшего пути) * (2 до 5 лет); старость — квадратично с oldAgeStart срока
//   время: dt_игры = dt_реальное * speed.factor (0 = пауза); untilEvent — сразу до карточки или смерти
//   год = yearSeconds игровых секунд (детство в 0.15 раза)
import { newState } from "./state.js";
import * as G from "./game.js";
import * as KF from "./family.js";
import * as CL from "./clan.js";
import * as S from "./sect.js";
import * as CR from "./craft.js";

const pick = (a, rng) => a[Math.floor(rng() * a.length)];
// Число + слово в нужной форме: 1 год / 2 года / 5 лет, 1 камень / 2 камня / 5 камней.
export const plural = (n, a, b, c) => { const m = Math.abs(n) % 10, h = Math.abs(n) % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
export const yearsW = n => `${n} ${plural(n, "год", "года", "лет")}`;
export const stonesW = n => `${n} ${plural(n, "камень", "камня", "камней")}`;
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
    if ((grp === "ой" || grp === "ей") && /(ым|им)$/.test(base)) return base.slice(0, -2) + grp; // живым(ой) → живой, вмёрзшим(ей) → вмёрзшей
    if (grp === "ла" && /[её]л$/.test(base)) return base.slice(0, -2) + grp;   // ушёл → ушла, вышел → вышла
    if (grp.startsWith("л") && base.endsWith("лся")) return base.slice(0, -3) + grp;
    if (grp === "ась" && base.endsWith("ся")) return base.slice(0, -2) + grp;
    return base + grp;
  });
}
// Данные для подстановок родни, рода и секты ({parent}, {sib}, {clan}, {rival}, {ally}, {master}, {peerRival}, {peerFriend}, {sect}, {sectEnemy}).
let fmtData = null;
export function setFmtData(data) { fmtData = data; }
export function fmt(s, text) {
  const L = s.life; if (!L) return text;
  const sp = L.spouse ? (L.spouse.gender === "m" ? "Супруг" : "Супруга") : "Супруг(а)";
  const spn = L.spouse ? L.spouse.name.split(" ").slice(1).join(" ") || L.spouse.name : (L.gender === "m" ? "женой" : "мужем");
  let out = text.replaceAll("{Spouse}", sp).replaceAll("{spouse}", spn).replaceAll("{name}", L.name.split(" ").slice(1).join(" ") || L.name);
  if (fmtData && out.includes("{")) {
    const v = { ...KF.vars(fmtData, s), ...CL.vars(fmtData, s), ...S.vars(fmtData, s) };
    out = out.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
  }
  return gtext(out, L.gender);
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
    region = by(W.regions, entry.regionId); generation = entry.generation + (heir.gen ?? 1);
    era = by(W.eras, entry.eraId) || W.eras.find(e => e.name === entry.eraName) || wpick(W.eras, rng);
    const floor = wl.heirWealthFloor[Math.min(Math.floor(entry.tier ?? entry.realmIndex ?? 0), wl.heirWealthFloor.length - 1)]; // по ярусу предка
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
    talentId: heir ? (heir.child.talentId ?? null) : null, zz: !!heir, pause: null, notes: [], focusYears: {}, marriedYears: 0, autoHold: false,
  };
}

export function startLife(data, s, mode = "new", rng = Math.random, childIdx = 0) {
  const prev = s.lineage[s.lineage.length - 1];
  const cand = mode === "heir" && prev ? heirCandidates(data, prev)[childIdx] || null : null;
  const child = cand ? cand.node : null;
  const keep = { lineage: s.lineage, settings: s.settings, clans: s.clans || {} };
  fmtData = data;
  Object.assign(s, newState(), keep);
  s.familyTechs = child ? [...(prev.familyTechs || [])] : [];
  s.life = rollBirth(data, rng, child ? { entry: prev, child, gen: cand.gen } : null);
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
    CR.inherit(data, s, prev, child, cand.kind === "child");
    if (L.awakened) {
      if (!L.soulId) L.soulId = rollSoul(data, rng)?.id || null;
      // Ребёнок жил своей жизнью, пока ты играл(а) за родителя: путь, ступень, секта — его.
      if (child.awakened && child.pathId) { s.pathId = child.pathId; s.realmIndex = child.realmIndex || 0; s.layer = child.layer || 1; s.qi = Math.floor(child.qi || 0); }
      else s.pathId = bestPath(data, s);
      if (child.sect) { S.heirSect(data, s, child.sect, rng); S.heirSeal(data, s, prev, child, rng); }
    }
    if (child.spouse) L.spouse = { ...child.spouse };
    L.children = (child.kids || []).map(stripAge);
    L.household = cand.kind === "child" ? KF.heirHousehold(data, s, prev, cand.idx, rng) : KF.kinHousehold(data, s, prev, cand, rng);
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
  KF.ensureFam(data, s, rng);
  CL.startClan(data, s, child ? "heir" : "new", rng);
  const odds = L.odds ? ` Такая судьба выпадает 1 из ${L.odds.toLocaleString("ru-RU")}.` : "";
  if (child) {
    logLine(s, `Продолжение рода: ${L.name}, ${yearsW(L.age)} — не с пелёнок. Дом после ${prev.name}${cand.kind === "child" ? "" : ` (${cand.word})`}. ${by(W.regions, L.regionId).name}, ${wealth.name}.${L.awakened ? " Корни уже открыты: " + rootText(data, L) + ". " + pathOf(data, s).name + ": «" + G.realmsOf(data, s)[s.realmIndex].name + "», слой " + s.layer + "." : ""}${s.familyTechs.length ? ` Родовая библиотека: ${s.familyTechs.length} свитк.` : ""}`, "birth");
    const kidsNow = L.children.filter(c => c.alive);
    if (L.spouse || kidsNow.length) logLine(s, gtext(`Ты не ${L.gender === "m" ? "один" : "одна"}: ${[L.spouse ? `${L.spouse.gender === "m" ? "муж" : "жена"} ${L.spouse.name}` : "", kidsNow.length ? `${kidsNow.length === 1 ? "ребёнок" : "дети"} — ${kidsNow.map(c => `${c.name} (${yearsW(childAge(s, c))})`).join(", ")}` : ""].filter(Boolean).join("; ")}. Эта жизнь шла своим чередом, пока ты играл(а) за ${prev.name}.`, L.gender), "family");
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
  const sibs = [], usedNames = new Set([L.name.split(" ").slice(1).join(" ")]);
  for (let i = 0; i < nSib; i++) {
    const g = rng() < 0.5 ? "m" : "f";
    // Имя не повторяет имя игрока и других детей двора.
    let given = pick(W.names[g], rng);
    for (let k = 0; k < 12 && usedNames.has(given); k++) given = pick(W.names[g], rng);
    usedNames.add(given);
    const sib = generatePerson(data, rng, {
      gender: g,
      given,
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
      rel: sib.age > L.age ? "старш." : "младш.", // при рождении все братья и сёстры — старшие
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
    ? ` В доме уже ${h.siblings.map(x => `${x.rel} ${x.gender === "m" ? "брат" : "сестра"} ${x.name.split(" ").pop()}, ${yearsW(x.age)}${x.physiqueName ? `, телосложение «${x.physiqueName}»` : ""}`).join("; ")}.`
    : " Ты первый ребёнок в этом дворе.";
  return gtext(`В ${era.name} ты родился(ась) ${who}, телосложение «${phy.name}», ${region.kind} — ${region.name}. Семья: ${wealth.name.toLowerCase()}. Мать ${h?.mother.name}, ${yearsW(h?.mother.age)}, ${h?.mother.job}; отец ${h?.father.name}, ${yearsW(h?.father.age)}, ${h?.father.job}.${sib} Корни ещё спят: проверка в ${W.time.awakeningAge} лет.`, L.gender);
}
export function acceptBirth(s) {
  if (!s.life || s.life.phase === "play") return;
  s.life.phase = "play";
}
export function finishRoot(data, s, rng = Math.random) {
  const L = s.life, W = data.world;
  if (!L || L.rootRevealed) return L;
  // Корни могли быть заложены при рождении (наследник-ребёнок, дети от двух родителей): камень их только показывает.
  const known = L.rootId && by(W.roots, L.rootId);
  const r = known ? { root: known, elements: L.elements || [] } : rollRoot(data, rng);
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
  if (phy?.capAge) logLine(s, `Старейшина нащупал холод в жилах: «${phy.name}». Без ${phy.capLayer}-го слоя первой ступени дольше ${phy.capAge} лет не прожить. Путь — единственное лекарство.`, "death");
  const soul = W.souls?.find(x => x.id === L.soulId);
  const tail = r.root.qiMult > 0 ? "Путь ци открыт." : "Корней нет, как у большинства людей. Путь ци закрыт — но есть тело" + (soul?.mult ? " и душа." : ".");
  logLine(s, `Проверка корней в ${yearsW(L.age)}: ${rootText(data, L)}. Такая жила выпадает 1 из ${L.rootOdds}.${soul ? ` Душа: ${soul.name}.` : ""} ${tail}`, "awaken");
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
  logLine(s, `Ты вступил(а) на ${o.path.name}. Первая ступень — «${o.path.realms[0].name}».`, "awaken");
  return { ok: true };
}
// «Девять тёмных жил»: потолок срока снимается, когда общий слой (ступень*9 + слой) дорос до capLayer.
function capLifted(data, s, phy) {
  return G.maxLevel(data, s) + 1 >= (phy.capLayer ?? 10); // общий слой сильнейшего пути (1-й слой = 1)
}
export function lifespan(data, s) {
  const L = s.life;
  // Срок растёт по слоям: от потолка прошлой ступени к потолку текущей (realm.maxAge = срок на 9-м слое).
  // Первый слой первой ступени — почти смертный срок. Без культивации долгой жизни нет.
  // Несколько путей: сильнейший даёт свой срок целиком, каждый другой — долю otherLifeShare своей прибавки.
  let base = L.baseLife;
  const gains = [];
  if (L.awakened) for (const [id, rec] of Object.entries(G.pathRecs(s))) {
    const rs = G.pathDef(data, id)?.realms || G.realmsOf(data, s), r = rs[rec.realmIndex || 0];
    const prev = rec.realmIndex > 0 ? Math.max(L.baseLife, rs[rec.realmIndex - 1].maxAge) : L.baseLife;
    const cur = Math.max(prev, r.maxAge);
    gains.push(Math.max(0, prev + (cur - prev) * ((rec.layer || 1) / r.layers) - L.baseLife));
  }
  if (gains.length) {
    gains.sort((a, b) => b - a);
    base = Math.round(L.baseLife + gains[0] + (data.realms.crossPath?.otherLifeShare ?? 0) * gains.slice(1).reduce((t, x) => t + x, 0));
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
export function generatePerson(data, rng, options = {}) {
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
  const a = st.karma >= 6 ? "Добром поминали и через поколения." : st.karma <= -6 ? (L.gender === "m" ? "О нём" : "О ней") + " вспоминали с опаской." : "Прожил(а) жизнь, не веря ни славе, ни позору.";
  const b = L.awakened ? `Дошёл(ла) до ступени «${r.name}», слой ${s.layer}.` : "Так и не ступил(а) на Путь.";
  const c = st.connections >= 8 ? " Провожали сотни людей." : st.daoHeart >= 6 ? " Сердце было твёрже нефрита." : "";
  return fmt(s, `${a} ${b}${c}`);
}

export function die(data, s, cause, rng = Math.random) {
  const L = s.life; if (!L.alive) return;
  L.alive = false; L.pending = null; L.pause = null;
  // В запись о смерти идёт сильнейший из путей; остальные — строкой в биографии.
  if (L.awakened) { const best = Object.entries(G.pathRecs(s)).sort((a, b) => G.levelOf(data, b[0], b[1]) - G.levelOf(data, a[0], a[1]))[0]?.[0]; if (best) G.switchPath(data, s, best, true); }
  const kids = L.children.filter(c => c.alive).map(c => ({ ...c, age: childAge(s, c) })); // со всей прожитой жизнью: путь, ступень, брак, внуки
  const entry = {
    name: L.name, surname: L.surname, gender: L.gender, generation: L.generation, ageAtDeath: L.age, cause: fmt(s, cause),
    rootName: L.awakened ? rootText(data, L) : "не проверены", regionId: L.regionId, wealthId: L.wealthId,
    regionName: by(data.world.regions, L.regionId).name, eraId: L.eraId, eraName: by(data.world.eras, L.eraId).name,
    realmIndex: s.realmIndex, tier: L.awakened ? G.tierOf(data, s) : 0, layer: s.layer, realmName: L.awakened ? G.realmsOf(data, s)[s.realmIndex].name : "—", pathId: s.pathId, pathName: L.awakened ? G.pathOf(data, s).name : "—",
    stonesLeft: s.spiritStones, legacyBonus: L.legacyBonus, awakened: L.awakened, odds: L.odds,
    daoHeart: L.stats.daoHeart, karma: L.stats.karma, connections: L.stats.connections,
    spouseName: L.spouse ? L.spouse.name : null, spouseGender: L.spouse?.gender || null, children: kids,
    jobName: jobById(data, L.jobId)?.name || "", clanKey: L.clanKey || null,
    sectName: L.sect ? G.sectById(data, L.sect.id)?.name || null : null, sectRank: L.sect ? G.sectRankName(s, data) : null,
    kinTree: snapKin(s), sectSucc: S.deathSuccession(data, s),
    epitaph: epitaph(data, s), words: finalWords(data, s, rng),
    familyTechs: [...new Set([...(s.familyTechs || []), ...s.ownedTechniques])],
    craft: CR.snapshot(s), gear: L.gear ? { ...L.gear } : null,
  };
  try { entry.report = deathReport(data, s, entry); } catch (e) { entry.report = null; }
  L.legacy = entry; s.lineage.push(entry);
  CL.lifeTablet(data, s, entry);
  s.lineage = s.lineage.slice(-data.world.life.lineageKeep);
  logLine(s, `Смерть в ${yearsW(L.age)}. ${entry.cause}.`, "death");
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
  if (r.minRealm != null && G.maxTier(data, s) < r.minRealm) return false; // minRealm/maxRealm в карточках и летописи — ярус (tier)
  if (r.maxRealm != null && G.maxTier(data, s) > r.maxRealm) return false;
  if (r.married != null && r.married !== !!L.spouse) return false;
  if (r.single != null && r.single !== !L.spouse) return false;
  if (r.hasChildren && !L.children.some(c => c.alive)) return false;
  if (r.noSect && L.sect) return false;
  if (r.inSect && !L.sect) return false;
  if (r.elder && L.age < 0.7 * lifespan(data, s)) return false;
  if (!CR.matches(data, s, r)) return false;
  return KF.matches(data, s, r) && CL.matches(data, s, r) && S.matches(data, s, r);
}
function eligible(data, s, e) {
  const L = s.life;
  return !e.scripted && L.age >= e.minAge && L.age <= e.maxAge && !L.usedEvents.includes(e.id) && matches(data, s, e.requires) && !sectBlocked(data, s, e);
}
// Секта с ограничением путей (sects.json → paths) не зовёт того, чей путь она не учит.
// Изгнанного (и ушедшего) обратно не зовут.
function sectBlocked(data, s, e) {
  const banned = s.life.bannedSects || [];
  return e.choices.some(c => { const id = c.effects?.sect; if (!id || id === "random") return false; const sd = G.sectById(data, id); return banned.includes(id) || (!!sd?.paths && !sd.paths.includes(s.pathId || "qi")); });
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
//   Брак 18–40 лет — 9%/год; внуки 20–50 лет — 8%/год, до 3. Смерть: старость по сроку своей ступени + 0.4×беды дома × realmHazardDecay^ступень.
const CHILD_K = 0.6, CHILD_A = 0.12;
function familyBest(data, s, cs) {
  const ids = new Set([...(s.familyTechs || []), ...(s.ownedTechniques || [])]);
  const pool = [...ids].map(id => G.techById(data, id)).filter(t => t && G.techUsable(data, cs, t) && (t.minRealm || 0) <= G.tierOf(data, cs));
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
export function childSummary(data, s, c, opts = {}) {
  const bits = [];
  if (c.physiqueName) bits.push(`тело «${c.physiqueName}»`);
  if (c.awakened && c.rootId) bits.push(rootText(data, c));
  if (c.awakened && c.pathId) { const cs = childState(data, s, c); bits.push(`${G.pathOf(data, cs).name}: ${G.realmsOf(data, cs)[c.realmIndex || 0].name} ${c.layer || 1}`); }
  if (c.sect) bits.push(G.sectById(data, c.sect)?.name);
  if (c.sectSuccessor) bits.push("названный преемник главы");
  if (c.spouse && !opts.noFam) bits.push(c.gender === "m" ? `женат на ${c.spouse.name}` : `замужем за ${c.spouse.name}`);
  const k = (c.kids || []).filter(x => x.alive).length;
  if (k && !opts.noFam) bits.push(`${k} ${k === 1 ? "ребёнок" : k < 5 ? "ребёнка" : "детей"}`);
  return bits.filter(Boolean).join(" · ");
}
// Имя ребёнка не повторяет имён родителя, деда и братьев-сестёр.
function freshGiven(data, rng, gender, taken) {
  const used = new Set(taken.map(n => String(n || "").split(" ").slice(1).join(" ")));
  let g = pick(data.world.names[gender], rng);
  for (let i = 0; i < 15 && used.has(g); i++) g = pick(data.world.names[gender], rng);
  return g;
}
function makeGrandchild(data, s, c, rng) {
  const L = s.life, gender = rng() < 0.5 ? "m" : "f";
  // «self» — с точки зрения будущего наследника: если он продолжит род, это будут его дети.
  const gn = inheritGenes(data, rng, { who: "self", rootId: c.rootId, elements: c.elements, physiqueId: c.physiqueId, soulId: c.soulId },
    c.spouse ? { who: "spouse", ...ensureGenes(data, c.spouse, rng) } : null);
  const p = generatePerson(data, rng, { gender, given: freshGiven(data, rng, gender, [c.name, L.name, ...(c.kids || []).map(k => k.name)]), surname: L.surname, age: 0, regionId: L.regionId, wealthId: L.wealthId, physiqueId: gn.physiqueId, rootId: gn.rootId, elements: gn.elements, noRoot: true });
  return { name: p.name, gender, born: childAge(s, c), rootId: gn.rootId, elements: gn.elements, rootSrc: gn.rootSrc, phyFrom: gn.phyFrom, soulId: gn.soulId,
    physiqueId: gn.physiqueId, physiqueName: p.physiqueName, stats: p.stats,
    alive: true, task: "home", awakened: false, pathId: null, realmIndex: 0, layer: 1, qi: 0, spouse: null, kids: [], sect: null };
}
function growChildren(data, s, rng) {
  for (const c of s.life.children) { const a = childAge(s, c); if (c.alive) growOne(data, s, c, a, rng, true); growDesc(data, s, c, a, "child", rng, true); }
}
// Потомки родича живут своей жизнью: внуки, правнуки, племянники. Возраст ребёнка — по шкале родителя (born = возраст родителя при рождении),
// поэтому дети умершего родича растут дальше. Громко (в летопись) — только внуки; глубже — молча.
export function growDesc(data, s, p, pAge, role, rng, loud = false) {
  const r = NEXT_ROLE[role]; if (!r || !p.kids?.length) return;
  const T = data.world.time;
  for (const k of p.kids) {
    const ka = pAge - (k.born ?? 0);
    if (k.alive && ka >= T.awakeningAge) for (let a = Math.max(T.awakeningAge, k.lastGrown ?? 0); a <= ka && k.alive; a++) growKin(data, s, k, a, rng, loud && r === "grand" && a === ka, r);
    if (ka > 0) growDesc(data, s, k, ka, r, rng, false);
  }
}
// Слепок родни на момент смерти: у каждого возраст «сейчас» (age), вглубь по kids.
function snapKin(s) {
  const L = s.life, h = L.household;
  const snap = (p, age) => { const x = JSON.parse(JSON.stringify(p)); x.age = age; x.kids = (p.kids || []).map(k => snap(k, age - (k.born ?? 0))); return x; };
  return {
    children: L.children.map(c => snap(c, childAge(s, c))),
    siblings: (h?.siblings || []).filter(x => L.age - x.born >= 0).map(x => snap(x, L.age - x.born)),
    parents: ["father", "mother"].map(k => h?.[k] ? { ...h[k], key: k, ageNow: (h[k].age ?? 0) + L.age } : null),
  };
}
const stripAge = k => { const x = { ...k }; delete x.age; x.kids = (k.kids || []).map(stripAge); return x; };
// Кем можно продолжить род: сначала дети (тем же порядком, что entry.children), потом внуки и правнуки, братья, сёстры, племянники.
export function heirCandidates(data, e) {
  if (!e) return [];
  const out = [], kt = e.kinTree;
  (e.children || []).forEach((c, i) => out.push({ kind: "child", role: "child", gen: 1, node: c, idx: i, age: c.age ?? 0 }));
  const down = (p, role, gen) => {
    const r = NEXT_ROLE[role]; if (!r) return;
    for (const k of p.kids || []) {
      const ka = k.age ?? ((p.age ?? 0) - (k.born ?? 0)), kk = k.age == null ? { ...k, age: ka } : k;
      if (kk.alive && ka >= 0 && (KIN_GEN[r] ?? 9) <= HEIR_MAX_GEN) out.push({ kind: "kin", role: r, gen: gen + 1, node: kk, parent: p, age: ka });
      down(kk, r, gen + 1);
    }
  };
  (kt?.children || e.children || []).forEach(c => down(c, "child", 1));
  for (const x of kt?.siblings || []) {
    if (x.alive && x.age >= 0) out.push({ kind: "kin", role: "sib", gen: 0, node: x, age: x.age });
    down(x, "sib", 0);
  }
  return out.map((c, j) => ({ ...c, j, word: kinWord(c.node, c.role) }));
}
// Наследник получил взрослых детей, чья молодость прошла «за кадром»: проживаем им пропущенные годы молча.
function catchUpChildren(data, s, rng) {
  const T = data.world.time;
  for (const c of s.life.children) {
    const now = childAge(s, c);
    for (let a = Math.max(T.awakeningAge, c.lastGrown ?? 0); a < now && c.alive; a++) growOne(data, s, c, a, rng, false);
    growDesc(data, s, c, now, "child", rng, false);
  }
}
function growOne(data, s, c, a, rng, loud) { return growKin(data, s, c, a, rng, loud, "child"); }
// Год жизни родича: ребёнка ("child") или брата/сестры ("sib"). Брат/сестра в секту родителя не идёт — иногда в свою.
// Родичи по роли: дети, внуки, правнуки; братья/сёстры и их потомки. Роль ребёнка родича — NEXT_ROLE, поколение относительно тебя — KIN_GEN.
const KIN_WORDS = { child: ["сын", "дочь"], grand: ["внук", "внучка"], great: ["правнук", "правнучка"], great2: ["праправнук", "праправнучка"],
  sib: ["брат", "сестра"], nephew: ["племянник", "племянница"], gnephew: ["внучатый племянник", "внучатая племянница"] };
const NEXT_ROLE = { child: "grand", grand: "great", great: "great2", sib: "nephew", nephew: "gnephew" };
const KIN_GEN = { child: 1, grand: 2, great: 3, great2: 4, sib: 0, nephew: 1, gnephew: 2 };
const HEIR_MAX_GEN = 3; // наследник — не дальше трёх колен: дети, внуки, правнуки; братья, племянники, внучатые племянники
export const kinWord = (c, role) => { const w = KIN_WORDS[role] || KIN_WORDS.child; return c.gender === "m" ? w[0] : w[1]; };
export function growKin(data, s, c, a, rng, loud, role = "child") {
  const L = s.life, W = data.world, T = W.time;
  const say = (msg, kind) => { if (loud) KF.famNote(data, s, c, msg, kind); };
  if (a < T.awakeningAge) return;
  c.lastGrown = a + 1;
  if (!c.awakened) {
    c.awakened = true;
    if (!c.rootId) { const r = rollRoot(data, rng); c.rootId = r.root.id; c.elements = r.elements; }
    if (!c.soulId) c.soulId = rollSoul(data, rng)?.id || null;
    c.pathId = bestPath(data, childState(data, s, c)); c.realmIndex = 0; c.layer = 1; c.qi = 0;
    if (role === "child" && L.sect && rng() < 0.5) { const sd = G.sectById(data, L.sect.id); if (!sd?.paths || sd.paths.includes(c.pathId)) c.sect = L.sect.id; }
    if (role !== "child" && !c.sect && by(W.roots, c.rootId)?.qiMult > 0 && rng() < (KF.cfg(data).sibSectChance ?? 0.15)) c.sect = S.randomSectFor(data, s, c.pathId, rng);
    say(gtext(`${role !== "child" ? cap(kinWord(c, role)) + " " : ""}${c.name} прошёл(ла) камень проверки: ${rootText(data, c)}${role === "child" ? originText(s, c) : ""}. ${G.pathOf(data, childState(data, s, c)).name}${c.sect ? `, секта ${G.sectById(data, c.sect).name}` : ""}.`, c.gender), "awaken");
  }
  // рост
  const cs = childState(data, s, c), rs = G.realmsOf(data, cs), need = G.qiRequired(data, cs);
  c.qi = (c.qi || 0) + G.qiPerSecond(data, cs) * T.yearSeconds * CHILD_K + CHILD_A * need;
  if (c.qi >= need && !G.legendGate(data, cs)) {
    if (rng() < G.breakthroughChance(data, cs)) {
      const r = rs[c.realmIndex || 0];
      if ((c.layer || 1) < r.layers) c.layer = (c.layer || 1) + 1;
      else if ((c.realmIndex || 0) < rs.length - 1) { c.realmIndex = (c.realmIndex || 0) + 1; c.layer = 1;
        say(gtext(`${c.name} вошёл(ла) в ступень «${rs[c.realmIndex].name}».`, c.gender), "realm"); }
      c.qi = 0;
    } else c.qi = need * 0.7;
  } else c.qi = Math.min(c.qi, need);
  // брак и дети (устав Шаолиня: монахи не женятся)
  if (a >= 18 && a <= 40 && !c.spouse && !(c.sect && S.childNoMarriage(data, c.sect, s)) && rng() < 0.09) marryKin(data, s, c, rng, loud, role);
  c.kids ??= [];
  if (c.spouse && a >= 20 && a <= 50 && c.kids.filter(k => k.alive).length < 3 && rng() < 0.08) {
    const gk = makeGrandchild(data, s, c, rng); gk.born = a; c.kids.push(gk);
    const nr = NEXT_ROLE[role], who = nr ? (gk.gender === "m" ? "твой " : "твоя ") + kinWord(gk, nr) : "ещё один потомок рода";
    say(`У ${c.name} ${gk.gender === "m" ? "родился сын" : "родилась дочь"} — ${who} ${gk.name}.`, "birth");
  }
  // старость и беды взрослого
  const span = lifespan(data, childState(data, s, c));
  const old = (a / span - W.life.oldAgeStart) / (1 - W.life.oldAgeStart);
  const hz = by(W.wealth, L.wealthId).hazard * 0.4 * Math.pow(W.life.realmHazardDecay ?? 0.5, G.realmTier(data, c.pathId || "qi", c.realmIndex)) * S.childHazardMul(data, c.sect);
  if (a >= span || (old >= 0 && rng() < (W.life.oldAgeBase ?? 0) + W.life.oldAgeHazard * old * old) || rng() < hz) {
    c.alive = false; c.diedAt = L.age; c.deathAge = a;
    if (loud) {
      say(gtext(`Умер(ла) ${kinWord(c, role)} ${c.name}, ${yearsW(a)}.`, c.gender) + (role === "child" ? gtext(" Ты пережил(а) своего ребёнка.", L.gender) : ""), "death");
      CL.addTablet(data, s, { name: c.name, gender: c.gender, gen: (L.generation || 1) + (KIN_GEN[role] ?? 1), role: kinWord(c, role), age: a, realm: c.realmIndex || c.layer > 1 ? `${G.pathOf(data, childState(data, s, c)).name}: ${G.realmsOf(data, childState(data, s, c))[c.realmIndex || 0].name}` : "" });
    }
  }
}
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
export function marryKin(data, s, c, rng, loud = true, role = "child") {
  const L = s.life;
  const sg = c.gender === "m" ? "f" : "m";
  let p, n = 0;
  do { p = generatePerson(data, rng, { gender: sg, regionId: L.regionId, wealthId: L.wealthId, noRoot: true }); n++; } while (p.surname === L.surname && n < 20);
  c.spouse = { name: p.name, surname: p.surname, gender: sg, type: "arranged", jobId: defaultJob(data, s)?.id || "home", physiqueId: p.physiqueId, physiqueName: p.physiqueName, stats: p.stats };
  ensureGenes(data, c.spouse, rng);
  if (loud) KF.famNote(data, s, c, gtext(`${role !== "child" ? cap(kinWord(c, role)) + " " : ""}${c.name} сочетался(ась) браком: ${p.name}.`, c.gender), "marriage");
}
export function marriageBlocked(data, s) { return S.marriageBlocked(data, s); }
// Довести сейв до живой семьи, рода и секты v10 (идемпотентно; main.js после загрузки).
export function ensureKin(data, s, rng = Math.random) {
  fmtData = data;
  if (!s.life) return;
  KF.ensureFam(data, s, rng);
  CL.ensureClan(data, s, rng);
  S.ensureSect(data, s, rng);
}

// ───── Наследование: у ребёнка двое родителей ─────
// Как в ранобэ («Смертный путь к бессмертию» и др.): корни идут по крови, но не наверняка. У двух родителей с корнями ребёнок
// с корнями чаще, у двух смертных — реже. Сила корня (число стихий) тянется к среднему родителей, чаще вниз:
// чистый корень хрупок. Стихии — из стихий отца и матери, иногда своя. Пара стихий родителей изредка
// сплавляется в мутацию (Огонь+Вода → Гром, Металл+Вода → Лёд). Особое телосложение — дар неба, а не крови:
// каждый родитель передаёт своё с шансом physiques[].inherit, иначе жребий. Параметры — world.life.inherit.
const MUT_PAIRS = { "Гром": ["Огонь", "Вода"], "Лёд": ["Металл", "Вода"] };
const inh = data => data.world.life.inherit || {};
function baseElements(data, p) {
  const pairs = inh(data).mutantPairs || MUT_PAIRS;
  return [...new Set((p?.elements || []).flatMap(e => pairs[e] || [e]))];
}
function driftPick(d, rng) {
  const list = d || [[-1, 0.15], [0, 0.5], [1, 0.35]];
  let x = rng() * list.reduce((t, [, w]) => t + w, 0);
  for (const [v, w] of list) { x -= w; if (x < 0) return v; }
  return 0;
}
// Супругам из старых сейвов и NPC без «генов» — дорисовать: тело по имени или жребием, корни и душу жребием.
export function ensureGenes(data, p, rng = Math.random, needRoot = false) {
  if (!p) return p;
  const W = data.world;
  if (!p.physiqueId || !by(W.physiques, p.physiqueId)) p.physiqueId = W.physiques.find(x => x.name === p.physiqueName)?.id || wpick(W.physiques, rng).id;
  if (!p.rootId) {
    let r = rollRoot(data, rng);
    for (let i = 0; needRoot && !(r.root.qiMult > 0) && i < 50; i++) r = rollRoot(data, rng);
    p.rootId = r.root.id; p.elements = r.elements;
  }
  if (p.soulId === undefined) p.soulId = rollSoul(data, rng)?.id || null;
  return p;
}
// a, b — родители { who, rootId, elements, physiqueId, soulId }; b может быть null.
export function inheritGenes(data, rng, a, b) {
  const W = data.world, C = inh(data), pairs = C.mutantPairs || MUT_PAIRS;
  const ps = [a, b].filter(Boolean), rootOf = p => by(W.roots, p.rootId);
  const rooted = ps.filter(p => rootOf(p)?.qiMult > 0);
  const strength = p => rootOf(p).special ? 2 : (rootOf(p).count || 1); // мутация — сплав двух стихий: для детей она как двойной корень
  let root = by(W.roots, "none") || W.roots[0], elements = [];
  if (rng() < (C.rootChance || [0.3, 0.55, 0.8])[rooted.length]) {
    const pool = [...new Set(rooted.flatMap(p => baseElements(data, p)))];
    const mutP = rooted.find(p => rootOf(p).special);
    const pair = Object.entries(pairs).find(([, xy]) => xy.every(x => pool.includes(x)));
    const pairRoot = pair && W.roots.find(r => r.special?.includes(pair[0]));
    if (mutP && rng() < (C.mutantFromParent ?? 0.25)) { root = rootOf(mutP); elements = [...mutP.elements]; }
    // Сплав пары стихий тем вероятнее, чем чище корни родителей: у «пяти корней» стихии разбавлены.
    else if (rooted.length === 2 && pairRoot && rng() < (C.mutantFromPair ?? 0.04) * 2 / Math.max(2, (strength(rooted[0]) + strength(rooted[1])) / 2)) { root = pairRoot; elements = [pair[0]]; }
    else {
      if (rooted.length && rng() < (C.rootFromParents ?? 0.6)) {
        const n = Math.round(rooted.reduce((t, p) => t + strength(p), 0) / rooted.length) + driftPick(C.drift, rng);
        root = W.roots.find(r => !r.special && r.count === clamp(n, 1, 5)) || root;
      } else root = wpick(W.roots.filter(r => r.qiMult > 0), rng);
      if (root.special) elements = [pick(root.special, rng)];
      else {
        const left = [...pool], rest = W.elements.filter(e => !pool.includes(e));
        for (let i = 0; i < root.count; i++) {
          const arr = left.length && (rng() < (C.elemFromParents ?? 0.8) || !rest.length) ? left : rest;
          if (arr.length) elements.push(arr.splice(Math.floor(rng() * arr.length), 1)[0]);
        }
      }
    }
  }
  const rootSrc = {};
  for (const p of ps) { const be = baseElements(data, p); rootSrc[p.who || "x"] = elements.filter(e => (pairs[e] || [e]).some(x => be.includes(x))); }
  const order = rng() < 0.5 ? ps : [...ps].reverse();
  let phy = null, phyFrom = null;
  for (const p of order) { const ph = by(W.physiques, p.physiqueId); if (ph && rng() < (ph.inherit ?? C.physiqueDefault ?? 0.3)) { phy = ph; phyFrom = p.who || null; break; } }
  if (!phy) phy = wpick(W.physiques, rng);
  let soulId = null;
  for (const p of order) if (p.soulId && rng() < (C.soulFromParent ?? 0.25)) { soulId = p.soulId; break; }
  if (!soulId) soulId = rollSoul(data, rng)?.id || null;
  if (phy.soulFloor && W.souls) { const f = W.souls.findIndex(x => x.id === phy.soulFloor), i = W.souls.findIndex(x => x.id === soulId); if (i < f) soulId = phy.soulFloor; }
  return { rootId: root.id, elements, rootSrc, physiqueId: phy.id, phyFrom, soulId };
}
// «Стихии: от тебя — огонь; от жены — вода; своё — земля» (для строки летописи на камне проверки).
// Пол второго родителя запомнен при рождении (otherG): супруг мог смениться.
function originText(s, c) {
  const src = c.rootSrc; if (!src || !c.elements?.length) return "";
  const og = c.otherG ?? s.life.spouse?.gender, spw = og === "m" ? "от мужа" : og === "f" ? "от жены" : "от второго родителя";
  const groups = { "от обоих": [], "от тебя": [], [spw]: [], "своё": [] };
  for (const e of c.elements) { const a = src.self?.includes(e), b = src.spouse?.includes(e); groups[a && b ? "от обоих" : a ? "от тебя" : b ? spw : "своё"].push(e.toLowerCase()); }
  return ". Стихии: " + Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `${k} — ${v.join(", ")}`).join("; ");
}
export function genesText(data, p) {
  const phy = by(data.world.physiques, p?.physiqueId)?.name || p?.physiqueName, bits = [];
  if (phy) bits.push(`тело «${phy}»`);
  if (p?.rootId) bits.push(rootText(data, p));
  return bits.join(" · ");
}

function makeChild(data, s, rng) {
  const L = s.life, gender = rng() < 0.5 ? "m" : "f";
  const me = { who: "self", rootId: L.rootId, elements: L.elements, physiqueId: L.physiqueId, soulId: L.soulId };
  const sp = L.spouse ? { who: "spouse", ...ensureGenes(data, L.spouse, rng) } : null;
  const gn = inheritGenes(data, rng, me, sp);
  // Имя не повторяет имя родителя, супруга и братьев с сёстрами.
  const taken = new Set([L.name, L.spouse?.name, ...L.children.map(c => c.name)].filter(Boolean).map(n => n.split(" ").slice(1).join(" ")));
  let nm = pick(data.world.names[gender], rng); for (let k = 0; k < 12 && taken.has(nm); k++) nm = pick(data.world.names[gender], rng);
  const child = generatePerson(data, rng, { gender, given: nm, surname: L.surname, age: 0, regionId: L.regionId, wealthId: L.wealthId,
    physiqueId: gn.physiqueId, rootId: gn.rootId, elements: gn.elements, noRoot: true });
  return { name: child.name, gender, born: L.age, rootId: gn.rootId, elements: gn.elements, rootSrc: gn.rootSrc, phyFrom: gn.phyFrom, otherG: L.spouse?.gender || null,
    alive: true, task: "home", soulId: gn.soulId, awakened: false, pathId: null, realmIndex: 0, layer: 1, qi: 0, spouse: null, kids: [], sect: null,
    physiqueId: gn.physiqueId, physiqueName: child.physiqueName, stats: child.stats, talentId: randTalent(data, rng) };
}
const randTalent = (data, rng) => { const T = data.world.talents || []; return T.length ? T[Math.floor(rng() * T.length)].id : null; };
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
  if (job.need && (who !== "self" || jobNeedWhy(data, s, job))) return false;
  return true;
}
// Чего не хватает для работы (jobs.json → need): секта, ранг в секте, ступень пути, навык ремесла. Пустая строка — всё есть.
export function jobNeedWhy(data, s, job) {
  const n = job?.need, L = s.life; if (!n || !L) return "";
  if (n.sect && !L.sect) return "только для учеников секты";
  if (n.sectRank != null && (!L.sect || (L.sect.rank ?? 0) < n.sectRank)) return `с ранга «${data.sects?.ranks?.[n.sectRank]?.name || "выше"}»`;
  if (n.tier != null && (!L.awakened || G.maxTier(data, s) < n.tier)) return `со ${n.tier + 1}-й ступени пути`;
  for (const [k, v] of Object.entries(n.skill || {})) if (CR.skill(s, k) < v) return `нужен навык «${(data.crafts?.skills?.[k]?.name || k).toLowerCase()}» ${v}`;
  return "";
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
  const names = { home: "остаётся дома", help: "помогает по дому", letters: "учит грамоту", workshop: "учится ремеслу в мастерской" };
  logLine(s, `${c.name} ${names[task] || task}.`, "family");
  return { ok: true };
}
export function defaultJob(data, s) {
  const list = (data.jobs?.jobs || []).filter(j => jobEligible(data, s, j));
  const byRegion = { huangfeng: "field", haiyun: "fisher", hanmu: "herder", qinglong: "woodcutter", penglai: "penglai_keeper",
    yanjing: "capital_runner", liangzhou: "camel", kunlun: "pass_guide", hedu: "ruin_digger" };
  const pref = { poor: "beggar", peasant: byRegion[s.life.regionId] || "porter", craft: "stall", noble: "scribe", cultclan: "home" }[s.life.wealthId];
  return list.find(j => j.id === pref) || list.find(j => j.id === "porter") || list[0] || null;
}
export function setJob(data, s, id, who = "self", rng = Math.random) {
  const job = jobById(data, id); if (!job || !jobEligible(data, s, job, who)) return { ok: false, msg: "Это ремесло здесь не возьмут." };
  if (who === "spouse" && s.life.spouse?.jobId === id) return { ok: true };
  if (who !== "spouse" && s.life.jobId === id) return { ok: true };
  if (who === "spouse") {
    if (!s.life.spouse) return { ok: false, msg: "Нет супруга." };
    s.life.spouse.jobId = id;
    const took = s.life.spouse.gender === "m" ? "взял" : "взяла";
    logLine(s, `${s.life.spouse.gender === "m" ? "Супруг" : "Супруга"} ${took} работу: ${job.name}.`, "family");
  } else {
    // Найм (craft.js → hireInfo): без опыта и навыка берут неохотно. Отказ — снова через год.
    const hi = CR.hireInfo(data, s, job);
    if (hi.chance < 1) {
      if (CR.refusedNow(s, id)) return { ok: false, refused: true, msg: `«${job.name}»: в этом году тебе уже отказали. Попробуй через год.` };
      if (rng() >= hi.chance) {
        CR.markRefused(s, id);
        const why = hi.lv < hi.req ? "сказали, что нужен человек с опытом" : "взяли своего человека";
        const m = `Тебя не взяли на работу «${job.name}» (шанс был ${Math.round(hi.chance * 100)}%): ${why}. Снова — через год.`;
        logLine(s, m, "family"); return { ok: false, refused: true, msg: m };
      }
    }
    s.life.jobId = id;
    logLine(s, `Ты взял(а) работу: ${job.name}${hi.chance < 1 ? ` — взяли с ${Math.round(hi.chance * 100)}% шансом` : ""}.`, "family");
  }
  return { ok: true };
}

export function makeSpouse(data, s, type, rng) {
  const L = s.life, W = data.world, gender = L.gender === "m" ? "f" : "m";
  const job = defaultJob(data, s);
  
  // Собираем запрещённые фамилии (родственники)
  const forbiddenSurnames = [L.surname];
  if (L.household?.mother) {
    forbiddenSurnames.push(L.household.mother.name.split(" ")[0]);
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
  
  return ensureGenes(data, {
    name: spouse.name,
    surname: spouse.surname,
    gender,
    type,
    jobId: job?.id || "home",
    physiqueId: spouse.physiqueId,
    physiqueName: spouse.physiqueName,
    stats: spouse.stats,
  }, rng, type === "companion"); // даолюй — всегда культиватор
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
  if (ef.zhuazhou && !L.talentId) { // чжуачжоу: 60% — то, что положили ближе, иначе что угодно
    const T = data.world.talents || [], near = T.find(x => x.id === ef.zhuazhou);
    const t = near && rng() < 0.6 ? near : T[Math.floor(rng() * T.length)];
    if (t) { L.talentId = t.id; for (const [k, v] of Object.entries(t.start || {})) st[k] = (st[k] || 0) + v;
      logLine(s, `Чжуачжоу: ${near && t !== near ? "мимо положенного — " : ""}${t.item}. ${t.text}`, "birth"); }
  }
  if (ef.legacy) L.legacyBonus += ef.legacy;
  if (ef.tech) { // техника в подарок: учится бесплатно и встаёт в слот, если лучше пустого
    const t = G.techById(data, ef.tech);
    if (t && !s.ownedTechniques.includes(t.id)) {
      s.ownedTechniques.push(t.id);
      if (!s.techniqueSlots[t.type]) G.equipTechnique(data, s, t.id);
      logLine(s, `Освоено без платы: «${t.name}».`, "cult");
    }
  }
  // Родня, род, секта (family.js, clan.js, sect.js): уход из секты — раньше брака и вступления.
  S.applyEffects(data, s, ef, rng);
  KF.applyEffects(data, s, ef, rng);
  CL.applyEffects(data, s, ef, rng);
  CR.applyEffects(data, s, ef, rng);
  if (ef.sect && !L.sect && L.awakened) S.joinSect(data, s, ef.sect, ef.sectRank ?? 1, rng);
  if (ef.scroll && L.awakened) { const t = G.luckyScroll(data, s, rng); logLine(s, t ? `Свиток в руках: «${t.name}». Теперь он и в родовой библиотеке.` : "Свиток оказался пустым: всё это ты уже знаешь.", "luck"); }
  if (ef.sectTech && L.sect) {
    const t = G.luckyScroll(data, s, rng, L.sect.id);
    if (t) logLine(s, `Старейшина открыл тебе «${t.name}». Об этом не говорят вслух.`, "luck"); else { s.spiritStones += 30; logLine(s, "Свитков твоего ранга больше нет — старейшина выдал 30 камней на пилюли.", "cult"); }
  }
  if (ef.spouse && !L.spouse && S.marriageBlocked(data, s)) {
    st.daoHeart = clamp(st.daoHeart + 1, -5, 20);
    logLine(s, `Устав ${G.sectById(data, L.sect.id)?.name}: монаху брака нет. Ты промолчал(а) и вернулся(ась) к утренней службе.`, "sect");
  } else if (ef.spouse && !L.spouse) {
    L.spouse = makeSpouse(data, s, ef.spouse, rng);
    const how = { love: "по любви", arranged: "по воле семьи", companion: "как даолюй" }[ef.spouse];
    KF.famNote(data, s, L.spouse, `Ты сочетался(ась) браком ${how}: ${L.spouse.name}.`, "marriage");
    CL.onMarriage(data, s, ef.spouse);
  }
  // Понимание другого пути: ци в другой открытый путь (начатый — в первую очередь). Встанешь на него — прорвёшься быстрее.
  if (ef.otherPathQi && L.awakened) {
    const cur = s.pathId || "qi", ids = G.openPaths(data, s).filter(id => id !== cur), started = ids.filter(id => s.paths?.[id]);
    const pool = started.length ? started : ids;
    if (pool.length) {
      const id = pick(pool, rng), pr = G.pathProbe(data, s, id), need = G.qiRequired(data, pr);
      s.paths = { ...(s.paths || {}) };
      const rec = s.paths[id] ||= { realmIndex: pr.realmIndex, layer: pr.layer, qi: pr.qi, gateAge: null, slots: { ...pr.techniqueSlots } };
      rec.qi = clamp(rec.qi + ef.otherPathQi * need, 0, need);
      logLine(s, `${G.pathDef(data, id).name} отозвался: ${Math.round(rec.qi / need * 100)}% до следующего слоя. Ци этого пути ждёт, пока ты на него встанешь.`, "cult");
    }
  }
  // Дети на Пути получают долю ци до своего слоя (наставник, удача, пример родителя).
  if (ef.kidQi) {
    const kids = L.children.filter(c => c.alive && c.awakened);
    for (const c of kids) { const cs = childState(data, s, c), need = G.qiRequired(data, cs); c.qi = clamp((c.qi || 0) + ef.kidQi * need, 0, need); }
    if (kids.length) logLine(s, `${kids.length === 1 ? gtext(kids[0].name + " продвинулся(ась)", kids[0].gender) : "Дети продвинулись"} на Пути.`, "family");
  }
  if (ef.spouseDeath && L.spouse) {
    const sp = L.spouse; L.spouse = null;
    KF.famNote(data, s, null, `${sp.gender === "m" ? "Не стало твоего супруга" : "Не стало твоей супруги"} ${sp.name}.`, "death");
    CL.addTablet(data, s, { name: sp.name, gender: sp.gender, gen: L.generation || 1, role: sp.gender === "m" ? "муж" : "жена", age: null });
  }
  if (ef.childDeath) {
    const kid = [...L.children].reverse().find(c => c.alive);
    if (kid) { kid.alive = false; kid.diedAt = L.age; kid.deathAge = childAge(s, kid); KF.famNote(data, s, kid, gtext(`Умер(ла) твой ребёнок ${kid.name}. Дом на время стал тише.`, kid.gender), "death");
      CL.addTablet(data, s, { name: kid.name, gender: kid.gender, gen: (L.generation || 1) + 1, role: kid.gender === "m" ? "сын" : "дочь", age: kid.deathAge }); }
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
  // Испытания секты (scripted) не занимают место обычной карточки: пауза между карточками не сбрасывается.
  L.usedEvents.push(e.id); if (!e.scripted) L.lastEventAge = L.age; L.pending = null; L.autoHold = false; L.autoPick = null;
  const out = `«${fmt(s, e.title)}» — ${c.label.toLowerCase()}. ${parts.join(" ")}`;
  if (L.alive) logLine(s, out, "event");
  return { ok: true, msg: fmt(s, out), died: !L.alive };
}

// Автовыбор по склонности: оценка ожидаемого исхода (эффекты + вероятностные бонусы и риски).
const WEIGHTS = {
  virtue: ef => (ef.karma || 0) * 3 + (ef.connections || 0) * 0.7 + (ef.kidQi || 0) * 2 + (ef.death ? -100 : 0) + (ef.spouseDeath ? -20 : 0),
  dao: ef => (ef.daoHeart || 0) * 3 + (ef.qiPct || 0) * 10 + (ef.otherPathQi || 0) * 8 + (ef.years || 0) * 0.4 + (ef.legacy || 0) + (ef.death ? -100 : 0),
  wealth: ef => (ef.stones || 0) * 0.7 + (ef.connections || 0) * 1.5 + (ef.pill || 0) * 3 + (ef.death ? -100 : 0),
  safe: ef => (ef.years || 0) * 0.5 + (ef.karma || 0) * 0.5 + (ef.stones || 0) * 0.1 + (ef.qiPct || 0) * 3 + (ef.otherPathQi || 0) * 2 + (ef.death ? -100 : 0) + (ef.childDeath ? -30 : 0) + (ef.spouseDeath ? -30 : 0),
  best: ef => (ef.years || 0) * 2 + (ef.qiPct || 0) * 12 + (ef.daoHeart || 0) * 2 + (ef.stones || 0) * 0.5 + (ef.pill || 0) * 4 + (ef.legacy || 0) * 2 + (ef.karma || 0) * 0.4 + (ef.connections || 0) * 0.6 + (ef.spouse ? 6 : 0) + (ef.tech ? 5 : 0) + (ef.sect ? 8 : 0) + (ef.scroll ? 5 : 0) + (ef.sectTech ? 5 : 0) + (ef.otherPathQi || 0) * 8 + (ef.kidQi || 0) * 6 + (ef.death ? -200 : 0) + (ef.childDeath ? -40 : 0) + (ef.spouseDeath ? -40 : 0),
};
// Родня, род и секта в оценке варианта (одинаково для всех склонностей, кроме знаков у «добродетели»).
const KIN_W = ef => (ef.harmony || 0) * 0.3 + (ef.famWealth || 0) * 0.4 + (ef.rep || 0) * 0.5 + (ef.treasury || 0) * 0.05 + (ef.contrib || 0) * 0.2 + (ef.sectStanding || 0) * 0.3
  + (ef.masterRel || 0) * 0.1 + (ef.rivalRel || 0) * 0.05 + (ef.allyRel || 0) * 0.08 + (ef.parentYears || 0) * 0.8
  + (ef.sectTrial ? 10 : 0) + (ef.sectHeir ? 8 : 0) + (ef.sectHeirLost ? -8 : 0) + (ef.sectYield ? -6 : 0) + (ef.masterGift ? 6 : 0) + (ef.allyMarriage ? 7 : 0) + (ef.rivalMarriage ? 5 : 0) + (ef.feudEnd ? 5 : 0) + (ef.warEnd ? 3 : 0) + (ef.sibSect ? 2 : 0) + (ef.clanRule ? 1 : 0)
  + (ef.parentDeath ? -25 : 0) + (ef.spouseLeave ? -15 : 0) + (ef.sectLeave ? -18 : 0) + (ef.sectExpel ? -40 : 0) + (ef.masterDeath ? -4 : 0) + (ef.peerFriendLost ? -3 : 0) + (ef.sectWait ? -1 : 0)
  + (ef.sectTreasury || 0) * 0.03 + (ef.sectFortify ? 3 : 0) + (ef.sectDeclareWar ? -2 : 0) + (ef.sectTruce ? 2 : 0) + (ef.sectAlly ? 5 : 0) + (ef.discipleNew ? 4 : 0) + (ef.discipleTrain ? 3 : 0)
  + (ef.discipleLoss ? -4 : 0) + (ef.sectGrudge || 0) * -4 + (ef.sectGrudgeClear ? 4 : 0);
function choiceScore(c, mode) {
  const base = WEIGHTS[mode], f = ef => base(ef) + KIN_W(ef) + CR.scoreFx(ef);
  const riskN = (mode === "safe" || mode === "best") ? 3 : 1;
  return f(c.effects || {}) + (c.bonus ? c.bonus.p * f(c.bonus.effects) : 0) + (c.risk ? c.risk.p * f(c.risk.effects) * riskN : 0);
}
// Какой вариант выберет авторежим: список лучших (при равенстве — жребий). Интерфейс показывает первый заранее.
export function autoPickList(data, s, mode = "best") {
  const e = by(data.events.events, s.life.pending);
  const use = WEIGHTS[mode] ? mode : "best";
  if (!e) return [];
  let best = [], top = -Infinity;
  e.choices.forEach((c, i) => {
    if (c.minStones && s.spiritStones < c.minStones) return;
    const sc = choiceScore(c, use);
    if (sc > top + 1e-9) { top = sc; best = [i]; } else if (Math.abs(sc - top) < 1e-9) best.push(i);
  });
  return best;
}
export function autoChoose(data, s, mode, rng = Math.random) {
  const best = autoPickList(data, s, mode);
  if (!best.length) return null;
  const i = s.life.autoPick != null && best.includes(s.life.autoPick) ? s.life.autoPick : pick(best, rng);
  s.life.autoPick = null;
  return chooseOption(data, s, i, rng);
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
    if (d) { L.jobId = d.id; logLine(s, `В ${yearsW(L.age)} ты встал(а) к делу: ${d.name}.`, "family"); }
  }
  // Ушёл(ла) из секты, потерял(а) ранг — место при секте больше не твоё.
  if (J && L.jobId && L.jobId !== "home" && !jobEligible(data, s, jobById(data, L.jobId))) {
    const was = jobById(data, L.jobId), d = defaultJob(data, s);
    L.jobId = d?.id || "home";
    logLine(s, `Место «${was?.name || "работа"}» больше не твоё. Теперь: ${d?.name || "дом и двор"}.`, "family");
  }
  const focus = (J?.focuses || []).find(x => x.id === L.focusId) || J?.focuses?.[0];
  const phyY = by(W.physiques, L.physiqueId), tal = G.talentOf(data, s);
  if (L.age > 16) { L.focusYears ??= {}; L.focusYears[L.focusId] = (L.focusYears[L.focusId] || 0) + 1; }
  if (L.spouse) L.marriedYears = (L.marriedYears || 0) + 1;
  let pay = 0;
  if (J && L.age >= J.workAge) {
    const own = jobById(data, L.jobId), sp = L.spouse && jobById(data, L.spouse.jobId);
    pay = (own?.stones || 0) * CR.payMul(data, s, L.jobId) + (sp?.stones || 0);
    pay += L.children.filter(c => c.alive && childAge(s, c) >= J.childHelpAge && c.task === "help").length * (J.childHelpStones || 0);
    pay = Math.round(pay * (focus?.payMul ?? 1) * (phyY?.payMul ?? 1) * (tal?.payMul ?? 1));
    if (pay) s.spiritStones += pay;
    if (pay && L.age % 5 === 0) logLine(s, `Год работы (${focus?.name || "дом"}): ${stonesW(pay)}.`, "family");
  }
  CR.yearCraft(data, s, rng);
  for (const c of L.children) {
    if (c.alive && c.task === "letters" && childAge(s, c) >= 6 && rng() < 0.12 * CL.lettersMul(data, s)) {
      L.stats.connections = clamp(L.stats.connections + 1, 0, 30);
      logLine(s, `${c.name} вывел(а) новый иероглиф. В доме стало тише и светлее.`, "family");
    }
  }
  if (L.spouse && rng() < (wl.spouseDeathHazard + (L.age > 80 ? 0.02 : 0)) * (phyY?.spouseHazardMul ?? 1)) {
    const sp = L.spouse;
    KF.famNote(data, s, null, `${sp.gender === "m" ? "Умер твой супруг" : "Умерла твоя супруга"} ${sp.name}. ${L.gender === "m" ? "Ты остался один." : "Ты осталась одна."}`, "death");
    CL.addTablet(data, s, { name: sp.name, gender: sp.gender, gen: L.generation || 1, role: sp.gender === "m" ? "муж" : "жена", age: null });
    L.spouse = null;
  }
  // Окно рождений: с b0 лет и до max(b1, birthUntilShare × срок) — культиваторы женятся поздно и живут долго.
  const [b0, b1x] = wl.childBirthAges ?? [20, 50], b1 = wl.birthUntilShare ? Math.max(b1x, Math.round(wl.birthUntilShare * lifespan(data, s))) : b1x;
  if (L.spouse && L.age >= b0 && L.age <= b1 && L.children.filter(c => c.alive).length < wl.childMax && rng() < wl.childBirthChance * (focus?.birthMul ?? 1) * (phyY?.birthMul ?? 1) * KF.birthMul(data, s)) {
    const kid = makeChild(data, s, rng); L.children.push(kid);
    KF.famNote(data, s, kid, `В семье ${kid.gender === "m" ? "родился сын" : "родилась дочь"} — ${kid.name}. Телосложение «${kid.physiqueName}»${kid.phyFrom === "self" ? " — в тебя" : kid.phyFrom === "spouse" ? ` — в ${L.spouse.gender === "m" ? "отца" : "мать"}` : ""}.`, "birth");
  }
  const wealth = by(W.wealth, L.wealthId);
  for (const c of L.children) if (c.alive && childAge(s, c) < 16 && rng() < wealth.hazard * 0.8) {
    c.alive = false; c.diedAt = L.age; c.deathAge = childAge(s, c);
    KF.famNote(data, s, c, gtext(`Умер(ла) твой ребёнок ${c.name}: детская лихорадка не пощадила.`, c.gender), "death");
    CL.addTablet(data, s, { name: c.name, gender: c.gender, gen: (L.generation || 1) + 1, role: c.gender === "m" ? "сын" : "дочь", age: c.deathAge });
  }
  growChildren(data, s, rng);
  // Живая семья, род и секта — по году (family.js, clan.js, sect.js).
  KF.familyYear(data, s, rng);
  CL.clanYear(data, s, rng, pay);
  S.sectYear(data, s, rng);
  if (!L.alive) return;
  // Друзья делятся свитками: с 8 связей, 0.4% за каждую связь сверх 6.
  if (L.awakened && L.stats.connections >= 8 && rng() < 0.004 * (L.stats.connections - 6)) {
    const t = G.luckyScroll(data, s, rng);
    if (t) logLine(s, `Старый друг из цзянху переписал для тебя «${t.name}» — по дружбе, не по уставу.`, "luck");
  }
  const jobHaz = (jobById(data, L.jobId)?.hazard || 0) * CR.hazMul(data, s, L.jobId) + (L.spouse ? (jobById(data, L.spouse.jobId)?.hazard || 0) * 0.3 : 0);
  const yishu = G.slottedTechs(data, s).yishu;
  const phy = by(W.physiques, L.physiqueId);
  let hz = (wealth.hazard + jobHaz) * by(W.regions, L.regionId).hazardMult * by(W.eras, L.eraId).hazardMult * (focus?.hazardMul ?? 1) * (phy?.hazard || 1) * (tal?.hazard || 1) * (1 - (yishu?.hazardCut || 0))
    * KF.hazardMul(data, s) * CL.feudHazardMul(data, s) * S.hazardMul(data, s);
  if (L.awakened) hz *= wl.awakenedHazardMult * Math.pow(wl.realmHazardDecay ?? 0.5, G.maxTier(data, s)) * (G.pathOf(data, s).hazardMul ?? 1);
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
  milestone(data, s);
  if (L.age === 1 && !L.zz) { L.zz = true; if (by(data.events.events, "zhuazhou")) { L.pending = "zhuazhou"; return; } }
  const pz = (W.pauses || []).find(p => p.age === L.age);
  if (pz && !s.settings?.noPauses) { L.pause = { age: L.age, q: fmt(s, pz.q), stat: survivalLine(data, s, L.age) }; return; }
  // Испытание на ранг секты — как только выполнены условия (sect.js → trialDue).
  const trial = S.trialDue(data, s);
  if (trial) { L.pending = trial; return; }
  if (L.age - L.lastEventAge >= T.minEventGapYears && rng() < T.eventChancePerYear) {
    const e = drawEvent(data, s, rng); if (e) L.pending = e.id;
  }
}

// ───── Статистика «1 из N» по прогонам симуляции (world.survival) ─────
const AGE_WORD = { 1: "года", 5: "пяти лет", 15: "пятнадцати", 30: "тридцати", 50: "пятидесяти", 70: "семидесяти", 100: "ста лет", 150: "ста пятидесяти", 200: "двухсот лет" };
export function survivalAt(data, regionId, age) {
  const S = data.world.survival; if (!S) return null;
  const row = S.byRegion?.[regionId] || S.all, A = S.ages;
  if (age <= A[0]) return row[0];
  for (let i = 1; i < A.length; i++) if (age <= A[i]) { const k = (age - A[i - 1]) / (A[i] - A[i - 1]); return row[i - 1] + (row[i] - row[i - 1]) * k; }
  return row[row.length - 1];
}
const pctW = v => v >= 0.995 ? "почти все" : v < 0.005 ? "почти никто" : `${Math.round(v * 100)}%`;
function survivalLine(data, s, age) {
  const L = s.life, v = survivalAt(data, L.regionId, age); if (v == null) return "";
  const reg = by(data.world.regions, L.regionId)?.name, who = L.gender === "m" ? "мальчиков" : "девочек";
  return `Из ${who}, родившихся в краю «${reg}», до ${AGE_WORD[age] || age + " лет"} доживают ${pctW(v)}.`;
}
function milestone(data, s) {
  const L = s.life; if (!(data.world.milestones || []).includes(L.age) || (data.world.pauses || []).some(p => p.age === L.age && !s.settings?.noPauses)) return;
  const line = survivalLine(data, s, L.age); if (line) logLine(s, `Тебе ${L.age} ${L.age === 1 ? "год" : "лет"}. ${line}`, "stat");
}
export function closePause(data, s, text = "") {
  const L = s.life, p = L.pause; if (!p) return;
  L.pause = null;
  const t = String(text || "").trim().slice(0, 300);
  if (t) { (L.notes ??= []).push({ age: p.age, q: p.q, text: t }); logLine(s, `«${t}» — запись в ${p.age} ${p.age === 1 ? "год" : "лет"}.`, "note"); L.chronicle[L.chronicle.length - 1].star = true; }
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
  if (yearHook && L.alive && !L.pending && !L.pendingRoot && !L.pause) yearHook(data, s, rng);
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
  if (!L || !L.alive || L.pending || L.pendingRoot || L.pause || L.phase !== "play") { s.lastReal = now; return s; }
  if (s.lastReal == null) s.lastReal = now;
  const real = clamp((now - s.lastReal) / 1000, 0, T.maxCatchUpSec); s.lastReal = now;
  const sp = T.speeds[s.settings.speed] ?? T.speeds.normal;
  if (sp.untilEvent) {
    const cap = T.skipCapYears ?? 500;
    // Ручная игра: «до следующего выбора» останавливается и ставит паузу, когда ци набрана на прорыв, —
    // иначе прокрутка сразу уходит к следующей карточке, и нажать «Прорыв» не успеть.
    const manual = !s.settings?.autoPlay, ready0 = L.awakened && G.canBreakthrough(data, s);
    for (let n = 0; L.alive && !L.pending && !L.pendingRoot && !L.pause && n < cap; n++) {
      consumeYear(data, s, rng);
      if (manual && !ready0 && L.alive && L.awakened && G.canBreakthrough(data, s)) {
        s.settings.speed = "pause";
        logLine(s, "Ци набрана: можно идти на прорыв. Время остановлено.", "cult");
        break;
      }
    }
    L.yearAcc = 0;
    return s;
  }
  const dt = real * (sp.factor ?? 1);
  if (dt <= 0) return s;
  advanceClock(data, s, dt);
  L.yearAcc += dt;
  while (L.alive && !L.pending && !L.pendingRoot && !L.pause) {
    const yl = yearLength(T, L.age);
    if (L.yearAcc < yl) break;
    L.yearAcc -= yl;
    yearPass(data, s, rng);
    afterYear(data, s, rng);
  }
  return s;
}

// ───── Запись о смерти: биография, «1 из N», самый счастливый год, кто попрощался, узор жизни ─────
function happiestYear(L) {
  const score = {}, why = {};
  const add = (age, v, w) => { score[age] = (score[age] || 0) + v; if (v > 0 && (!why[age] || v >= why[age][0])) why[age] = [v, w]; };
  for (const x of L.chronicle) {
    const m = x.msg;
    if (/сочетал(ся|ась)? браком|сочетался\(ась\) браком/.test(m) && x.kind === "family") add(x.age, m.startsWith("Ты") ? 4 : 1, m.startsWith("Ты") ? "год, когда пришла любовь" : "год свадьбы ребёнка");
    else if (/^В семье родил/.test(m)) add(x.age, 3, "год рождения ребёнка");
    else if (/твой внук|твоя внучка/.test(m)) add(x.age, 2, "год рождения внука");
    else if (x.kind === "break" && /слой 1\.?$/.test(m)) add(x.age, 3, "год новой ступени");
    else if (x.kind === "awaken" && /вступил/.test(m)) add(x.age, 2, "год, когда приняла секта");
    else if (x.kind === "luck") add(x.age, 1, "год удачи");
    else if (/^Умер|^Умерла|Ты пережил/.test(m)) add(x.age, -5, "");
  }
  let best = null;
  for (const [a, v] of Object.entries(score)) if (v > 0 && (!best || v > best.v)) best = { age: +a, v, why: why[a]?.[1] || "" };
  return best || { age: Math.min(L.age, 9), why: "детство" };
}
function lifePattern(data, s, L) {
  const P = data.world.patterns; if (!P) return null;
  const fy = L.focusYears || {}, home = (fy.family || 0) + (fy.rest || 0) + (fy.work || 0), road = (fy.practice || 0) * 1.3 + (s.wins + s.losses) * 0.3;
  const kids = L.children.length, grand = L.children.reduce((t, c) => t + (c.kids || []).length, 0);
  const roots = kids * 6 + grand * 2 + (L.marriedYears || 0) * 0.5, wind = (s.wins + s.losses) * 0.6 + (L.sect ? 8 : 0);
  const st = L.stats, quiet = Math.max(0, st.daoHeart) * 2 + 2, loud = Math.max(0, st.connections) * 1.2 + 1;
  const today = Math.max(0, st.karma) + kids * 2 + 3, ever = L.awakened ? (G.maxLevel(data, s) + 1) * 0.8 : 0;
  const ax = [[home, road], [roots, wind], [quiet, loud], [today, ever]].map(([a, b], i) => {
    const d = (b - a) / Math.max(1, a + b), side = d > 0.08 ? 1 : 0, w = Math.abs(d) < 0.08 ? "поровну" : Math.abs(d) < 0.35 ? "немного" : "сильно";
    return { a: P.pairs[i][0], b: P.pairs[i][1], side, word: w === "поровну" ? "поровну" : `${w} в сторону «${P.pairs[i][side]}»` };
  });
  const key = ax.map(x => x.side).join(""), nm = P.names[key] || ["", ""];
  return { key, name: nm[0], text: nm[1], axes: ax };
}
function otherPathsText(data, s) {
  if (!s.life?.awakened) return "";
  const rest = Object.entries(s.paths || {}).filter(([id, r]) => id !== s.pathId && r && (r.realmIndex || r.layer > 1));
  if (!rest.length) return "";
  return "Ещё " + rest.map(([id, r]) => { const p = G.pathDef(data, id); return `${p.name.toLowerCase()} — «${p.realms[r.realmIndex].name}», слой ${r.layer}`; }).join("; ") + ".";
}
export function deathReport(data, s, entry) {
  const L = s.life, W = data.world, reg = by(W.regions, L.regionId), wealth = by(W.wealth, L.wealthId), phy = by(W.physiques, L.physiqueId);
  const g = (m, f) => L.gender === "m" ? m : f, kids = L.children, alive = kids.filter(c => c.alive);
  const grand = kids.reduce((t, c) => t + (c.kids || []).filter(k => k.alive).length, 0);
  const tal = W.talents?.find(x => x.id === L.talentId), job = jobById(data, L.jobId);
  const expect = Math.round((reg?.expectLife || W.life.mortalBase) + (wealth?.lifeBonus || 0) + (phy?.lifeBonus || 0));
  const longer = survivalAt(data, L.regionId, L.age + 0.5);
  const bio = [
    `${g("Родился мальчиком", "Родилась девочкой")}: ${wealth.name.toLowerCase()}, ${reg.name}, ${by(W.eras, L.eraId).name.replace(/^Эпоха/, "эпоха")}.`,
    tal ? tal.bio : "",
    L.awakened ? (s.realmIndex || s.layer > 1 ? `${G.pathOf(data, s).name}: ${g("дошёл", "дошла")} до «${G.realmsOf(data, s)[s.realmIndex].name}», слой ${s.layer}.` : `Корни открылись, но дальше первого слоя Путь не пошёл.`) : g("На Путь так и не ступил.", "На Путь так и не ступила."),
    otherPathsText(data, s),
    L.sect ? `Секта ${G.sectById(data, L.sect.id)?.name}, ${G.sectRankName(s, data)}.` : (L.sectHistory?.length ? `Секта ${G.sectById(data, L.sectHistory[L.sectHistory.length - 1].id)?.name} — ${L.sectHistory[L.sectHistory.length - 1].how === "expel" ? "изгнание" : g("ушёл сам", "ушла сама")}.` : ""),
    job && job.id !== "home" ? `Последнее дело — «${job.name}».` : "",
    L.marriedYears ? `${yearsW(L.marriedYears)} в браке${L.spouse ? ", до самого конца" : ""}.` : g("В брак не вступал.", "В брак не вступала."),
    kids.length ? `${g("Вырастил", "Вырастила")} ${kids.length} ${plural(kids.length, "ребёнка", "детей", "детей")}${kids.length - alive.length ? `, ${kids.length - alive.length} — ${g("пережил", "пережила")}` : ""}.${grand ? ` Внуков: ${grand}.` : ""}` : "",
    `Жизнь закончилась в ${yearsW(L.age)}: ${entry.cause.toLowerCase().replace(/\.$/, "")}.`,
  ].filter(Boolean).join(" ");
  const bye = [];
  if (L.spouse) bye.push(`${L.spouse.gender === "m" ? "муж" : "жена"} ${L.spouse.name}`);
  if (alive.length) bye.push(`${alive.length} ${plural(alive.length, "ребёнок", "ребёнка", "детей")}`);
  if (grand) bye.push(`${grand} ${plural(grand, "внук", "внука", "внуков")}`);
  if (L.sect) bye.push(`братья и сёстры по секте`);
  if (L.stats.connections >= 6) bye.push("давние друзья");
  if (!bye.length) bye.push(L.age < 16 ? "родители" : "соседи");
  const fy = L.focusYears || {}, FN = Object.fromEntries((data.jobs?.focuses || []).map(f => [f.id, f.name]));
  const years = Object.entries(fy).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${FN[k] || k}: ${yearsW(n)}`);
  const hy = happiestYear(L), pat = lifePattern(data, s, L);
  const stars = L.chronicle.filter(x => x.star && x.kind !== "note").slice(-8).map(x => ({ age: x.age, msg: x.msg }));
  const share = [
    `${g("Я родился", "Я родилась")}: ${reg.name}, ${wealth.name.toLowerCase()}.`,
    L.awakened && (s.realmIndex || s.layer > 1) ? `${g("Дошёл", "Дошла")} до «${G.realmsOf(data, s)[s.realmIndex].name}».` : "",
    L.marriedYears ? `${yearsW(L.marriedYears)} рядом с ${L.spouse ? L.spouse.name : "любимым человеком"}.` : "",
    grand ? `${g("Успел", "Успела")} увидеть ${grand} ${plural(grand, "внука", "внуков", "внуков")}.` : "",
    `Меня не стало в ${yearsW(L.age)}: ${entry.cause.toLowerCase().replace(/\.$/, "")}.`,
    pat ? `Узор жизни — «${pat.name}».` : "",
    "Где и кем родились бы вы? #ПутьКБессмертию",
  ].filter(Boolean).join("\n");
  return {
    bio, expect, diff: L.age - expect, longer: longer == null ? null : Math.round(longer * 1000) / 10,
    happiest: hy, farewell: bye.join(", "), years, pattern: pat, stars, notes: L.notes || [], talent: tal ? `${tal.item}` : null, share,
  };
}
