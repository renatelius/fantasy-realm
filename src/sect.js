// Жизнь в секте: ранги, 贡献, наставник 师父, соученики, устав, войны сект, уход и изгнание.
//   L.sect = { id, since, rank, merit, contrib, standing, master, peers, war, lay, lastTrial, head, heirApparent, seatFor }
//   Глава секты (sc.head) — живой человек: правит, стареет, уходит (смерть, затвор, гибель в войне сект). Печать главы
//     освобождается только тогда — и только старейшина, выполнивший условия, выходит к испытанию «Печать главы».
//     Не вышло или не годишься — печать берёт другой (соперник, друг или кто-то из старейшин). Названный преемник — +к шансу.
//   Ранг (sects.json → ranks): слуга → внешний → внутренний → личный → старший ученик → старейшина → глава.
//     Повышение: ярус пути ≥ rank.tier, заслуги merit ≥ rank.merit, карма по уставу — и испытание (карточка sect_trial_N).
//     Доступ к техникам (game.js → sectRank): внешний — 中乘, внутренний — 上乘, личный и выше — 绝学.
//   贡献 за год: (base + perTier × ярус) × устав × война; в фокусе «Служба секте» ×focusMul + focusAdd.
//     Тратится на техники секты (cost / stonePerContrib) и пилюли (цена / pillDiv). Заслуги (merit) — всё заработанное, не тратятся.
//   Положение (standing, 0–100): нарушения устава и предательство снижают; ноль — изгнание.
// Параметры — data/sects.json → config, ranks, ruleDefs.
import * as G from "./game.js";
import * as L from "./life.js";
import * as F from "./family.js";
import * as CL from "./clan.js";

