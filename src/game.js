// Игровая логика: чистые функции над state и data. Не зависит от DOM.
// Формулы:
//   qiRequired(realm, layer) = baseQi * growth^(layer-1)
//   qiPerSec = (base + perRealm*ярус ступени) * technique.qiMultiplier * life.qiMult * pathSpeedMul (цена нескольких путей)
//   breakthroughChance = clamp(base - penalty*(layer-1) + pill + дао-сердце + тело + внутренняя работа + слои других путей, min, 0.99)

import { die } from "./life.js";
import * as CL from "./clan.js";
import * as S from "./sect.js";

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

// ───── Несколько путей ─────
// Активный путь — в s.pathId / realmIndex / layer / qi / gateAge (как раньше: вся остальная логика смотрит туда).
// Остальные начатые пути лежат в s.paths[id] = { realmIndex, layer, qi, gateAge, slots }.
// Ци каждого пути копится, только пока путь активен. Срок жизни — по сильнейшему пути (life.js → lifespan).
// Слои других путей помогают прорыву активного: crossPathBonus = min(cap, perLayer × Σ уровней других путей).
const crossCfg = data => data.realms.crossPath || {};
export function pathDef(data, id) { return (data.realms.paths || []).find(p => p.id === id) || null; }
// Путь открыт: тело — всем, ци — с корнями, дух — с ясной душой.
export function pathOpen(data, s, p) {
  const L = s.life, W = data.world;
  if (!p || !L?.awakened) return false;
  if (p.requires === "root") return (W.roots.find(r => r.id === L.rootId)?.qiMult || 0) > 0;
  if (p.requires === "soul") return (W.souls?.find(x => x.id === L.soulId)?.mult || 0) > 0;
  return true;
}
export function openPaths(data, s) { return (data.realms.paths || []).filter(p => pathOpen(data, s, p)).map(p => p.id); }
// Все начатые пути: { id: {realmIndex, layer, qi, gateAge, slots} }, активный — из полей состояния.
export function pathRecs(s) {
  const cur = s.pathId || "qi", out = {};
  for (const [id, r] of Object.entries(s.paths || {})) if (id !== cur && r) out[id] = r;
  out[cur] = { realmIndex: s.realmIndex || 0, layer: s.layer || 1, qi: s.qi || 0, gateAge: s.gateAge ?? null, slots: s.techniqueSlots };
  return out;
}
export function levelOf(data, id, r) {
  const rs = pathDef(data, id)?.realms || data.realms.realms; let L = (r.layer || 1) - 1;
  for (let i = 0; i < (r.realmIndex || 0); i++) L += rs[i].layers;
  return L;
}
export function maxRealm(s) { return Math.max(0, ...Object.values(pathRecs(s)).map(r => r.realmIndex || 0)); }
// Ярус (tier) — «большая ступень» для секты, техник, карточек, риска и скорости ци: 0 — первая, 1 — Основание и ровня, 2 — Золотое ядро…
// Промежуточные ступени (Открытие Жэнь и Ду, Отказ от зерна и т. п.) — полуярусы 0.5 / 1.5. Номер ступени (realmIndex) — только для порядка.
export function realmTier(data, id, i) { const r = (pathDef(data, id)?.realms || data.realms.realms)?.[i || 0]; return r?.tier ?? (i || 0); }
export function tierOf(data, s) { return realmTier(data, s.pathId || "qi", s.realmIndex); }
export function maxTier(data, s) { return Math.max(0, ...Object.entries(pathRecs(s)).map(([id, r]) => realmTier(data, id, r.realmIndex))); }
// Первая ступень пути не ниже яруса tier — для надписей «нужна ступень …».
export function realmForTier(data, s, tier) { const rs = realmsOf(data, s); return rs.find((r, i) => (r.tier ?? i) >= tier) || rs[rs.length - 1]; }
export function maxLevel(data, s) { return Math.max(0, ...Object.entries(pathRecs(s)).map(([id, r]) => levelOf(data, id, r))); }
export function crossPathBonus(data, s) {
  const c = crossCfg(data), cur = s.pathId || "qi";
  const sum = Object.entries(pathRecs(s)).filter(([id]) => id !== cur).reduce((t, [id, r]) => t + levelOf(data, id, r), 0);
  return Math.min(c.cap ?? 0.25, (c.perLayer ?? 0.015) * sum);
}
// Цена нескольких путей — силы делятся:
//   splitMul = (1 − splitPenalty)^(число ДРУГИХ путей, где пройден хотя бы один прорыв) — постоянно;
//   после смены пути switchSlowYears лет всё идёт ×switchSlowMul — меридианы перестраиваются.
// Множитель бьёт и по медитации, и по ци за победы (combat.js).
export function developedOthers(data, s) {
  const cur = s.pathId || "qi";
  return Object.entries(pathRecs(s)).filter(([id, r]) => id !== cur && levelOf(data, id, r) > 0).length;
}
export function switchSlowLeft(s) { return s.life && s.pathSlowUntil != null ? Math.max(0, s.pathSlowUntil - s.life.age) : 0; }
export function pathSpeedMul(data, s) {
  const c = crossCfg(data);
  return Math.pow(1 - (c.splitPenalty ?? 0), developedOthers(data, s)) * (switchSlowLeft(s) > 0 ? (c.switchSlowMul ?? 1) : 1);
}
// Постоянные эффекты путей — складываются по всем начатым путям (L = пройденные слои пути, crossPath.passives):
//   тело — здоровье и защита; дух — дао-сердце (и потолок его вклада в прорыв); ци — скорость ци, удар, камни за победы.
export function pathPassives(data, s) {
  const P = crossCfg(data).passives || {}, out = { hp: 1, def: 1, atk: 1, qi: 1, stones: 1, dao: 0, breakCap: 0 };
  for (const [id, r] of Object.entries(pathRecs(s))) {
    const p = P[id], L = p ? levelOf(data, id, r) : 0; if (!L) continue;
    out.hp *= 1 + (p.hp || 0) * L; out.def *= 1 + (p.def || 0) * L; out.atk *= 1 + (p.atk || 0) * L;
    out.qi *= 1 + (p.qi || 0) * L; out.stones *= 1 + (p.stones || 0) * L;
    out.dao += (p.dao || 0) * L; out.breakCap += (p.breakCap || 0) * L;
  }
  return out;
}
// Коротко для интерфейса: что даёт путь id на своём уровне.
export function passiveText(data, s, id) {
  const p = crossCfg(data).passives?.[id], r = pathRecs(s)[id]; if (!p || !r) return "";
  const L = levelOf(data, id, r), pc = v => `+${Math.round(v * L * 100)}%`, bits = [];
  if (!L) return "эффекты — с первого прорыва";
  if (p.hp) bits.push(`здоровье ${pc(p.hp)}`); if (p.def) bits.push(`защита ${pc(p.def)}`);
  if (p.qi) bits.push(`ци ${pc(p.qi)}`); if (p.atk) bits.push(`удар ${pc(p.atk)}`); if (p.stones) bits.push(`камни ${pc(p.stones)}`);
  if (p.dao) bits.push(`дао-сердце +${+(p.dao * L).toFixed(1)}`);
  return bits.join(", ");
}
export function daoHeartEff(data, s) { return (s.life?.stats?.daoHeart || 0) + pathPassives(data, s).dao; }
// Слоты для пути, на который ещё не вставали: общие техники остаются, чужие по пути снимаются.
function slotsFor(data, s, id) {
  const out = {};
  for (const [k, tid] of Object.entries(s.techniqueSlots || {})) { const t = tid && techById(data, tid); out[k] = t && (!t.path || t.path === id) ? tid : null; }
  if (!out.neigong) out.neigong = "breath_of_mist";
  return out;
}
// Пробный срез состояния «как если бы активен путь id» — для оценок (скорость, порог), без изменений s.
export function pathProbe(data, s, id) {
  if (id === (s.pathId || "qi")) return s;
  const recs = pathRecs(s), r = recs[id] || { realmIndex: 0, layer: 1, qi: 0, gateAge: null, slots: null };
  const paths = { ...recs }; delete paths[id];
  return { ...s, pathId: id, realmIndex: r.realmIndex, layer: r.layer, qi: r.qi, gateAge: r.gateAge ?? null, techniqueSlots: r.slots || slotsFor(data, s, id), paths };
}
export function pathSwitchWait(data, s) {
  return s.life && s.pathSwitchAge != null ? Math.max(0, s.pathSwitchAge - s.life.age) : 0;
}
// Сменить активный путь. force — без проверок (запись о смерти показывает сильнейший путь).
export function switchPath(data, s, id, force = false) {
  const cur = s.pathId || "qi", p = pathDef(data, id);
  if (id === cur) return { ok: true, msg: "" };
  if (!force) {
    if (!pathOpen(data, s, p)) return { ok: false, msg: "Этот путь тебе закрыт." };
    const w = pathSwitchWait(data, s);
    if (w) return { ok: false, msg: `Тело ещё помнит прошлый путь: сменить можно через ${w} г.` };
  }
  const next = pathProbe(data, s, id);
  s.paths = { ...(s.paths || {}), [cur]: { realmIndex: s.realmIndex, layer: s.layer, qi: s.qi, gateAge: s.gateAge ?? null, slots: { ...(s.techniqueSlots || {}) } } };
  delete s.paths[id];
  s.pathId = id; s.realmIndex = next.realmIndex; s.layer = next.layer; s.qi = next.qi; s.gateAge = next.gateAge;
  s.techniqueSlots = { ...next.techniqueSlots }; s.techniqueId = s.techniqueSlots.neigong;
  if (!force && s.life) {
    s.pathSwitchAge = s.life.age + (crossCfg(data).switchYears ?? 1);
    s.pathSlowUntil = s.life.age + (crossCfg(data).switchSlowYears ?? 0);
  }
  const r = realmsOf(data, s)[s.realmIndex];
  return { ok: true, msg: `Теперь ты развиваешь ${p.name}: «${r.name}», слой ${s.layer}.` };
}
// Сколько лет медитации до следующего слоя (без приключений). Infinity — если ци не идёт.
export function yearsToNextLayer(data, s, yearSeconds) {
  const rate = qiPerSecond(data, s) * yearSeconds;
  return rate > 0 ? Math.max(0, qiRequired(data, s) - s.qi) / rate : Infinity;
}

