// Игровая логика: чистые функции над state и data. Не зависит от DOM.
// Формулы:
//   qiRequired(realm, layer) = baseQi * growth^(layer-1)
//   qiPerSec = (base + perRealm*realmIndex) * technique.qiMultiplier * life.qiMult
//   breakthroughChance = clamp(base - penalty*(layer-1) + pill + min(0.15, 0.01*daoHeart), min, 0.99)

import { die } from "./life.js";

// Путь развития: ци / тело / дух. У каждого свои ступени (data.realms.paths[].realms).
export function pathOf(data, s) {
  const ps = data.realms.paths;
  if (!ps) return { id: "qi", realms: data.realms.realms, combat: {}, hazardMul: 1 };
  return ps.find(p => p.id === (s.pathId || "qi")) || ps[0];
}
export function realmsOf(data, s) { return pathOf(data, s).realms; }

// Множитель скорости пути (без техник и фокуса):
//   ци   = корень × эпоха × край × тело.qiMult        (life.qiMult)
//   тело = тело.hpMult² × √эпоха                        (корни не нужны)
//   дух  = душа.mult × эпоха × √край × √тело.qiMult
export function pathMult(data, s, pathId = s.pathId || "qi") {
  const L = s.life; if (!L) return 1;
  const W = data.world, phy = W?.physiques?.find(x => x.id === L.physiqueId) || {};
  const era = W?.eras?.find(x => x.id === L.eraId) || { qiMult: 1 }, region = W?.regions?.find(x => x.id === L.regionId) || { qiMult: 1 };
  if (pathId === "body") return Math.pow(phy.hpMult || 1, 2) * Math.sqrt(era.qiMult);
  if (pathId === "spirit") {
    const soul = W?.souls?.find(x => x.id === L.soulId);
    return (soul?.mult || 0) * era.qiMult * Math.sqrt(region.qiMult) * Math.sqrt(phy.qiMult || 1);
  }
  return L.qiMult ?? 1;
}

export function qiRequired(data, s) {
  const r = realmsOf(data, s)[s.realmIndex];
  return Math.floor(r.baseQi * Math.pow(r.growth, s.layer - 1));
}

// Телосложение даёт свои множители: breakAdd (прорыв), pillMul (цена пилюли), techCostMul (цена техник).
export function physiqueOf(data, s) {
  return s.life ? data.world.physiques?.find(x => x.id === s.life.physiqueId) : null;
}
export function techCost(data, s, t) {
  return Math.round((t.cost || 0) * (physiqueOf(data, s)?.techCostMul ?? 1));
}

export function techById(data, id) {
  return data.techniques.techniques.find(x => x.id === id);
}
export function slottedTechs(data, s) {
  const slots = s.techniqueSlots || { neigong: s.techniqueId };
  return Object.fromEntries(Object.entries(slots).map(([k, id]) => [k, id ? techById(data, id) : null]));
}

export function focusOf(data, s) {
  return data.jobs?.focuses?.find(x => x.id === s.life?.focusId) || data.jobs?.focuses?.[0];
}

export function qiPerSecond(data, s) {
  const m = data.realms.meditation;
  const sl = slottedTechs(data, s);
  const f = focusOf(data, s);
  // Путь тела копит закалку техникой 外功 (а не 内功): 1.15 × (1 + 1.2 × (hpMult − 1)).
  const tech = (s.pathId === "body") ? 1.15 * (1 + 1.2 * ((sl.body?.hpMult || 1) - 1)) : (sl.neigong?.qiMultiplier || 1);
  return (m.qiPerSecondBase + m.qiPerSecondPerRealm * s.realmIndex) * tech * pathMult(data, s) * (f?.qiMul ?? 1);
}

// Порог легенды: переход из 9-го слоя в ступень с legend. Шанс ×legendChanceMul,
// при неудаче — legendDeathChance погибнуть («Печать заметила имя»).
export function legendGate(data, s) {
  const rs = realmsOf(data, s), r = rs[s.realmIndex], next = rs[s.realmIndex + 1];
  return !!(r && next?.legend && s.layer >= r.layers);
}
export function breakthroughChance(data, s, usePill = false) {
  const r = realmsOf(data, s)[s.realmIndex], b = data.realms.breakthrough, dm = pathOf(data, s).daoHeartMul || 1;
  // Путь духа: дао-сердце помогает вдвое (до +25% вместо +15%).
  const c = r.baseBreakthroughChance - b.failChancePenaltyPerLayer * (s.layer - 1) + (usePill ? b.pillBonus : 0)
    + (s.life ? Math.min(0.1 + 0.05 * dm, 0.01 * dm * Math.max(0, s.life.stats.daoHeart)) : 0)
    + (physiqueOf(data, s)?.breakAdd || 0);
  const base = Math.min(0.99, Math.max(b.minChance, c));
  return legendGate(data, s) ? base * (b.legendChanceMul ?? 1) : base;
}