const by = (arr, id) => arr?.find(x => x.id === id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (a, rng) => a[Math.floor(rng() * a.length)];
const cfg = data => data.sects?.config || {};
const RANKS_FB = ["слуга", "внешний ученик", "внутренний ученик", "личный ученик", "старший ученик", "старейшина", "глава"].map((name, i) => ({ name, tier: [0, 0, 1, 2, 2, 2, 3][i], merit: [0, 20, 80, 220, 600, 2000, 4000][i] }));
export const ranks = data => data.sects?.ranks || RANKS_FB;
export const sectDef = (data, s) => s.life?.sect ? G.sectById(data, s.life.sect.id) : null;
export function rfx(data, sd, k, dflt) {
  for (const id of sd?.rules || []) { const v = data.sects?.ruleDefs?.[id]?.fx?.[k]; if (v != null) return v; }
  return dflt;
}
const myFx = (data, s, k, dflt) => rfx(data, sectDef(data, s), k, dflt);
const given = n => String(n || "").split(" ").slice(1).join(" ") || n;

// ───── вступление ─────
function person(data, s, rng, extra = {}) {
  const p = L.generatePerson(data, rng, { regionId: s.life.regionId, noRoot: true });
  return { name: p.name, gender: p.gender, alive: true, ...extra };
}
function pickSect(data, s, rng) {
  const L0 = s.life, banned = new Set(L0.bannedSects || []), path = s.pathId || "qi";
  const pool = (data.sects?.sects || []).filter(x => !banned.has(x.id) && x.id !== "sunmoon" && (!x.paths || x.paths.includes(path)));
  if (!pool.length) return null;
  const w = pool.map(x => (x.regions || []).includes(L0.regionId) ? 3 : 1);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i]; }
  return pool[pool.length - 1];
}
export function joinSect(data, s, id, rank = 1, rng = Math.random, quiet = false) {
  const L0 = s.life;
  if (!L0?.awakened || L0.sect) return false;
  const sd = id === "random" ? pickSect(data, s, rng) : G.sectById(data, id);
  if (!sd) return false;
  if ((L0.bannedSects || []).includes(sd.id)) { if (!quiet) L.logLine(s, `В ${sd.name} тебя помнят: ворота для тебя закрыты навсегда.`, "info"); return false; }
  if (sd.paths && !sd.paths.includes(s.pathId || "qi")) { if (!quiet) L.logLine(s, `Секта ${sd.name} не учит твоему пути: у ворот тебе вежливо поклонились и закрыли створки.`, "info"); return false; }
  const R = ranks(data), rk = clamp(rank ?? 1, 0, R.length - 1);
  const lay = !!(L0.spouse && rfx(data, sd, "noMarriage", false));
  L0.sect = { id: sd.id, since: L0.age, rank: rk, merit: R[rk].merit, contrib: 0, standing: cfg(data).standingStart ?? 50, master: null, peers: [], war: null, lay, lastTrial: L0.age };
  if (rk <= 3) L0.sect.master = newMaster(data, s, rng);
  L0.sect.head = newHead(data, s, rng);
  const np = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < np; i++) L0.sect.peers.push(person(data, s, rng, { kind: i === 0 ? "friend" : "rival", rank: clamp(rk + Math.floor(rng() * 2), 0, 4) }));
  if (!quiet) {
    F.famNote(data, s, null, `Ты вступил(а) в секту ${sd.name}（${sd.han}）: ${R[rk].name}${lay ? " (мирской ученик)" : ""}. Её 中乘 открыты внешним ученикам, 上乘 — внутренним, 绝学 — личным.${L0.sect.master ? ` Наставник — ${L0.sect.master.name}.` : ""}`, "sect", "awaken");
    CL.applyEffects(data, s, { rep: 1 + rk });
  }
  return true;
}
// ───── глава секты и преемство ─────
const SUCC = data => cfg(data).succession || {};
const topRank = data => ranks(data).length - 1;
function newHead(data, s, rng, fresh = false) {
  const h = person(data, s, rng); h.since = s.life.age - (fresh ? 0 : Math.floor(rng() * (SUCC(data).startTenure ?? 60)));
  return h;
}
export function ensureHead(data, s, rng = Math.random) { const sc = s.life?.sect; if (sc && !sc.head) sc.head = newHead(data, s, rng); return sc?.head || null; }
// Печать уходит другому: соперник-старейшина, друг-старейшина или кто-то из круга.
function appointOther(data, s, rng, prefix = "") {
  const L0 = s.life, sc = L0.sect, top = topRank(data), sd = sectDef(data, s);
  const cand = (sc.peers || []).filter(p => p.alive && p.rank === top - 1).sort((a, b) => (b.kind === "rival") - (a.kind === "rival"))[0];
  let txt;
  if (cand) {
    const f = cand.gender === "f";
    cand.rank = top; sc.head = { name: cand.name, gender: cand.gender, since: L0.age, peer: cand.kind };
    if (cand.kind === "rival") { sc.standing = clamp((sc.standing ?? 50) - (SUCC(data).rivalHeadStanding ?? 8), 0, 100); txt = `Печать главы взял(а) ${f ? "твоя соперница" : "твой соперник"} ${cand.name}. Теперь каждый твой шаг видно сверху.`; }
    else { sc.standing = clamp((sc.standing ?? 50) + 5, 0, 100); txt = `Печать главы принял(а) ${f ? "твоя подруга" : "твой друг"} ${cand.name}: в совете у тебя теперь есть рука.`; }
    txt = L.gtext(txt, cand.gender);
  } else { sc.head = newHead(data, s, rng, true); txt = L.gtext(`Новым главой стал(а) ${sc.head.name} из старейшин.`, sc.head.gender); }
  sc.seatFor = null; sc.heirApparent = false; sc.vacantAt = null;
  L.logLine(s, `${prefix}${prefix ? " " : ""}${txt}`, "sect");
}
// Глава уходит: если ты старейшина и годишься — печать ждёт тебя (испытание sect_trial_N), иначе её берёт другой.
function succession(data, s, rng) {
  const L0 = s.life, sc = L0.sect, sd = sectDef(data, s), old = sc.head, top = topRank(data);
  const how = sc.war ? "пал(а) в войне сект" : rng() < 0.3 ? "ушёл(ла) в вечный затвор" : "умер(ла)";
  const pre = L.gtext(`Глава ${old.name} ${how}.`, old.gender);
  // Ушёл глава из твоих соучеников — его больше нет и среди них.
  if (old.peer) for (const p of sc.peers || []) if (p.alive && p.name === old.name && p.rank === top) { p.alive = false; p.diedAt = L0.age; }
  if (sc.rank === top - 1 && !baseBlock(data, s)) {
    sc.head = { ...old, gone: true }; sc.seatFor = top; sc.vacantAt = L0.age; sc.lastTrial = -99;
    F.famNote(data, s, null, `${pre} Печать главы лежит на алтаре — совет старейшин назвал и твоё имя.${sc.heirApparent ? " Ты — названный преемник." : ""}`, "rank", "sect");
  } else appointOther(data, s, rng, pre);
}
function headYear(data, s, rng) {
  const L0 = s.life, sc = L0.sect, C = SUCC(data), top = topRank(data);
  ensureHead(data, s, rng);
  const hd = sc.head;
  if (hd.self) return;
  if (hd.gone) { if (sc.seatFor !== top || L0.age - (sc.vacantAt ?? L0.age) > (C.vacantYears ?? 3)) appointOther(data, s, rng, "Печать главы не могла ждать дольше."); return; }
  // Названный преемник: старейшина в чести.
  if (!sc.heirApparent && sc.rank === top - 1 && (sc.standing ?? 50) >= (C.heirStanding ?? 80) && rng() < (C.heirChance ?? 0.04)) {
    sc.heirApparent = true;
    F.famNote(data, s, null, L.gtext(`Глава ${hd.name} при всём совете назвал(а) тебя преемником. Старейшины кланялись — кто искренне, кто нет.`, hd.gender), "rank", "sect");
  }
  const tenure = L0.age - (hd.since ?? L0.age);
  const p = ((C.headDeath ?? 0.015) + (tenure > (C.headOldYears ?? 80) ? C.headOld ?? 0.03 : 0)) * (sc.war ? C.warMul ?? 2 : 1);
  if (rng() < p) succession(data, s, rng);
}
const highRival = sc => (sc?.peers || []).find(p => p.alive && p.kind === "rival" && p.rank >= 5);
function newMaster(data, s, rng) {
  const m = person(data, s, rng, { rel: 50, age0: s.life.age });
  m.title = m.gender === "f" ? "наставница" : "наставник";
  return m;
}
// Наследник из секты: ранг по ступени, заслуги — по порогу ранга.
export function heirSect(data, s, id, rng) {
  const t = G.maxTier(data, s), R = ranks(data);
  let rk = 1; for (let i = 1; i <= 3; i++) if (t >= R[i].tier) rk = i;
  joinSect(data, s, id, rk, rng, true);
}
// Сейв до v10: { id, since } → ранг по ярусу (как раньше) и заслуги ранга.
export function ensureSect(data, s, rng = Math.random) {
  const sc = s.life?.sect; if (!sc || sc.rank != null) return;
  const t = G.maxTier(data, s), R = ranks(data);
  let rk = 1; for (let i = 1; i <= 3; i++) if (t >= R[i].tier) rk = i;
  const lay = !!(s.life.spouse && rfx(data, G.sectById(data, sc.id), "noMarriage", false));
  Object.assign(sc, { rank: rk, merit: R[rk].merit, contrib: 0, standing: cfg(data).standingStart ?? 50, master: rk <= 3 ? newMaster(data, s, rng) : null, peers: [person(data, s, rng, { kind: "friend", rank: rk }), person(data, s, rng, { kind: "rival", rank: rk })], war: null, lay, lastTrial: s.life.age });
  delete sc.legacyV9;
}
export function leaveSect(data, s, how = "leave") {
  const L0 = s.life, sc = L0.sect; if (!sc) return;
  const sd = G.sectById(data, sc.id), R = ranks(data);
  (L0.sectHistory ??= []).push({ id: sc.id, rank: sc.rank, how, from: sc.since, to: L0.age });
  (L0.bannedSects ??= []).push(sc.id);
  L0.sect = null;
  if (L0.focusId === "sect") L0.focusId = "practice";
  const txt = how === "expel" ? `Тебя изгнали из секты ${sd?.name}: имя вычеркнули из списка, халат сожгли у ворот.` : `Ты ушёл(ла) из секты ${sd?.name}, ${R[sc.rank]?.name}. Выученное осталось с тобой, двери — закрылись.`;
  F.famNote(data, s, null, txt, "leave", "sect");
  CL.applyEffects(data, s, { rep: how === "expel" ? -4 : -1 });
}