export function qiRequired(data, s) {
  const r = realmsOf(data, s)[s.realmIndex];
  return Math.floor(r.baseQi * Math.pow(r.growth, s.layer - 1));
}

// Телосложение даёт свои множители: breakAdd (прорыв), pillMul (цена пилюли), techCostMul (цена техник).
export function physiqueOf(data, s) {
  return s.life ? data.world.physiques?.find(x => x.id === s.life.physiqueId) : null;
}
// Дар с детства (чжуачжоу в год): мелкие множители — techCostMul, pillMul, payMul, atkMult, hazard.
export function talentOf(data, s) {
  return s.life?.talentId ? data.world.talents?.find(x => x.id === s.life.talentId) || null : null;
}
// ───── Доступ к техникам ─────
// Рынок продаёт только мирские/нижняя колесница и втридорога (×1.5). средняя колесница и выше — тайна: секта (по рангу), родовая библиотека, удача, друзья.
// Ранги секты (sects.json → ranks): слуга, внешний, внутренний, личный, старший ученик, старейшина, глава — sect.js.
// Доступ к колесницам: внешний ученик — средняя колесница, внутренний — верхняя колесница, личный и выше — цзюэсюэ; слуге тайны не открывают.
const MARKET_RANK = 1, MARKET_MUL = 1.5, RANK_NAMES = ["слуга", "внешний ученик", "внутренний ученик", "личный ученик", "старший ученик", "старейшина", "глава"];
export function sectById(data, id) { return data.sects?.sects?.find(x => x.id === id) || null; }
export function sectRankIdx(s) { const sc = s.life?.sect; return sc ? (sc.rank ?? 1) : -1; }
export function sectRank(s, data) { const i = sectRankIdx(s); return i >= 3 ? 2 : i >= 2 ? 1 : i >= 1 ? 0 : -1; }
export function sectRankName(s, data) { const i = Math.max(0, sectRankIdx(s)); return data?.sects?.ranks?.[i]?.name || RANK_NAMES[i]; }
export function gradeRank(data, t) { return data.techniques.grades.find(g => g.id === t.grade)?.rank ?? 0; }
export function techAccess(data, s, t) {
  if (!t) return { ok: false, src: "none", why: "нет такой техники" };
  if (s.ownedTechniques?.includes(t.id)) return { ok: true, src: "own" };
  if (!s.life) return { ok: true, src: "market" }; // балансные тулзы без жизни
  if (s.familyTechs?.includes(t.id)) return { ok: true, src: "family" };
  const gr = gradeRank(data, t);
  if (gr <= MARKET_RANK) return { ok: true, src: "market" };
  const my = s.life.sect && sectById(data, s.life.sect.id);
  if (my && t.owner === my.id) {
    const need = gr - 2; // средняя колесница → внешний, верхняя колесница → внутренний, цзюэсюэ → личный
    if (sectRank(s, data) >= need) return { ok: true, src: "sect" };
    return { ok: false, src: "sect", why: `«${my.name}» учит этому с ранга «${data.sects?.ranks?.[need + 1]?.name || RANK_NAMES[need + 1]}»` };
  }
  const other = sectById(data, t.owner);
  if (other) return { ok: false, src: "secret", why: `тайна «${other.name}»` };
  if (t.owner === "luck") return { ok: false, src: "secret", why: "не учат — только находят" };
  return { ok: false, src: "secret", why: "тайна кланов: род, друзья или удача" };
}
export function techCost(data, s, t) {
  const a = techAccess(data, s, t);
  if (a.src === "own" || a.src === "family") return 0;
  const mul = a.src === "market" && s.life ? MARKET_MUL : 1;
  return Math.round((t.cost || 0) * mul * (physiqueOf(data, s)?.techCostMul ?? 1) * (talentOf(data, s)?.techCostMul ?? 1));
}
// Находка/подарок: случайная тайная техника своего пути. средняя колесница всегда, верхняя колесница с 2-й ступени, цзюэсюэ с 3-й (редко).
export function luckyScroll(data, s, rng = Math.random, ownerFilter = null) {
  const r = tierOf(data, s), w = { 2: 1, 3: r >= 1 ? 0.35 : 0, 4: r >= 2 ? 0.08 : 0 };
  const pool = data.techniques.techniques.filter(t => !s.ownedTechniques.includes(t.id) && techUsable(data, s, t)
    && (w[gradeRank(data, t)] || 0) > 0 && (!ownerFilter || t.owner === ownerFilter));
  if (!pool.length) return null;
  let x = rng() * pool.reduce((a, t) => a + w[gradeRank(data, t)], 0), pickT = pool[pool.length - 1];
  for (const t of pool) { x -= w[gradeRank(data, t)]; if (x < 0) { pickT = t; break; } }
  s.ownedTechniques.push(pickT.id);
  if (!s.techniqueSlots?.[pickT.type] && (pickT.minRealm || 0) <= r) equipTechnique(data, s, pickT.id);
  return pickT;
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

// Техника своего пути: t.path пусто — общая; иначе только для этого пути.
export function techUsable(data, s, t) { return !t?.path || t.path === (s.pathId || "qi"); }
// Сила внутренняя работа с учётом пути: общие на пути духа — вполсилы, на пути тела — ноль (закалка идёт через закал тела).
export function neigongMult(data, s, t) {
  if (!t) return 1;
  const p = s.pathId || "qi";
  if (p === "body") return 1;
  if (t.path && t.path !== p) return 1;
  if (p === "spirit" && !t.path) return 1 + ((t.qiMultiplier || 1) - 1) * 0.5;
  return t.qiMultiplier || 1;
}
export function bodyForgeMult(data, s, t) {
  if (!t) return 1;
  return 1.15 * (1 + 1.2 * ((t.hpMult || 1) - 1)) * (techUsable(data, s, t) ? (t.forgeMult || 1) : 1);
}
// Работа культиватора (jobs.json → qiMul): двор секты, скит, вольная тропа — ци идёт быстрее.
export function jobQiMul(data, s) { const L = s.life, j = L?.awakened && data.jobs?.jobs?.find(x => x.id === L.jobId); return (j && j.qiMul) || 1; }
export function qiPerSecond(data, s) {
  const m = data.realms.meditation;
  const sl = slottedTechs(data, s);
  const f = focusOf(data, s);
  // Путь тела копит закалку техникой закал тела: 1.15 × (1 + 1.2 × (hpMult − 1)) × forgeMult своей техники.
  const tech = (s.pathId === "body") ? (sl.body ? bodyForgeMult(data, s, sl.body) : 1.15) : neigongMult(data, s, sl.neigong);
  return (m.qiPerSecondBase + m.qiPerSecondPerRealm * tierOf(data, s)) * tech * pathMult(data, s) * (f?.qiMul ?? 1) * jobQiMul(data, s) * pathSpeedMul(data, s) * pathPassives(data, s).qi;
}

// Порог легенды: переход из 9-го слоя в ступень с legend. Шанс ×legendChanceMul,
// при неудаче — legendDeathChance погибнуть («Печать заметила имя»).
export function legendGate(data, s) {
  const rs = realmsOf(data, s), r = rs[s.realmIndex], next = rs[s.realmIndex + 1];
  return !!(r && next?.legend && s.layer >= r.layers);
}
export function breakthroughChance(data, s, usePill = false) {
  const r = realmsOf(data, s)[s.realmIndex], b = data.realms.breakthrough, dm = pathOf(data, s).daoHeartMul || 1;
  // Дао-сердце: +1% за единицу (×daoHeartMul на пути духа); потолок 0.1 + 0.05×daoHeartMul + breakCap путей — 15% обычно, 16,5% на пути духа.
  const c = r.baseBreakthroughChance - b.failChancePenaltyPerLayer * (s.layer - 1) + (usePill ? b.pillBonus : 0)
    + (s.life ? Math.min(0.1 + 0.05 * dm + pathPassives(data, s).breakCap, 0.01 * dm * Math.max(0, daoHeartEff(data, s))) : 0)
    + (physiqueOf(data, s)?.breakAdd || 0)
    + (() => { const n = slottedTechs(data, s).neigong; return n?.path && techUsable(data, s, n) ? (n.breakAdd || 0) : 0; })()
    + crossPathBonus(data, s); // слои других путей
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
// Потолок пути: последний слой последней ступени — расти некуда (иначе «прорыв» бесконечно сыпал бы камни).
export function atPeak(data, s) { const rs = realmsOf(data, s); return s.realmIndex >= rs.length - 1 && s.layer >= rs[rs.length - 1].layers; }
export function canBreakthrough(data, s) { return !atPeak(data, s) && s.qi >= qiRequired(data, s) && gateWaitYears(data, s) === 0; }

export function breakthrough(data, s, usePill = false, rng = Math.random) {
  if (atPeak(data, s)) return { ok: false, msg: "Выше этого пути ступеней нет." };
  if (!canBreakthrough(data, s)) return { ok: false, msg: "Ци недостаточно." };
  if (usePill && s.pills < 1) return { ok: false, msg: "Нет пилюль." };
  const chance = breakthroughChance(data, s, usePill);
  if (usePill) s.pills -= 1;
  const realms = realmsOf(data, s), r = realms[s.realmIndex];
  if (rng() < chance) {
    if (s.layer < r.layers) s.layer += 1;
    else if (s.realmIndex < realms.length - 1) { s.realmIndex += 1; s.layer = 1; }
    s.qi = 0;
    s.spiritStones += Math.round(10 * tierOf(data, s)) + s.layer;
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
// pillPrice — сколько платишь ты: часть цены (по ярусу рода) покрывает казна рода, пока в ней есть камни (clan.js → pillShare).
export function pillPrice(data, s) { const p = pillBase(data, s); return p - CL.pillShare(data, s, p); }
export function pillBase(data, s) {
  let L = s.layer - 1;
  for (let i = 0; i < s.realmIndex; i++) L += realmsOf(data, s)[i].layers;
  const y = slottedTechs(data, s).yishu;
  return Math.max(1, Math.round(20 * Math.pow(1.15, L) * (y?.pillMul ?? 1) * (physiqueOf(data, s)?.pillMul ?? 1) * (talentOf(data, s)?.pillMul ?? 1)));
}

export function buyPill(data, s) {
  const base = pillBase(data, s), share = CL.pillShare(data, s, base), price = base - share;
  if (s.spiritStones < price) return false;
  s.spiritStones -= price; CL.payPillShare(data, s, share); s.pills += 1; return true;
}

export function equipTechnique(data, s, id) {
  const t = techById(data, id);
  if (!t || !s.ownedTechniques.includes(id)) return { ok: false, msg: "Сначала изучи." };
  if (!techUsable(data, s, t)) return { ok: false, msg: "Это техника другого пути." };
  if ((t.minRealm || 0) > tierOf(data, s)) return { ok: false, msg: "Ступень слишком низка." };
  if (!s.techniqueSlots) s.techniqueSlots = { neigong: s.techniqueId, body: null, martial: null, qinggong: null, yishu: null, anqi: null };
  s.techniqueSlots[t.type] = id;
  if (t.type === "neigong") s.techniqueId = id;
  return { ok: true, msg: `В работе: «${t.name}».` };
}

export function learnTechnique(data, s, id) {
  const t = techById(data, id);
  if (!t) return { ok: false, msg: "Нет такой техники." };
  if (!techUsable(data, s, t)) return { ok: false, msg: "Это техника другого пути." };
  if (s.ownedTechniques.includes(id)) return equipTechnique(data, s, id);
  const acc = techAccess(data, s, t);
  if (!acc.ok) return { ok: false, msg: `Не учат: ${acc.why}.` };
  const cost = techCost(data, s, t);
  // Техника своей секты: можно заплатить вкладом (sect.js → contribCost), иначе камнями.
  const cc = acc.src === "sect" ? S.contribCost(data, s, t) : null, sc = s.life?.sect;
  const byContrib = cc != null && sc && (sc.contrib || 0) >= cc;
  if (!byContrib && s.spiritStones < cost) return { ok: false, msg: "Не хватает камней." };
  if ((t.minRealm || 0) > tierOf(data, s)) return { ok: false, msg: "Ступень слишком низка." };
  if (byContrib) sc.contrib -= cc; else s.spiritStones -= cost;
  s.ownedTechniques.push(id);
  const r = equipTechnique(data, s, id);
  return byContrib ? { ...r, msg: `${r.msg} Оплачено вкладом: ${cc}.` } : r;
}
