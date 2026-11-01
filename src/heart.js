// Последствия кармы и дао-сердца (data/heart.json).
// Карма — как к тебе относятся люди и небо: беды, спасение «добро вернулось», возмездие, лад в доме, прорыв.
// Дао-сердце — как ты держишь себя сам: сердечные демоны, скорость ци, срывы в затворе, старость, порог легенды.
import { logLine, gtext } from "./life.js";
import * as G from "./game.js";
import * as JH from "./jianghu.js";

const C = data => data.heart || null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
const tier = (list, v) => { let t = list[0]; for (const x of list) if (v >= x.min) t = x; return t; };
export const karma = s => s.life?.stats?.karma || 0;
export const dao = (data, s) => s.life ? G.daoHeartEff(data, s) : 0;
export function kTier(data, s) { const c = C(data); return c ? tier(c.karma, karma(s)) : {}; }
export function dTier(data, s) { const c = C(data); return c ? tier(c.dao, dao(data, s)) : {}; }

export const hazardMul = (data, s) => C(data) && s.life ? (kTier(data, s).haz ?? 1) * (dTier(data, s).haz ?? 1) : 1;
export const oldMul = (data, s) => C(data) && s.life ? dTier(data, s).old ?? 1 : 1;
export const qiMul = (data, s) => C(data) && s.life?.alive ? dTier(data, s).qi ?? 1 : 1;
export const slipMul = (data, s) => C(data) && s.life ? dTier(data, s).slip ?? 1 : 1;
export const breakAdd = (data, s) => C(data) && s.life ? kTier(data, s).breakAdd ?? 0 : 0;
export const legendMul = (data, s) => C(data) && s.life ? (kTier(data, s).legend ?? 1) * (dTier(data, s).legend ?? 1) : 1;