// ───── повышение ─────
export function nextRank(data, s) { const sc = s.life?.sect; if (!sc) return null; return ranks(data)[sc.rank + 1] || null; }
// Места в круге: у рангов с seatChance (старейшина, глава) повышение — только когда освободится место.
//   Каждый год, когда остальные условия выполнены, место освобождается с шансом seatChance (в войну сект — ×warSeatMul).
export function promoteBlock(data, s) {
  const b = baseBlock(data, s); if (b) return b;
  const sc = s.life.sect, nr = nextRank(data, s);
  if (nr.succession && sc.seatFor !== sc.rank + 1) { const hd = sc.head; return hd && !hd.self ? `печать главы у ${hd.name}: преемника выберут, когда ${hd.gender === "f" ? "она уйдёт" : "он уйдёт"}${sc.heirApparent ? " (ты — названный преемник)" : ""}` : "печать главы занята"; }
  if (nr.seatChance && sc.seatFor !== sc.rank + 1) return `в круге «${nr.name}» нет свободного места — ждать, пока кто-то уйдёт`;
  return null;
}
function baseBlock(data, s) {
  const sc = s.life?.sect, nr = nextRank(data, s); if (!sc || !nr) return "выше некуда";
  if (sc.lay && sc.rank >= 2) return "мирскому ученику выше внутреннего двора не подняться";
  if (G.maxTier(data, s) < nr.tier) return `нужна ступень «${G.realmForTier(data, s, nr.tier).name}»`;
  if ((sc.merit || 0) < nr.merit) return `заслуг ${Math.floor(sc.merit)} из ${nr.merit}`;
  if (nr.years && s.life.age - (sc.since ?? s.life.age) < nr.years) return `стаж в секте ${L.yearsW(Math.max(0, s.life.age - (sc.since ?? s.life.age)))} из ${nr.years}`;
  const nk = myFx(data, s, "needKarma", null);
  if (nk != null && s.life.stats.karma < nk) return `устав требует кармы от ${nk > 0 ? "+" : ""}${nk}`;
  return null;
}
export function trialDue(data, s) {
  const sc = s.life?.sect; if (!sc || promoteBlock(data, s)) return null;
  if (s.life.age - (sc.lastTrial ?? -99) < (cfg(data).trial?.gapYears ?? 3)) return null;
  const id = `sect_trial_${sc.rank + 1}`;
  return by(data.events.events, id) ? id : null;
}
export function trialChance(data, s) {
  const T = cfg(data).trial || {}, sc = s.life.sect, nr = nextRank(data, s), C = SUCC(data);
  // Печать главы: названный преемник — легче, соперник в совете — тяжелее.
  const succ = nr?.succession ? (C.contested ?? -0.15) + (sc.heirApparent ? C.heirBonus ?? 0.25 : 0) + (highRival(sc) ? C.rivalPenalty ?? -0.1 : 0) : 0;
  return clamp((T.base ?? 0.6) + (T.perDao ?? 0.03) * G.daoHeartEff(data, s) + (T.perTier ?? 0.15) * (G.maxTier(data, s) - (nr?.tier ?? 0)) + ((sc.standing ?? 50) - 50) / 200 + succ, T.min ?? 0.2, T.max ?? 0.95);
}
function doTrial(data, s, rng) {
  const sc = s.life.sect, R = ranks(data), sd = sectDef(data, s);
  sc.lastTrial = s.life.age;
  if (promoteBlock(data, s)) return;
  const forHead = !!R[sc.rank + 1]?.succession;
  if (forHead) {
    if (rng() < trialChance(data, s)) {
      sc.rank += 1; sc.seatFor = null; sc.vacantAt = null; sc.heirApparent = false;
      sc.head = { self: true, name: s.life.name, gender: s.life.gender, since: s.life.age };
      if (sc.master?.alive) sc.master = { ...sc.master, retired: true };
      F.famNote(data, s, null, `Печать главы в твоих руках: теперь ты ${R[sc.rank].name}（${R[sc.rank].han}）секты ${sd.name}. Старейшины поклонились — и каждый запомнил, как именно.`, "rank", "sect");
      CL.applyEffects(data, s, { rep: SUCC(data).headRep ?? 15 });
    } else appointOther(data, s, rng, "Совет старейшин не отдал тебе печать.");
    return;
  }
  if (rng() < trialChance(data, s)) {
    sc.rank += 1; sc.seatFor = null;
    if (sc.rank >= 4) sc.master = sc.master?.alive ? { ...sc.master, retired: true } : sc.master;
    F.famNote(data, s, null, `Испытание пройдено: теперь ты ${R[sc.rank].name}（${R[sc.rank].han}）секты ${sd.name}.${sc.rank === 2 ? " Открыты 上乘." : sc.rank === 3 ? " Открыты 绝学." : ""}`, "rank", "sect");
    CL.applyEffects(data, s, { rep: 2 * sc.rank });
  } else {
    sc.standing = clamp((sc.standing ?? 50) - 3, 0, 100);
    L.logLine(s, `Испытание не пройдено. Старейшины велели ждать ${L.yearsW(cfg(data).trial?.gapYears ?? 3)}.`, "sect");
  }
}