export function tick(data, s, now = Date.now()) {
  const dt = Math.max(0, (now - s.lastTick) / 1000);
  s.lastTick = now;
  s.qi = Math.min(s.qi + qiPerSecond(data, s) * dt, qiRequired(data, s));
  return s;
}

// После неудачи на пороге легенды жилы заживают legendCooldownYears лет.
export function gateWaitYears(data, s) {
  if (!legendGate(data, s) || !s.life || s.gateAge == null) return 0;
  return Math.max(0, s.gateAge - s.life.age);
}
export function canBreakthrough(data, s) { return s.qi >= qiRequired(data, s) && gateWaitYears(data, s) === 0; }

export function breakthrough(data, s, usePill = false, rng = Math.random) {
  if (!canBreakthrough(data, s)) return { ok: false, msg: "Ци недостаточно." };
  if (usePill && s.pills < 1) return { ok: false, msg: "Нет пилюль." };
  const chance = breakthroughChance(data, s, usePill);
  if (usePill) s.pills -= 1;
  const realms = realmsOf(data, s), r = realms[s.realmIndex];
  if (rng() < chance) {
    if (s.layer < r.layers) s.layer += 1;
    else if (s.realmIndex < realms.length - 1) { s.realmIndex += 1; s.layer = 1; }
    s.qi = 0;
    s.spiritStones += 10 * s.realmIndex + s.layer;
    return { ok: true, msg: `Прорыв удался! ${realms[s.realmIndex].name}, слой ${s.layer}.` };
  }
  const gate = legendGate(data, s), bt = data.realms.breakthrough;
  if (gate && s.life && rng() < (bt.legendDeathChance || 0)) {
    die(data, s, "Не пережил(а) прорыв: Печать заметила имя", rng);
    return { ok: false, fatal: true, msg: "Небо над головой потемнело. Печать заметила имя — и забрала его." };
  }
  if (gate && s.life) s.gateAge = s.life.age + (bt.legendCooldownYears || 0);
  s.qi = Math.floor(s.qi * (1 - bt.failQiLoss));
  return { ok: false, msg: gate ? `Порог легенды не пустил: имя уцелело, но жилы заживут ${bt.legendCooldownYears || 0} лет.` : "Прорыв не удался: ци рассеялась." };
}

// Цена пилюли = 20 * 1.15^L, чтобы камни не обесценивались с ростом наград.
export function pillPrice(data, s) {
  let L = s.layer - 1;
  for (let i = 0; i < s.realmIndex; i++) L += realmsOf(data, s)[i].layers;
  const y = slottedTechs(data, s).yishu;
  return Math.max(1, Math.round(20 * Math.pow(1.15, L) * (y?.pillMul ?? 1) * (physiqueOf(data, s)?.pillMul ?? 1)));
}

export function buyPill(data, s) {
  const price = pillPrice(data, s);
  if (s.spiritStones < price) return false;
  s.spiritStones -= price; s.pills += 1; return true;
}

export function equipTechnique(data, s, id) {
  const t = techById(data, id);
  if (!t || !s.ownedTechniques.includes(id)) return { ok: false, msg: "Сначала изучи." };
  if (!s.techniqueSlots) s.techniqueSlots = { neigong: s.techniqueId, body: null, martial: null, qinggong: null, yishu: null, anqi: null };
  s.techniqueSlots[t.type] = id;
  if (t.type === "neigong") s.techniqueId = id;
  return { ok: true, msg: `В работе: «${t.name}».` };
}

export function learnTechnique(data, s, id) {
  const t = techById(data, id);
  if (!t) return { ok: false, msg: "Нет такой техники." };
  if (s.ownedTechniques.includes(id)) return equipTechnique(data, s, id);
  const cost = techCost(data, s, t);
  if (s.spiritStones < cost) return { ok: false, msg: "Не хватает камней." };
  if ((t.minRealm || 0) > s.realmIndex) return { ok: false, msg: "Ступень слишком низка." };
  s.spiritStones -= cost;
  s.ownedTechniques.push(id);
  return equipTechnique(data, s, id);
}
