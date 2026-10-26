// Игровая логика: чистые функции над state и data. Не зависит от DOM.
// Формулы:
//   qiRequired(realm, layer) = baseQi * growth^(layer-1)
//   qiPerSec = (base + perRealm*realmIndex) * technique.qiMultiplier * life.qiMult
//   breakthroughChance = clamp(base - penalty*(layer-1) + pill + min(0.15, 0.01*daoHeart), min, 0.99)

export function qiRequired(data, s) {
  const r = data.realms.realms[s.realmIndex];
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
  const t = slottedTechs(data, s).neigong;
  const f = focusOf(data, s);
  return (m.qiPerSecondBase + m.qiPerSecondPerRealm * s.realmIndex) * (t?.qiMultiplier || 1) * (s.life ? s.life.qiMult : 1) * (f?.qiMul ?? 1);
}

export function breakthroughChance(data, s, usePill = false) {
  const r = data.realms.realms[s.realmIndex], b = data.realms.breakthrough;
  const c = r.baseBreakthroughChance - b.failChancePenaltyPerLayer * (s.layer - 1) + (usePill ? b.pillBonus : 0)
    + (s.life ? Math.min(0.15, 0.01 * Math.max(0, s.life.stats.daoHeart)) : 0)
    + (physiqueOf(data, s)?.breakAdd || 0);
  return Math.min(0.99, Math.max(b.minChance, c));
}

export function tick(data, s, now = Date.now()) {
  const dt = Math.max(0, (now - s.lastTick) / 1000);
  s.lastTick = now;
  s.qi = Math.min(s.qi + qiPerSecond(data, s) * dt, qiRequired(data, s));
  return s;
}

export function canBreakthrough(data, s) { return s.qi >= qiRequired(data, s); }

export function breakthrough(data, s, usePill = false, rng = Math.random) {
  if (!canBreakthrough(data, s)) return { ok: false, msg: "Ци недостаточно." };
  if (usePill && s.pills < 1) return { ok: false, msg: "Нет пилюль." };
  const chance = breakthroughChance(data, s, usePill);
  if (usePill) s.pills -= 1;
  const realms = data.realms.realms, r = realms[s.realmIndex];
  if (rng() < chance) {
    if (s.layer < r.layers) s.layer += 1;
    else if (s.realmIndex < realms.length - 1) { s.realmIndex += 1; s.layer = 1; }
    s.qi = 0;
    s.spiritStones += 10 * s.realmIndex + s.layer;
    return { ok: true, msg: `Прорыв удался! ${realms[s.realmIndex].name}, слой ${s.layer}.` };
  }
  s.qi = Math.floor(s.qi * (1 - data.realms.breakthrough.failQiLoss));
  return { ok: false, msg: "Прорыв не удался: ци рассеялась." };
}

// Цена пилюли = 20 * 1.15^L, чтобы камни не обесценивались с ростом наград.
export function pillPrice(data, s) {
  let L = s.layer - 1;
  for (let i = 0; i < s.realmIndex; i++) L += data.realms.realms[i].layers;
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