// ───── год в секте ─────
export function contribYear(data, s) {
  const C = cfg(data).contrib || {}, sc = s.life.sect, sd = sectDef(data, s), tier = G.maxTier(data, s);
  let v = (C.base ?? 6) + (C.perTier ?? 6) * tier;
  if (s.life.focusId === "sect") v = v * (C.focusMul ?? 2.5) + (C.focusAdd ?? 8);
  else if (s.life.focusId === "practice") v *= rfx(data, sd, "practiceContribMul", 1);
  v *= rfx(data, sd, "contribMul", 1) * (sc.war ? cfg(data).warContribMul ?? 1.5 : 1);
  return Math.round(v);
}
function addContrib(s, v) { const sc = s.life.sect; if (!sc) return; sc.contrib = Math.max(0, (sc.contrib || 0) + v); if (v > 0) sc.merit = (sc.merit || 0) + v; }
export function sectYear(data, s, rng = Math.random) {
  const L0 = s.life, sc = L0?.sect; if (!sc || !L0.alive) return;
  const C = cfg(data), sd = sectDef(data, s), R = ranks(data);
  if (!sd) { L0.sect = null; return; }
  addContrib(s, contribYear(data, s));
  sc.advYear = 0;
  if (["sect", "practice"].includes(L0.focusId)) sc.standing = clamp((sc.standing ?? 50) + 1, 0, 100);
  // Устав: тугой кошель у нищих, слухи.
  const frown = rfx(data, sd, "stoneFrown", null);
  if (frown != null && s.spiritStones > frown) { sc.standing = clamp(sc.standing + (C.frownStanding ?? -3), 0, 100); if (L0.age % 5 === 0) L.logLine(s, `Братья по ${sd.name} косятся на твой кошель: у нищего он должен быть дырявым.`, "sect"); }
  const cc = rfx(data, sd, "connChance", 0);
  if (cc && rng() < cc) L0.stats.connections = clamp(L0.stats.connections + 1, 0, 30);
  // Наставник.
  const m = sc.master;
  if (m?.alive && rng() < (C.masterDeath ?? 0.02) + (L0.age - (m.age0 ?? L0.age) > 40 ? C.masterOld ?? 0.04 : 0)) {
    m.alive = false; m.diedAt = L0.age;
    F.famNote(data, s, null, `Умер${m.gender === "f" ? "ла" : ""} ${m.title} ${m.name}. Ты ${m.retired ? "проводил(а) учителя в последний путь" : "остался(ась) без учителя"}.`, "death", "sect");
  } else if (m && !m.alive && !m.retired && sc.rank <= 3 && L0.age - (m.diedAt ?? 0) >= 1) {
    sc.master = newMaster(data, s, rng);
    L.logLine(s, `Секта дала тебе нового учителя: ${sc.master.title} ${sc.master.name}.`, "sect");
  } else if (!m && sc.rank <= 3) sc.master = newMaster(data, s, rng);
  // Соученики.
  for (const p of sc.peers || []) {
    if (!p.alive) continue;
    if (rng() < (C.peerDeath ?? 0.008) * (sc.war ? C.warPeerDeathMul ?? 3 : 1)) { p.alive = false; L.logLine(s, `${p.name}, ${p.kind === "friend" ? "твой друг по секте" : "твой соперник"}, погиб${p.gender === "f" ? "ла" : ""}${sc.war ? " в войне сект" : " на задании"}.`, "sect"); continue; }
    if (p.rank < 5 && rng() < (C.peerPromote ?? 0.08)) {
      p.rank += 1;
      if (p.kind === "rival" && p.rank > sc.rank) L.logLine(s, `Соперник ${p.name} обошёл тебя: теперь он${p.gender === "f" ? "а" : ""} — ${R[p.rank].name}.`, "sect");
    }
  }
  // Война сект.
  if (sc.war && L0.age >= sc.war.until) {
    const foe = G.sectById(data, sc.war.with), r = rng();
    if (r < 0.45) { addContrib(s, 20); sc.standing = clamp(sc.standing + 5, 0, 100); F.famNote(data, s, null, `Война с ${foe?.name} окончена победой: тропы снова ваши.`, "sect", "sect"); }
    else if (r < 0.8) L.logLine(s, `С ${foe?.name} заключено перемирие. Обе секты считают убитых.`, "sect");
    else { sc.standing = clamp(sc.standing - 5, 0, 100); F.famNote(data, s, null, `Война с ${foe?.name} проиграна: секта уступила перевал и два храма.`, "sect", "sect"); }
    sc.war = null;
  } else if (!sc.war && sd.enemies?.length && rng() < (C.warChance ?? 0.02)) {
    const foe = G.sectById(data, pick(sd.enemies, rng)), [a, b] = C.warYears || [3, 6];
    if (foe) { sc.war = { with: foe.id, until: L0.age + a + Math.floor(rng() * (b - a + 1)) }; F.famNote(data, s, null, `Началась война сект: ${sd.name} против ${foe.name}. Тропы перекрыты, ученики ходят по трое.`, "sect", "sect"); }
  }
  // Глава секты правит, стареет и уходит — тогда и решается, кому печать.
  headYear(data, s, rng);
  if (!L0.sect) return;
  // Место в круге старейшин освобождается редко.
  const nr = nextRank(data, s);
  if (nr?.seatChance && sc.seatFor !== sc.rank + 1 && !baseBlock(data, s) && rng() < nr.seatChance * (sc.war ? C.warSeatMul ?? 2 : 1)) {
    sc.seatFor = sc.rank + 1;
    F.famNote(data, s, null, `В круге «${nr.name}» секты ${sd.name} освободилось место${sc.war ? ": война забрала одного из них" : ""}. Твоё имя назвали среди первых.`, "rank", "sect");
  }
  if (sc.standing <= 0) leaveSect(data, s, "expel");
}
export function hazardMul(data, s) {
  const sc = s.life?.sect; if (!sc) return 1;
  return myFx(data, s, "hazardMul", 1) * (sc.war ? cfg(data).warHazard ?? 1.2 : 1);
}
export function onAdventureWin(data, s) {
  const sc = s.life?.sect; if (!sc) return;
  const C = cfg(data).contrib || {}, sd = sectDef(data, s);
  const cap = C.advCapYear ?? 20, v = (C.advWin ?? 2) * rfx(data, sd, "advContribMul", 1);
  const add = Math.max(0, Math.min(v, cap - (sc.advYear || 0)));
  if (add > 0) { sc.advYear = (sc.advYear || 0) + add; addContrib(s, add); }
}
// Траты 贡献: техника секты и пилюля.
export function contribCost(data, s, t) { return Math.ceil(G.techCost(data, s, t) / (cfg(data).contrib?.stonePerContrib ?? 4)); }
export function pillCost(data, s) { return Math.ceil(G.pillPrice(data, s) / (cfg(data).contrib?.pillDiv ?? 4)); }
export function sectPill(data, s) {
  const sc = s.life?.sect; if (!sc) return false;
  const c = pillCost(data, s); if ((sc.contrib || 0) < c) return false;
  sc.contrib -= c; s.pills += 1; return true;
}
// Авторежим: служить секте, когда до ранга не хватает только заслуг.
export function serviceWanted(data, s) {
  const sc = s.life?.sect, nr = nextRank(data, s); if (!sc || !nr || sc.rank >= topRank(data)) return false;
  if (sc.lay && sc.rank >= 2) return false;
  return G.maxTier(data, s) >= nr.tier && (sc.merit || 0) < nr.merit; // старейшина тоже служит: печати главы нужны заслуги
}
// Устав «Пустая чаша»: раздать лишнее, пока положение не упало до изгнания (авторежим; карточка sect_beggar_purse — вручную).
export function giveAlms(data, s) {
  const sc = s.life?.sect, sd = sectDef(data, s), frown = rfx(data, sd, "stoneFrown", null);
  if (!sc || frown == null || s.spiritStones <= frown) return false;
  const give = s.spiritStones - Math.floor(frown / 2);
  s.spiritStones -= give; sc.standing = clamp((sc.standing ?? 50) + 15, 0, 100); addContrib(s, 10);
  s.life.stats.karma = clamp(s.life.stats.karma + 1, -20, 20);
  L.logLine(s, `Ты раздал(а) ${L.stonesW(give)} по чашам нищих. Братья по ${sd.name} снова здороваются первыми.`, "sect");
  return true;
}
export function marriageBlocked(data, s) { const sc = s.life?.sect; return !!(sc && !sc.lay && myFx(data, s, "noMarriage", false)); }
export const childNoMarriage = (data, id) => !!rfx(data, G.sectById(data, id), "noMarriage", false);
export const childHazardMul = (data, id) => id ? rfx(data, G.sectById(data, id), "hazardMul", 1) : 1;
export function randomSectFor(data, s, pathId, rng) {
  const pool = (data.sects?.sects || []).filter(x => x.id !== "sunmoon" && (!x.paths || x.paths.includes(pathId)));
  const w = pool.map(x => (x.regions || []).includes(s.life.regionId) ? 3 : 1);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i].id; }
  return pool[0]?.id || null;
}