// Смертельная беда: доброе имя может спасти — кто-то вспомнил, что ты для него сделал(а).
const SAVES = [
  "Лодочник, которого ты когда-то вытащил(а) из реки, вытащил тебя.",
  "Соседи ночью вынесли тебя из горящего дома. Ты помогал(а) им, когда было голодно.",
  "Разбойник опустил нож: «Ты кормил(а) мою мать». И ушёл в темноту.",
  "Лекарь не взял денег и не отходил три ночи. Сказал, что долг у него перед тобой давний.",
  "Монахи выходили тебя в храме. Твоё имя у них записано в книге добрых дел.",
];
export function saved(data, s, rng = Math.random) {
  const c = C(data), L = s.life, p = kTier(data, s).save || 0;
  if (!c || !p || rng() >= p) return false;
  L.stats.karma = clamp(L.stats.karma - (c.saveCost ?? 3), -20, 20);
  logLine(s, `Добро вернулось: ${gtext(pick(SAVES, rng), L.gender)} Смерть прошла мимо.`, "luck");
  return true;
}
// Возмездие: дурные дела не забываются.
function retribution(data, s, rng) {
  const L = s.life, kind = pick(["stones", "grudge", "home", "beaten"], rng);
  if (kind === "stones" && s.spiritStones > 10) { const lose = Math.round(s.spiritStones * 0.2); s.spiritStones -= lose; logLine(s, `Склад подожгли ночью. Кто — не нашли, но в округе никто не удивился. Потеряно ${lose} камней.`, "death"); return; }
  if (kind === "grudge" && data.jianghu) { JH.addTie(data, s, "grudge", pick(["сын того, кого ты разорил(а)", "брат обманутого тобой", "вдова человека, которого ты не пощадил(а)"], rng), rng); logLine(s, "Старое зло вернулось лицом: у тебя появился кровник.", "death"); return; }
  if (kind === "home" && L.fam) { L.fam.harmony = clamp((L.fam.harmony ?? 55) - 8, 0, 100); logLine(s, "Дома узнали, что о тебе говорят на рынке. За столом стало тихо.", "family"); return; }
  L.ageShift -= 1; logLine(s, gtext("Тебя подкараулили в переулке и избили — молча, за старое. Срок −1 год.", L.gender), "death");
}
// Сердечный демон: сомнение, страх, злость, которые ты носишь в себе.
function demon(data, s, rng) {
  const L = s.life;
  if (L.awakened) {
    s.qi = Math.floor(s.qi * 0.5);
    const hard = rng() < 0.25; if (hard) L.ageShift -= 1;
    logLine(s, gtext(`Сердечный демон: в медитации ты увидел(а) своё лицо — оно смеялось. Ци ушла в пустоту${hard ? ", жилы обожгло, срок −1 год" : ""}.`, L.gender), "cult");
  } else {
    const lose = Math.round(s.spiritStones * 0.25); s.spiritStones -= lose;
    if (L.fam) L.fam.harmony = clamp((L.fam.harmony ?? 55) - 5, 0, 100);
    logLine(s, gtext(`Тоска взяла своё: месяц ты пил(а) и играл(а) в кости. Ушло ${lose} камней, дома — ссоры.`, L.gender), "family");
  }
}
export function yearHeart(data, s, rng = Math.random) {
  const c = C(data), L = s.life; if (!c || !L?.alive || L.age < 12) return;
  const k = kTier(data, s), d = dTier(data, s);
  if (k.harmony && L.fam) L.fam.harmony = clamp((L.fam.harmony ?? 55) + k.harmony, 0, 100);
  if (k.conn && rng() < Math.abs(k.conn)) L.stats.connections = clamp(L.stats.connections + Math.sign(k.conn), 0, 30);
  if (k.retrib && rng() < k.retrib) retribution(data, s, rng);
  if (L.alive && d.demon && rng() < d.demon * (L.retreat ? 1.5 : 1)) demon(data, s, rng);
}
// ───────── наследие ─────────
export function inherit(data, s, prev, isChild) {
  const c = C(data); if (!c || !s.life || prev?.karma == null) return;
  const k = Math.round(prev.karma * (c.heirKarma ?? 0.3) * (isChild ? 1 : 0.5));
  if (!k) return;
  s.life.stats.karma = clamp(s.life.stats.karma + k, -20, 20);
  logLine(s, k > 0 ? `Добрая память о ${prev.name} открывает тебе двери: карма ${k > 0 ? "+" : ""}${k}.` : `На тебе тень дел ${prev.name}: люди помнят, чьих ты кровей. Карма −${Math.abs(k)}.`, "family");
}
// ───────── карточки ─────────
export function matches(data, s, r = {}) {
  if (!s.life) return true;
  const d = s.life.stats?.daoHeart || 0;
  if (r.minDao != null && d < r.minDao) return false;
  if (r.maxDao != null && d > r.maxDao) return false;
  return true;
}
// Авторежим: карма и сердце теперь чего-то стоят.
export const scoreFx = (ef = {}) => (ef.karma || 0) * 0.6 + (ef.daoHeart || 0) * 0.6;
// ───────── интерфейс ─────────
const pct = v => `${v > 1 ? "+" : "−"}${Math.round(Math.abs(v - 1) * 100)}%`;
export function summary(data, s) {
  if (!C(data) || !s.life) return null;
  const k = kTier(data, s), d = dTier(data, s), kf = [], df = [];
  if (k.haz && k.haz !== 1) kf.push(`беды ${pct(k.haz)}`);
  if (k.save) kf.push(`добро может спасти от смерти (${Math.round(k.save * 100)}%)`);
  if (k.retrib) kf.push(`возмездие ${Math.round(k.retrib * 100)}% в год`);
  if (k.harmony) kf.push(`лад в доме ${k.harmony > 0 ? "+" : "−"}${Math.abs(k.harmony)} в год`);
  if (k.conn) kf.push(k.conn > 0 ? "люди тянутся" : "люди отворачиваются");
  if (k.breakAdd) kf.push(`прорыв ${k.breakAdd > 0 ? "+" : "−"}${Math.round(Math.abs(k.breakAdd) * 100)}%`);
  if (d.qi && d.qi !== 1) df.push(`ци ${pct(d.qi)}`);
  if (d.demon) df.push(`сердечный демон ${Math.round(d.demon * 100)}% в год`);
  if (d.slip && d.slip !== 1) df.push(`срывы в затворе ${pct(d.slip)}`);
  if (d.old && d.old !== 1) df.push(`старость ${pct(d.old)}`);
  if (d.haz && d.haz !== 1) df.push(`беды ${pct(d.haz)}`);
  if (d.legend && d.legend !== 1) df.push(`порог легенды ${pct(d.legend)}`);
  return { karma: { word: k.word, fx: kf }, dao: { word: d.word, fx: df } };
}