// ───── карточки ─────
const friend = sc => sc?.peers?.find(p => p.alive && p.kind === "friend") || null;
const rival = sc => sc?.peers?.find(p => p.alive && p.kind === "rival") || null;
export function matches(data, s, r = {}) {
  const sc = s.life.sect;
  if (r.hasMaster && !(sc?.master?.alive && !sc.master.retired)) return false;
  if (r.masterRelMin != null && !((sc?.master?.rel ?? 0) >= r.masterRelMin)) return false;
  if (r.hasPeerRival && !rival(sc)) return false;
  if (r.hasPeerFriend && !friend(sc)) return false;
  if (r.sectWar && !sc?.war) return false;
  if (r.sectRankMin != null && !(sc && sc.rank >= r.sectRankMin)) return false;
  if (r.sectRankMax != null && !(sc && sc.rank <= r.sectRankMax)) return false;
  if (r.sectIs && !(sc && r.sectIs.includes(sc.id))) return false;
  if (r.sectHeadAlive && !(sc?.head && !sc.head.self && !sc.head.gone)) return false;
  if (r.notSectHeir && sc?.heirApparent) return false;
  if (r.sectRivalHigh && !highRival(sc)) return false;
  if (r.sectHeadSelf && !sc?.head?.self) return false;
  if (r.sectRule && !(sc && myFx(data, s, r.sectRule, false) && !sc.lay)) return false;
  return true;
}
// Эффекты секты. Уход — раньше брака (карточка «уйти ради любви»), вступление — в life.js → applyEffects.
export function applyEffects(data, s, ef = {}, rng = Math.random) {
  const L0 = s.life;
  if (ef.sectLeave && L0.sect) leaveSect(data, s, "leave");
  if (ef.sectExpel && L0.sect) leaveSect(data, s, "expel");
  const sc = L0.sect;
  if (ef.sibSect && L0.sect) {
    const x = F.livingSibs(s).find(y => y.awakened && !y.sect && (!G.sectById(data, sc.id)?.paths || G.sectById(data, sc.id).paths.includes(y.pathId)));
    if (x) { x.sect = sc.id; F.famNote(data, s, x, `${x.name} по твоему поручительству принят${x.gender === "f" ? "а" : ""} в ${G.sectById(data, sc.id).name}.`, "sect"); }
  }
  if (!sc) return;
  if (ef.contrib) addContrib(s, ef.contrib);
  if (ef.sectStanding) {
    sc.standing = clamp((sc.standing ?? 50) + ef.sectStanding, 0, 100);
    if (ef.sectStanding <= -20 && myFx(data, s, "strictBetray", false)) { L.logLine(s, `Устав «${data.sects.ruleDefs.silence?.name || "Молчание"}» не прощает.`, "sect"); leaveSect(data, s, "expel"); return; }
    if (sc.standing <= 0) { leaveSect(data, s, "expel"); return; }
  }
  const m = sc.master;
  if (ef.masterRel && m) m.rel = clamp((m.rel ?? 50) + ef.masterRel, 0, 100);
  if (ef.masterGift) {
    const t = G.luckyScroll(data, s, rng, sc.id) || G.luckyScroll(data, s, rng);
    if (t) L.logLine(s, `${m ? `${m.title[0].toUpperCase() + m.title.slice(1)} ${m.name}` : "Учитель"} передал(а) тебе «${t.name}». В книгах этого нет.`.replace("передал(а)", m?.gender === "f" ? "передала" : "передал"), "luck");
    else { s.pills += 2; L.logLine(s, "Нового приёма для тебя у учителя нет — он отдал две пилюли.", "sect"); }
  }
  if (ef.masterDeath && m?.alive) { m.alive = false; m.diedAt = L0.age; F.famNote(data, s, null, `Умер${m.gender === "f" ? "ла" : ""} ${m.title} ${m.name}.`, "death", "sect"); }
  if (ef.masterLost && m?.alive) { m.alive = false; m.diedAt = L0.age; m.disgraced = true; L.logLine(s, `${m.name} изгнан${m.gender === "f" ? "а" : ""} из секты. Учителя тебе дадут нового.`, "sect"); }
  if (ef.peerFriendLost) { const f = friend(sc); if (f) { f.kind = "rival"; L.logLine(s, `${f.name} больше не здоровается с тобой.`, "sect"); } }
  if (ef.warEnd && sc.war) { const foe = G.sectById(data, sc.war.with); sc.war = null; L.logLine(s, `С ${foe?.name} заключено перемирие.`, "sect"); }
  if (ef.sectHeir && !sc.heirApparent && sc.rank === topRank(data) - 1) { sc.heirApparent = true; F.famNote(data, s, null, `Глава ${sc.head?.name || ""} назвал(а) тебя преемником.`.replace("назвал(а)", sc.head?.gender === "f" ? "назвала" : "назвал"), "rank", "sect"); }
  if (ef.sectHeirLost && sc.heirApparent) { sc.heirApparent = false; L.logLine(s, "Совет больше не зовёт тебя преемником.", "sect"); }
  if (ef.sectYield && sc.seatFor === topRank(data)) { appointOther(data, s, rng, "Ты уступил(а) печать."); return; }
  if (ef.sectTrial) doTrial(data, s, rng);
  if (ef.sectWait) sc.lastTrial = L0.age - (cfg(data).trial?.gapYears ?? 3) + 1;
}
export function vars(data, s) {
  const sc = s.life?.sect, sd = sectDef(data, s), m = sc?.master;
  const mw = m ? `${m.title} ${given(m.name)}` : "наставник";
  return { sect: sd?.name || "секта", master: mw, Master: mw[0].toUpperCase() + mw.slice(1), peerRival: rival(sc)?.name || "соперник", peerFriend: friend(sc)?.name || "друг", sectEnemy: G.sectById(data, sc?.war?.with)?.name || "враги", sectHead: sc?.head && !sc.head.self ? sc.head.name : "глава", peerRivalHigh: highRival(sc)?.name || "соперник" };
}
