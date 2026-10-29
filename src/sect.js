// Жизнь в секте: ранги, вклад, наставник, соученики, устав, войны сект, уход и изгнание.
//   L.sect = { id, since, rank, merit, contrib, standing, master, peers, war, lay, lastTrial, head, heirApparent, seatFor }
//   Глава секты (sc.head) — живой человек: правит, стареет, уходит (смерть, затвор, гибель в войне сект). Печать главы
//     освобождается только тогда — и только старейшина, выполнивший условия, выходит к испытанию «Печать главы».
//     Не вышло или не годишься — печать берёт другой (соперник, друг или кто-то из старейшин). Названный преемник — +к шансу.
//   Ранг (sects.json → ranks): слуга → внешний → внутренний → личный → старший ученик → старейшина → глава.
//     Повышение: ярус пути ≥ rank.tier, заслуги merit ≥ rank.merit, карма по уставу — и испытание (карточка sect_trial_N).
//     Доступ к техникам (game.js → sectRank): внешний — средняя колесница, внутренний — верхняя колесница, личный и выше — цзюэсюэ.
//   вклад за год: (base + perTier × ярус) × устав × война; в фокусе «Служба секте» ×focusMul + focusAdd.
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
// Устав с правками главы (sc.ruleOverrides = { off: [смягчённые], add: [ужесточённые] }) — только в этой жизни и только своей секте.
export function activeRules(data, sd, ov = null) {
  const off = new Set(ov?.off || []);
  return [...(sd?.rules || []).filter(id => !off.has(id)), ...(ov?.add || []).filter(id => !(sd?.rules || []).includes(id))];
}
export function rfx(data, sd, k, dflt, ov = null) {
  for (const id of activeRules(data, sd, ov)) { const v = data.sects?.ruleDefs?.[id]?.fx?.[k]; if (v != null) return v; }
  return dflt;
}
const ovFor = (s, sd) => sd && s?.life?.sect?.id === sd.id ? s.life.sect.ruleOverrides || null : null;
const sfx = (data, s, sd, k, dflt) => rfx(data, sd, k, dflt, ovFor(s, sd));
const myFx = (data, s, k, dflt) => sfx(data, s, sectDef(data, s), k, dflt);
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
    F.famNote(data, s, null, `Ты вступил(а) в секту ${sd.name}: ${R[rk].name}${lay ? " (мирской ученик)" : ""}. Её средняя колесница открыта внешним ученикам, верхняя — внутренним, цзюэсюэ — личным.${L0.sect.master ? ` Наставник — ${L0.sect.master.name}.` : ""}`, "sect", "awaken");
    CL.applyEffects(data, s, { rep: 1 + rk });
  }
  return true;
}
// ───── глава секты и преемство ─────
const SUCC = data => cfg(data).succession || {};
const topRank = data => ranks(data).length - 1;
// Дар (талант) — скорость пути: корень × душа × тело × эпоха × край (game.js → pathMult). Обычный — около 1.
const TALENT_WORDS = [[0.7, "посредственный"], [1.1, "обычный"], [1.6, "способный"], [2.4, "одарённый"], [Infinity, "редкий дар"]];
export const talentWord = v => TALENT_WORDS.find(([x]) => v < x)[1];
const hashU = str => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
const rollTalent = u => Math.round((0.55 + u * u * 2.4) * 100) / 100;
export function peerTalent(p) { if (p.talent == null) p.talent = rollTalent(hashU(p.name + "dao")); return p.talent; }
export function myTalent(data, s) { try { return G.pathMult(data, s) || 0.5; } catch (e) { return 1; } }
export function kinTalent(data, s, c) { try { return G.pathMult(data, L.childState(data, s, c), c.pathId || "qi") || 0.5; } catch (e) { return 1; } }
// Годишься ли ты в главы, когда печать свободна: названный преемник — с ранга heirMinRank (дар важнее выслуги),
// остальные — старейшина, выполнивший все условия ранга главы. Ступень главы нужна всем.
function headEligible(data, s) {
  const sc = s.life?.sect, R = ranks(data), top = topRank(data);
  if (!sc || sc.lay || G.maxTier(data, s) < R[top].tier) return false;
  if (sc.heirApparent) return sc.rank >= (SUCC(data).heirMinRank ?? 3);
  return sc.rank === top - 1 && !baseBlock(data, s);
}
// Кого глава назовёт преемником: самого одарённого из тебя и соучеников с ранга heirMinRank. Твой дар весит
// с поправкой на положение в секте (×0.6 при 0, ×1.0 при 50, ×1.4 при 100).
function nameHeir(data, s, hd) {
  const sc = s.life.sect, C = SUCC(data), min = C.heirMinRank ?? 3;
  const st = sc.standing ?? 50;
  const me = sc.rank >= min && !sc.lay && st >= (C.heirStanding ?? 40) ? myTalent(data, s) * (0.6 + st / 125) : 0;
  const peer = (sc.peers || []).filter(p => p.alive && p.rank >= min).map(p => ({ p, v: peerTalent(p) })).sort((a, b) => b.v - a.v)[0];
  if (me > 0 && (!peer || me >= peer.v)) {
    if (sc.heirApparent) return;
    sc.heirApparent = true; sc.headHeir = null;
    F.famNote(data, s, null, L.gtext(`Глава ${hd.name} при всём совете назвал(а) тебя преемником: «${talentWord(myTalent(data, s))} дар не держат во внешнем дворе». Старейшины кланялись — кто искренне, кто нет.`, hd.gender), "rank", "sect");
  } else if (peer && sc.headHeir !== peer.p.name) {
    const was = sc.heirApparent, fem = peer.p.gender === "f";
    const rel = peer.p.kind === "friend" ? (fem ? "твою подругу" : "твоего друга") : (fem ? "твою соперницу" : "твоего соперника");
    sc.heirApparent = false; sc.headHeir = peer.p.name;
    L.logLine(s, L.gtext(`Глава ${hd.name} назвал(а) преемником ${rel} ${peer.p.name}: дар — ${talentWord(peer.v)}.`, hd.gender) + (was ? " Тебя больше не зовут преемником." : ""), "sect");
  }
}
// Печать в твоих руках.
function takeSeal(data, s, rng, text) {
  const sc = s.life.sect, R = ranks(data), top = topRank(data);
  sc.rank = top; sc.merit = Math.max(sc.merit || 0, R[top].merit); sc.seatFor = null; sc.vacantAt = null; sc.heirApparent = false; sc.headHeir = null; sc.successor = null;
  sc.head = { self: true, name: s.life.name, gender: s.life.gender, since: s.life.age };
  if (sc.master?.alive) sc.master = { ...sc.master, retired: true };
  ensureDisciples(data, s, rng);
  sc.treasury = Math.max(sc.treasury ?? 0, HP(data).startTreasury ?? 120);
  F.famNote(data, s, null, text, "rank", "sect");
  CL.applyEffects(data, s, { rep: SUCC(data).headRep ?? 15 });
}
// ───── ты — глава: ученики и преемник ─────
function newDisciple(data, s, rng, genius = false) {
  const p = person(data, s, rng, { kind: "disciple", age0: s.life.age, rank: 2 });
  p.talent = genius ? Math.round((2.4 + rng() * 0.8) * 100) / 100 : rollTalent(rng()); return p;
}
function ensureDisciples(data, s, rng, min = SUCC(data).disciples ?? 3) {
  const sc = s.life.sect;
  sc.disciples = (sc.disciples || []).filter(d => d.alive);
  while (sc.disciples.length < min) sc.disciples.push(newDisciple(data, s, rng));
}
// Родня по роли: дети → внуки → правнуки; братья/сёстры → племянники → внучатые.
function kinNodes(s) {
  const L0 = s.life, out = [], NX = { child: "grand", grand: "great", sib: "nephew", nephew: "gnephew" };
  const add = (n, role) => { out.push({ node: n, role }); const r = NX[role]; if (r) for (const k of n.kids || []) add(k, r); };
  for (const c of L0.children || []) add(c, "child");
  for (const x of L0.household?.siblings || []) if (L0.age - x.born >= 0) add(x, "sib");
  return out;
}
// Кого можно назвать преемником: кого угодно — родню на Пути (её путь секта учит), учеников, соучеников.
export function successorCandidates(data, s) {
  const sc = s.life?.sect, sd = sectDef(data, s); if (!sc?.head?.self) return [];
  const ok = n => n.alive && n.awakened && (!sd?.paths || sd.paths.includes(n.pathId || "qi")) && !(n.sect && n.sect !== sc.id);
  const kin = kinNodes(s).filter(x => ok(x.node)).map(x => ({ kind: "kin", ref: x.node, name: x.node.name, gender: x.node.gender, who: L.kinWord(x.node, x.role), talent: kinTalent(data, s, x.node) }));
  const dis = (sc.disciples || []).filter(p => p.alive).map(p => ({ kind: "disciple", ref: p, name: p.name, gender: p.gender, who: p.gender === "f" ? "ученица" : "ученик", talent: p.talent }));
  const peers = (sc.peers || []).filter(p => p.alive).map(p => ({ kind: "peer", ref: p, name: p.name, gender: p.gender,
    who: p.kind === "friend" ? (p.gender === "f" ? "подруга" : "друг") : (p.gender === "f" ? "соперница" : "соперник"), talent: peerTalent(p) }));
  return [...kin, ...dis, ...peers].map((c, i) => ({ ...c, i, word: talentWord(c.talent), cur: sc.successor?.name === c.name }));
}
export function appointSuccessor(data, s, i) {
  const sc = s.life?.sect, list = successorCandidates(data, s), c = list[i];
  if (!c) return { ok: false, msg: "Такого кандидата нет." };
  for (const x of kinNodes(s)) if (x.node.sectSuccessor) delete x.node.sectSuccessor;
  if (c.kind === "kin") { c.ref.sectSuccessor = true; if (!c.ref.sect) c.ref.sect = sc.id; }
  sc.successor = { name: c.name, gender: c.gender, kind: c.kind, who: c.who, talent: c.talent };
  const best = Math.max(0, ...list.filter(x => x.kind !== "kin").map(x => x.talent));
  let msg = L.gtext(`Ты назвал(а) преемником: ${c.who} ${c.name}, дар — ${c.word}.`, s.life.gender);
  if (c.kind === "kin" && c.talent < best * (SUCC(data).nepotism ?? 0.7)) {
    sc.standing = clamp((sc.standing ?? 50) - (SUCC(data).nepotismStanding ?? 10), 0, 100);
    msg += " Старейшины промолчали, но запомнили: печать уходит по крови, а не по дару.";
  } else if (c.talent >= best) { sc.standing = clamp((sc.standing ?? 50) + 3, 0, 100); msg += " Совет кивнул: дар виден всем."; }
  F.famNote(data, s, c.kind === "kin" ? c.ref : null, msg, "rank", "sect");
  return { ok: true, msg };
}
// Авторежим: самый одарённый, родне — небольшая фора.
export function autoAppoint(data, s) {
  const list = successorCandidates(data, s); if (!list.length) return;
  const best = list.reduce((b, c) => (c.talent * (c.kind === "kin" ? 1.15 : 1) > b.talent * (b.kind === "kin" ? 1.15 : 1) ? c : b), list[0]);
  if (s.life.sect.successor?.name !== best.name) appointSuccessor(data, s, best.i);
}
function headSelfYear(data, s, rng) {
  const sc = s.life.sect, C = SUCC(data);
  for (const d of sc.disciples || []) if (d.alive && rng() < (C.discipleDeath ?? 0.01)) {
    d.alive = false; L.logLine(s, `${d.gender === "f" ? "Твоя ученица" : "Твой ученик"} ${d.name} погиб${d.gender === "f" ? "ла" : ""} в странствии.`, "sect");
  }
  if (sc.successor && !successorCandidates(data, s).some(c => c.name === sc.successor.name)) {
    L.logLine(s, L.gtext(`${sc.successor.name} больше не может принять печать. Преемника нужно назвать заново.`, s.life.gender), "sect");
    sc.successor = null;
  }
  ensureDisciples(data, s, rng, 1); // сверх одного учеников набирают из казны (власть главы)
  const inc = treasuryIncome(data, s);
  sc.treasury = (sc.treasury ?? 0) + inc.stones; addContrib(s, inc.contrib);
  if (s.settings?.autoPlay) autoHead(data, s, rng);
  if (!sc.successor && s.settings?.autoPlay) autoAppoint(data, s);
}
// Кому уходит печать после твоей смерти: названному преемнику, иначе — самому одарённому не из родни (решает совет).
export function deathSuccession(data, s) {
  const sc = s.life?.sect; if (!sc?.head?.self) return null;
  const list = successorCandidates(data, s);
  let c = sc.successor ? list.find(x => x.name === sc.successor.name) : null;
  const will = !!c;
  if (!c) c = list.filter(x => x.kind !== "kin").sort((a, b) => b.talent - a.talent)[0] || null;
  if (!c) return { sectId: sc.id, name: null, will: false };
  return { sectId: sc.id, name: c.name, gender: c.gender, kind: c.kind, who: c.who, talent: c.talent, word: c.word, will };
}
// Наследник из той же секты: названный преемник принимает печать (с Золотого ядра; до того правит регент),
// остальным главой становится тот, кому печать ушла.
export function heirSeal(data, s, prev, child, rng = Math.random) {
  const sc = s.life?.sect, su = prev?.sectSucc; if (!sc || !su?.name || su.sectId !== sc.id) return;
  const R = ranks(data), top = topRank(data), sd = sectDef(data, s);
  if (child.sectSuccessor) {
    const t = L.gtext(`${prev.name} завещал(а) печать главы тебе`, prev.gender);
    if (G.maxTier(data, s) >= R[top].tier) takeSeal(data, s, rng, `${t}: теперь ты ${R[top].name} секты ${sd.name}.`);
    else {
      sc.rank = Math.max(sc.rank, SUCC(data).heirMinRank ?? 3); sc.heirApparent = true;
      sc.head = { ...newHead(data, s, rng, true), regent: true };
      L.logLine(s, `${t}, но совет не отдаст её, пока ты не войдёшь в «${G.realmForTier(data, s, R[top].tier).name}». До тех пор правит регент ${sc.head.name}.`, "sect");
    }
  } else sc.head = { name: su.name, gender: su.gender, since: s.life.age };
}
function newHead(data, s, rng, fresh = false) {
  const h = person(data, s, rng); h.since = s.life.age - (fresh ? 0 : Math.floor(rng() * (SUCC(data).startTenure ?? 60)));
  return h;
}
export function ensureHead(data, s, rng = Math.random) { const sc = s.life?.sect; if (sc && !sc.head) sc.head = newHead(data, s, rng); return sc?.head || null; }
// Печать уходит другому: соперник-старейшина, друг-старейшина или кто-то из круга.
function appointOther(data, s, rng, prefix = "") {
  const L0 = s.life, sc = L0.sect, top = topRank(data), sd = sectDef(data, s);
  const named = sc.headHeir && (sc.peers || []).find(p => p.alive && p.name === sc.headHeir);
  const cand = named || (sc.peers || []).filter(p => p.alive && p.rank === top - 1).sort((a, b) => peerTalent(b) - peerTalent(a))[0];
  let txt;
  if (cand) {
    const f = cand.gender === "f";
    cand.rank = top; sc.head = { name: cand.name, gender: cand.gender, since: L0.age, peer: cand.kind };
    if (cand.kind === "rival") { sc.standing = clamp((sc.standing ?? 50) - (SUCC(data).rivalHeadStanding ?? 8), 0, 100); txt = `Печать главы взял(а) ${f ? "твоя соперница" : "твой соперник"} ${cand.name}. Теперь каждый твой шаг видно сверху.`; }
    else { sc.standing = clamp((sc.standing ?? 50) + 5, 0, 100); txt = `Печать главы принял(а) ${f ? "твоя подруга" : "твой друг"} ${cand.name}: в совете у тебя теперь есть рука.`; }
    txt = L.gtext(txt, cand.gender);
  } else { sc.head = newHead(data, s, rng, true); txt = L.gtext(`Новым главой стал(а) ${sc.head.name} из старейшин.`, sc.head.gender); }
  sc.seatFor = null; sc.heirApparent = false; sc.vacantAt = null; sc.headHeir = null;
  L.logLine(s, `${prefix}${prefix ? " " : ""}${txt}`, "sect");
}
// Глава уходит: если ты старейшина и годишься — печать ждёт тебя (испытание sect_trial_N), иначе её берёт другой.
function succession(data, s, rng, how0 = null) {
  const L0 = s.life, sc = L0.sect, sd = sectDef(data, s), old = sc.head, top = topRank(data);
  const how = how0 || (sc.war ? "пал(а) в войне сект" : rng() < 0.3 ? "ушёл(ла) в вечный затвор" : "умер(ла)");
  const pre = L.gtext(`Глава ${old.name} ${how}.`, old.gender);
  // Ушёл глава из твоих соучеников — его больше нет и среди них.
  if (old.peer) for (const p of sc.peers || []) if (p.alive && p.name === old.name && p.rank === top) { p.alive = false; p.diedAt = L0.age; }
  // Регент ушёл раньше, чем завещанный преемник дорос до печати: совет ставит нового регента, завещание в силе.
  if (old.regent && sc.heirApparent && !headEligible(data, s)) {
    sc.head = { ...newHead(data, s, rng, true), regent: true };
    L.logLine(s, `${pre} Совет поставил нового регента — ${sc.head.name}. Печать по-прежнему ждёт тебя.`, "sect");
    return;
  }
  if (headEligible(data, s)) {
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
  // Регент уступает печать, как только завещанный преемник дорос до ступени главы.
  if (hd.regent && sc.heirApparent && headEligible(data, s)) { succession(data, s, rng, "сложил(а) регентство"); return; }
  // Глава выбирает преемника по дару (nameHeir) — раз в несколько лет пересматривает.
  if (!hd.regent && sc.rank >= (C.heirMinRank ?? 3) && rng() < (C.nameChance ?? 0.05)) nameHeir(data, s, hd);
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
  const sc = s.life?.sect; if (!sc) return null;
  const top = topRank(data);
  if (sc.seatFor === top) return headEligible(data, s) && by(data.events.events, `sect_trial_${top}`) ? `sect_trial_${top}` : null;
  if (promoteBlock(data, s)) return null;
  if (s.life.age - (sc.lastTrial ?? -99) < (cfg(data).trial?.gapYears ?? 3)) return null;
  const id = `sect_trial_${sc.rank + 1}`;
  return by(data.events.events, id) ? id : null;
}
export function trialChance(data, s) {
  const T = cfg(data).trial || {}, sc = s.life.sect, C = SUCC(data), R = ranks(data), top = topRank(data);
  const forHead = sc.seatFor === top, tgt = forHead ? R[top] : nextRank(data, s);
  // Печать главы: спор (−), названный преемник (+), соперник в круге (−), дар (+ за каждую единицу сверх обычного).
  const succ = forHead ? (C.contested ?? -0.15) + (sc.heirApparent ? C.heirBonus ?? 0.25 : 0) + (highRival(sc) ? C.rivalPenalty ?? -0.1 : 0) + (C.perTalent ?? 0.1) * (myTalent(data, s) - 1) : 0;
  return clamp((T.base ?? 0.6) + (T.perDao ?? 0.03) * G.daoHeartEff(data, s) + (T.perTier ?? 0.15) * (G.maxTier(data, s) - (tgt?.tier ?? 0)) + ((sc.standing ?? 50) - 50) / 200 + succ, T.min ?? 0.2, T.max ?? 0.95);
}
function doTrial(data, s, rng) {
  const sc = s.life.sect, R = ranks(data), sd = sectDef(data, s);
  sc.lastTrial = s.life.age;
  if (sc.seatFor === topRank(data)) {
    if (!headEligible(data, s)) { appointOther(data, s, rng, "Совет решил, что ты не готов(а) к печати."); return; }
    if (rng() < trialChance(data, s)) takeSeal(data, s, rng, `Печать главы в твоих руках: теперь ты ${R[topRank(data)].name} секты ${sd.name}. Старейшины поклонились — и каждый запомнил, как именно.`);
    else appointOther(data, s, rng, "Совет старейшин не отдал тебе печать.");
    return;
  }
  if (promoteBlock(data, s)) return;
  if (rng() < trialChance(data, s)) {
    sc.rank += 1; sc.seatFor = null;
    if (sc.rank >= 4) sc.master = sc.master?.alive ? { ...sc.master, retired: true } : sc.master;
    F.famNote(data, s, null, `Испытание пройдено: теперь ты ${R[sc.rank].name} секты ${sd.name}.${sc.rank === 2 ? " Открыта верхняя колесница." : sc.rank === 3 ? " Открыты цзюэсюэ." : ""}`, "rank", "sect");
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
  else if (s.life.focusId === "practice") v *= sfx(data, s, sd, "practiceContribMul", 1);
  v *= sfx(data, s, sd, "contribMul", 1) * (sc.war ? cfg(data).warContribMul ?? 1.5 : 1);
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
  const frown = sfx(data, s, sd, "stoneFrown", null);
  if (frown != null && s.spiritStones > frown) { sc.standing = clamp(sc.standing + (C.frownStanding ?? -3), 0, 100); if (L0.age % 5 === 0) L.logLine(s, `Братья по ${sd.name} косятся на твой кошель: у нищего он должен быть дырявым.`, "sect"); }
  const cc = sfx(data, s, sd, "connChance", 0);
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
  if (sc.war && L0.age >= sc.war.until) endWar(data, s, rng);
  else if (!sc.war && sectEnemies(data, s).length && rng() < (C.warChance ?? 0.02)) {
    const foe = G.sectById(data, pick(sectEnemies(data, s), rng));
    if (foe) startWar(data, s, foe, rng, false);
  }
  // Глава секты правит, стареет и уходит — тогда и решается, кому печать.
  headYear(data, s, rng);
  if (!L0.sect) return;
  if (sc.head?.self) headSelfYear(data, s, rng);
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
  const wh = (cfg(data).warHazard ?? 1.2) - 1;
  return myFx(data, s, "hazardMul", 1) * (sc.war ? 1 + wh * (fortified(s) ? HP(data).fortifyHazard ?? 0.4 : 1) : 1);
}
export function onAdventureWin(data, s) {
  const sc = s.life?.sect; if (!sc) return;
  const C = cfg(data).contrib || {}, sd = sectDef(data, s);
  const cap = C.advCapYear ?? 20, v = (C.advWin ?? 2) * sfx(data, s, sd, "advContribMul", 1);
  const add = Math.max(0, Math.min(v, cap - (sc.advYear || 0)));
  if (add > 0) { sc.advYear = (sc.advYear || 0) + add; addContrib(s, add); }
}
// Траты вклад: техника секты и пилюля.
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
  const sc = s.life?.sect, sd = sectDef(data, s), frown = sfx(data, s, sd, "stoneFrown", null);
  if (!sc || frown == null || s.spiritStones <= frown) return false;
  const give = s.spiritStones - Math.floor(frown / 2);
  s.spiritStones -= give; sc.standing = clamp((sc.standing ?? 50) + 15, 0, 100); addContrib(s, 10);
  s.life.stats.karma = clamp(s.life.stats.karma + 1, -20, 20);
  L.logLine(s, `Ты раздал(а) ${L.stonesW(give)} по чашам нищих. Братья по ${sd.name} снова здороваются первыми.`, "sect");
  return true;
}
export function marriageBlocked(data, s) { const sc = s.life?.sect; return !!(sc && !sc.lay && myFx(data, s, "noMarriage", false)); }
export const childNoMarriage = (data, id, s = null) => { const sd = G.sectById(data, id); return !!rfx(data, sd, "noMarriage", false, s ? ovFor(s, sd) : null); };
export const childHazardMul = (data, id) => id ? rfx(data, G.sectById(data, id), "hazardMul", 1) : 1;
export function randomSectFor(data, s, pathId, rng) {
  const pool = (data.sects?.sects || []).filter(x => x.id !== "sunmoon" && (!x.paths || x.paths.includes(pathId)));
  const w = pool.map(x => (x.regions || []).includes(s.life.regionId) ? 3 : 1);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i].id; }
  return pool[0]?.id || null;
}

// ───── власть главы: казна, война и мир, устав, кадры, библиотека рода ─────
// Всё — только пока печать у тебя (sc.head.self). Параметры — sects.json → config.headPowers.
const HP = data => cfg(data).headPowers || {};
const isHead = s => !!s.life?.sect?.head?.self;
const aliveDis = sc => (sc?.disciples || []).filter(d => d.alive);
const cdLeft = (s, at, gap) => at == null ? 0 : Math.max(0, at + gap - s.life.age);
export const fortified = s => (s.life?.sect?.fortUntil ?? -1) > (s.life?.age ?? 0);
const capT = (data, v) => Math.min(HP(data).talentCap ?? 3.2, Math.round(v * 100) / 100);
const stand = (s, d) => { const sc = s.life.sect; sc.standing = clamp((sc.standing ?? 50) + d, 0, 100); };
export function sectAllies(data, s) { const sd = sectDef(data, s), sc = s.life?.sect; return [...new Set([...(sd?.allies || []), ...(sc?.extraAllies || [])])]; }
export function sectEnemies(data, s) { const sd = sectDef(data, s), al = new Set(sectAllies(data, s)); return (sd?.enemies || []).filter(id => !al.has(id) && G.sectById(data, id)); }
export function treasuryIncome(data, s) {
  const sc = s.life?.sect, H = HP(data), sd = sectDef(data, s); if (!isHead(s)) return { stones: 0, contrib: 0 };
  const tight = activeRules(data, sd, sc.ruleOverrides).filter(id => !(sd?.rules || []).includes(id)).length;
  const v = ((H.incomeBase ?? 20) + (H.incomePerStanding ?? 0.5) * (sc.standing ?? 50)) * (sc.war ? H.warIncomeMul ?? 0.6 : 1) * (1 + (H.tightIncome ?? 0.1) * tight) * sfx(data, s, sd, "contribMul", 1);
  return { stones: Math.round(v), contrib: Math.round(H.contribIncome ?? 12) };
}
export function warWinChance(data, s) {
  const sc = s.life?.sect, H = HP(data); if (!isHead(s)) return 0.45;
  const allies = Math.min(2, sectAllies(data, s).length), dis = aliveDis(sc);
  const strength = dis.reduce((a, d) => a + (d.talent || 1), 0) / 3;
  return clamp((H.warBase ?? 0.45) + (fortified(s) ? H.fortifyWin ?? 0.15 : 0) + (H.allyWin ?? 0.05) * allies + (H.discipleWin ?? 0.05) * (strength - 1) + ((sc.standing ?? 50) - 50) / 400, 0.15, 0.85);
}
function startWar(data, s, foe, rng, declared) {
  const sc = s.life.sect, sd = sectDef(data, s), [a, b] = cfg(data).warYears || [3, 6];
  sc.war = { with: foe.id, until: s.life.age + a + Math.floor(rng() * (b - a + 1)), declared: !!declared };
  F.famNote(data, s, null, declared ? `Ты объявил(а) войну ${foe.name}. Ученики точат мечи, старейшины считают свитки: до перевала три дня пути.`
    : `Началась война сект: ${sd.name} против ${foe.name}. Тропы перекрыты, ученики ходят по трое.`, "sect", "sect");
}
function endWar(data, s, rng) {
  const sc = s.life.sect, foe = G.sectById(data, sc.war.with), r = rng(), H = HP(data), declared = !!sc.war.declared;
  if (isHead(s)) {
    const p = warWinChance(data, s);
    if (r < p) {
      const spoils = H.warSpoils ?? 120;
      addContrib(s, 20); stand(s, H.warWinStanding ?? 8); sc.treasury = (sc.treasury ?? 0) + spoils; CL.applyEffects(data, s, { rep: H.warRep ?? 6 });
      F.famNote(data, s, null, `Война с ${foe?.name} окончена победой. В казну секты легло ${L.stonesW(spoils)}, имя рода повторяют в чайных.`, "sect", "sect");
    } else if (r < p + (1 - p) * 0.55) L.logLine(s, `С ${foe?.name} заключено перемирие. Обе секты считают убитых.`, "sect");
    else {
      const loss = Math.floor((sc.treasury ?? 0) * (H.warLossShare ?? 0.3));
      stand(s, (H.warLossStanding ?? -10) + (declared ? -5 : 0)); sc.treasury = Math.max(0, (sc.treasury ?? 0) - loss);
      F.famNote(data, s, null, `Война с ${foe?.name} проиграна: секта уступила перевал и два храма, казна похудела на ${L.stonesW(loss)}.${declared ? " Старейшины помнят, кто её начал." : ""}`, "sect", "sect");
    }
  } else if (r < 0.45) { addContrib(s, 20); sc.standing = clamp(sc.standing + 5, 0, 100); F.famNote(data, s, null, `Война с ${foe?.name} окончена победой: тропы снова ваши.`, "sect", "sect"); }
  else if (r < 0.8) L.logLine(s, `С ${foe?.name} заключено перемирие. Обе секты считают убитых.`, "sect");
  else { sc.standing = clamp(sc.standing - 5, 0, 100); F.famNote(data, s, null, `Война с ${foe?.name} проиграна: секта уступила перевал и два храма.`, "sect", "sect"); }
  sc.war = null;
}
function allyCandidates(data, s) {
  const sc = s.life.sect, mine = sectDef(data, s), al = new Set(sectAllies(data, s)), en = new Set(mine?.enemies || []);
  return (data.sects?.sects || []).filter(x => x.id !== sc.id && !al.has(x.id) && !en.has(x.id) && !(x.enemies || []).includes(sc.id) && x.id !== sc.war?.with);
}
function addAlly(data, s, x) {
  const sc = s.life.sect; (sc.extraAllies ??= []).push(x.id);
  stand(s, HP(data).allyStanding ?? 4); CL.applyEffects(data, s, { rep: HP(data).allyRep ?? 3 });
  F.famNote(data, s, null, `${sectDef(data, s).name} и ${x.name} заключили союз: чаша на двоих у водопада и печати на одном свитке.`, "sect", "sect");
}
function ruleName(data, id) { return data.sects?.ruleDefs?.[id]?.name || id; }
function ruleChoices(data, s) {
  const sc = s.life.sect, sd = sectDef(data, s), ov = sc.ruleOverrides || {}, act = new Set(activeRules(data, sd, ov));
  const hasFx = id => Object.keys(data.sects?.ruleDefs?.[id]?.fx || {}).length > 0;
  const soft = (sd?.rules || []).filter(id => act.has(id) && hasFx(id) && id !== "heretic");
  const tight = (HP(data).tightenPool || ["silence", "alms", "compassion", "noWealth"]).filter(id => !act.has(id) && data.sects?.ruleDefs?.[id]).slice(0, 2);
  return { soft, tight };
}
function headKin(data, s) {
  const sc = s.life.sect, sd = sectDef(data, s);
  return kinNodes(s).filter(x => x.node.alive && x.node.awakened && !x.node.sect && (!sd?.paths || sd.paths.includes(x.node.pathId || "qi")));
}
const rivalsOf = sc => (sc?.peers || []).filter(p => p.alive && p.kind === "rival");
function libPool(data, s) {
  const sc = s.life.sect, fam = new Set(s.familyTechs || []), gr = HP(data).libraryGrades || ["zhong", "shang"];
  return data.techniques.techniques.filter(x => x.owner === sc.id && gr.includes(x.grade) && !fam.has(x.id));
}
// Список действий для панели «Власть главы»: { act, arg, label, hint, ok, why }.
export function headPanel(data, s) {
  const sc = s.life?.sect; if (!isHead(s)) return null;
  const H = HP(data), T = sc.treasury ?? 0, R = ranks(data), age = s.life.age;
  const it = (act, arg, label, hint, ok, why = "") => ({ act, arg, label, hint, ok: !!ok, why });
  const money = c => T >= c ? "" : `в казне ${T} из ${c}`;
  const cash = [
    it("pills", null, `Пилюли ученикам · ${H.pillCost ?? 30}`, "Каждому ученику — дар чуть выше, тебе — положение +2.", T >= (H.pillCost ?? 30) && aliveDis(sc).length, aliveDis(sc).length ? money(H.pillCost ?? 30) : "нет учеников"),
    it("fortify", null, `Укрепить ворота · ${H.fortifyCost ?? 80}`, `На ${L.yearsW(H.fortifyYears ?? 6)}: беды войны слабее, шанс победы +${Math.round((H.fortifyWin ?? 0.15) * 100)}%.`, T >= (H.fortifyCost ?? 80) && !fortified(s), fortified(s) ? "стены уже крепки" : money(H.fortifyCost ?? 80)),
    it("recruit", null, `Набрать ученика · ${H.recruitCost ?? 60}`, "Новый личный ученик; дар — как повезёт.", T >= (H.recruitCost ?? 60) && aliveDis(sc).length < (H.maxDisciples ?? 5), aliveDis(sc).length >= (H.maxDisciples ?? 5) ? "учеников и так полный двор" : money(H.recruitCost ?? 60)),
    it("take", null, `Взять себе ${Math.floor(T * (H.takeShare ?? 0.5))} камн.`, `Камни тебе, но положение ${H.takeStanding ?? -12} и обида совета — старейшины умеют считать.`, T >= (H.takeMin ?? 20), money(H.takeMin ?? 20)),
  ];
  const war = [];
  if (sc.war) war.push(it("truce", null, `Предложить мир ${G.sectById(data, sc.war.with)?.name} · ${H.truceCost ?? 40}`, `Война кончится сразу; положение ${sc.war.declared ? H.declaredTruceStanding ?? -6 : H.truceStanding ?? -3}.`, T >= (H.truceCost ?? 40), money(H.truceCost ?? 40)));
  else for (const id of sectEnemies(data, s)) { const x = G.sectById(data, id); war.push(it("war", id, `Объявить войну: ${x.name} · ${H.declareCost ?? 50}`, `Победа — казна +${H.warSpoils ?? 120}, известность рода +${H.warRep ?? 6}; поражение — положение и треть казны.`, T >= (H.declareCost ?? 50), money(H.declareCost ?? 50))); }
  const acd = cdLeft(s, sc.allyAt, H.allyYears ?? 10);
  for (const x of allyCandidates(data, s).slice(0, 3)) war.push(it("ally", x.id, `Союз: ${x.name} · ${H.allyCost ?? 60}`, `Шанс ~${Math.round(allyChance(data, s) * 100)}%: союзник помогает в войне, известность +${H.allyRep ?? 3}.`, T >= (H.allyCost ?? 60) && !acd, acd ? `следующее посольство через ${L.yearsW(acd)}` : money(H.allyCost ?? 60)));
  const rc = ruleChoices(data, s), rcd = cdLeft(s, sc.ruleAt, H.ruleYears ?? 15);
  const rules = [...rc.soft.map(id => it("soften", id, `Смягчить «${ruleName(data, id)}»`, `${data.sects.ruleDefs[id].text} Правило перестанет действовать; старая гвардия недовольна (положение ${H.softenStanding ?? -8}).`, !rcd, rcd ? `устав менять можно раз в ${L.yearsW(H.ruleYears ?? 15)}: ещё ${L.yearsW(rcd)}` : "")),
    ...rc.tight.map(id => it("tighten", id, `Ужесточить: «${ruleName(data, id)}»`, `${data.sects.ruleDefs[id].text} Строгость — казне +${Math.round((H.tightIncome ?? 0.1) * 100)}% в год; молодые ворчат (положение ${H.tightenStanding ?? -3}).`, !rcd, rcd ? `ещё ${L.yearsW(rcd)}` : ""))];
  const ecd = cdLeft(s, sc.expelAt, H.expelYears ?? 10);
  const staff = [
    ...headKin(data, s).slice(0, 4).map((x, i) => it("admit", i, `Принять в секту: ${L.kinWord(x.node, x.role)} ${x.node.name}`, `Без испытания — по слову главы. Положение ${H.admitStanding ?? -2}.`, true)),
    ...aliveDis(sc).map((d, i) => it("promote", i, `Повысить ${d.name} (${R[d.rank ?? 2]?.name})`, `Казна −${H.promoteCost ?? 40}. Повысишь самого одарённого — совет кивнёт, любимчика — поморщится.`, (d.rank ?? 2) < 5 && T >= (H.promoteCost ?? 40), (d.rank ?? 2) >= 5 ? "выше — только печать" : money(H.promoteCost ?? 40))),
    ...aliveDis(sc).map((d, i) => it("teach", i, `Передать технику: ${d.name}`, `Дар ученика +${H.teachTalent ?? 0.15}; ты теряешь ${Math.round((H.teachQiPct ?? 0.2) * 100)}% ци до слоя.`, !d.taught, d.taught ? "уже передано" : "")),
    ...rivalsOf(sc).map((p, i) => it("expel", i, `Изгнать соперника ${p.name}`, `Риск раскола ~${Math.round(((H.splitChance ?? 0.35) + (p.rank >= 5 ? H.splitHighRival ?? 0.15 : 0)) * 100)}%: уйдёт с учениками и частью казны.`, !ecd, ecd ? `после прошлого изгнания совет ещё не остыл: ${L.yearsW(ecd)}` : "")),
  ];
  const lcd = cdLeft(s, sc.libAt, H.libraryYears ?? 10), pool = libPool(data, s);
  const clan = [it("library", null, "Свиток секты — в родовую библиотеку", `Раз в ${L.yearsW(H.libraryYears ?? 10)}: свиток средней или верхней колесницы секты потомкам бесплатно. Узнают (~${Math.round((H.libraryRisk ?? 0.3) * 100)}%) — положение ${H.libraryStanding ?? -12}.`, !lcd && pool.length && CL.clanOf(s), lcd ? `ещё ${L.yearsW(lcd)}` : !pool.length ? "всё нужное уже в библиотеке" : !CL.clanOf(s) ? "нет рода" : "")];
  return { treasury: T, income: treasuryIncome(data, s), fort: fortified(s) ? sc.fortUntil - age : 0, grudge: sc.grudge || 0, war: sc.war ? Math.round(warWinChance(data, s) * 100) : null,
    groups: [{ name: "Казна", items: cash }, { name: "Война и мир", items: war }, { name: "Устав", items: rules }, { name: "Ученики и кадры", items: staff }, { name: "Род", items: clan }].filter(g => g.items.length) };
}
function allyChance(data, s) { const H = HP(data), sc = s.life.sect; return clamp((H.allyBase ?? 0.4) + ((sc.standing ?? 50) - 50) / 200 - (sfx(data, s, sectDef(data, s), "hazardMul", 1) > 1.1 ? 0.25 : 0), 0.1, 0.9); }
export function headAction(data, s, act, arg = null, rng = Math.random) {
  const sc = s.life?.sect; if (!isHead(s)) return { ok: false, msg: "Печать не у тебя." };
  const H = HP(data), age = s.life.age, sd = sectDef(data, s), R = ranks(data);
  const P = headPanel(data, s), item = P.groups.flatMap(g => g.items).find(x => x.act === act && (x.arg == null || String(x.arg) === String(arg)));
  if (!item) return { ok: false, msg: "Сейчас это не сделать." };
  if (!item.ok) return { ok: false, msg: item.why || "Сейчас это не сделать." };
  const pay = c => { sc.treasury = Math.max(0, (sc.treasury ?? 0) - c); };
  const say = (m, k = "sect") => { F.famNote(data, s, null, m, "sect", k); return { ok: true, msg: m }; };
  const dis = aliveDis(sc);
  switch (act) {
    case "pills": pay(H.pillCost ?? 30); for (const d of dis) d.talent = capT(data, (d.talent || 1) + (H.pillTalent ?? 0.05)); stand(s, H.pillStanding ?? 2);
      return say(`Казна секты выдала ученикам пилюли Очищения костей. ${dis.length === 1 ? "Ученик кланялся" : "Ученики кланялись"} до земли.`);
    case "fortify": pay(H.fortifyCost ?? 80); sc.fortUntil = age + (H.fortifyYears ?? 6);
      return say(`Ворота ${sd.name} обшили железом, на стенах вырезали печати. На ${L.yearsW(H.fortifyYears ?? 6)} — спокойнее.`);
    case "recruit": { pay(H.recruitCost ?? 60); const d = newDisciple(data, s, rng); (sc.disciples ??= []).push(d);
      return say(`Ты взял(а) в личные ученики ${d.name}. Дар — ${talentWord(d.talent)}.`); }
    case "take": { const amt = Math.floor((sc.treasury ?? 0) * (H.takeShare ?? 0.5)); pay(amt); s.spiritStones += amt; stand(s, H.takeStanding ?? -12); sc.grudge = (sc.grudge || 0) + 1;
      return say(`Ты взял(а) из казны секты ${L.stonesW(amt)}. Казначей записал это в книгу — мелко, но записал.`); }
    case "war": { const foe = G.sectById(data, arg); pay(H.declareCost ?? 50); startWar(data, s, foe, rng, true); return { ok: true, msg: "" }; }
    case "truce": { const foe = G.sectById(data, sc.war.with); pay(H.truceCost ?? 40); stand(s, sc.war.declared ? H.declaredTruceStanding ?? -6 : H.truceStanding ?? -3); sc.war = null;
      return say(`Ты отправил(а) послов к ${foe?.name}. Мир без победы: живые вернулись, перевал остался ничьим.`); }
    case "ally": { const x = G.sectById(data, arg); pay(H.allyCost ?? 60); sc.allyAt = age;
      if (rng() < allyChance(data, s)) { addAlly(data, s, x); return { ok: true, msg: "" }; }
      stand(s, -2); return say(`${x.name} приняли дары и вежливо отказали: «Время для союза ещё не пришло».`); }
    case "soften": { const ov = sc.ruleOverrides ??= { off: [], add: [] }; ov.off.push(arg); sc.ruleAt = age; stand(s, H.softenStanding ?? -8);
      if (arg === "noMarriage") sc.lay = false;
      return say(`Ты переписал(а) устав: «${ruleName(data, arg)}» больше не действует. Старые старейшины молча вышли из зала.`); }
    case "tighten": { const ov = sc.ruleOverrides ??= { off: [], add: [] }; ov.add.push(arg); sc.ruleAt = age; stand(s, H.tightenStanding ?? -3);
      return say(`В устав ${sd.name} вписано новое правило: «${ruleName(data, arg)}». Молодые ворчат, казначей доволен.`); }
    case "admit": { const x = headKin(data, s)[+arg]; x.node.sect = sc.id; stand(s, H.admitStanding ?? -2);
      F.famNote(data, s, x.node, `По слову главы ${L.kinWord(x.node, x.role)} ${x.node.name} принят${x.node.gender === "f" ? "а" : ""} в ${sd.name} без испытания.`, "sect"); return { ok: true, msg: "" }; }
    case "promote": { const d = dis[+arg]; pay(H.promoteCost ?? 40); d.rank = (d.rank ?? 2) + 1;
      const best = dis.every(x => (x.talent || 0) <= (d.talent || 0)); stand(s, best ? 2 : -2);
      return say(`${d.name} теперь ${R[d.rank].name}.${best ? " Совет кивнул: самый одарённый." : " Совет поморщился: любимчик."}`); }
    case "teach": { const d = dis[+arg], tech = G.slottedTechs(data, s).neigong; d.taught = true; d.talent = capT(data, (d.talent || 1) + (H.teachTalent ?? 0.15)); stand(s, H.teachStanding ?? 2);
      s.qi = Math.max(0, (s.qi || 0) - (H.teachQiPct ?? 0.2) * G.qiRequired(data, s));
      return say(`Ты передал(а) ${d.name} ${tech ? `«${tech.name}»` : "своё дыхание"} — из ладони в ладонь, как когда-то учили тебя.`); }
    case "expel": { const p = rivalsOf(sc)[+arg]; sc.expelAt = age; p.alive = false; p.expelled = true; s.life.stats.karma = clamp(s.life.stats.karma - 1, -20, 20);
      if (rng() < (H.splitChance ?? 0.35) + (p.rank >= 5 ? H.splitHighRival ?? 0.15 : 0)) {
        const loss = Math.floor((sc.treasury ?? 0) * (H.splitTreasury ?? 0.25)); pay(loss); stand(s, H.splitStanding ?? -10);
        const gone = dis.length > 1 && rng() < 0.5 ? dis[Math.floor(rng() * dis.length)] : null; if (gone) gone.alive = false;
        return say(`Раскол: ${p.name} ушёл(ла) в горы с полусотней учеников${gone ? ` и твоим учеником ${gone.name}` : ""}, унося ${L.stonesW(loss)} из казны.`.replace("ушёл(ла)", p.gender === "f" ? "ушла" : "ушёл"));
      }
      stand(s, H.expelStanding ?? 3); return say(`${p.name} изгнан${p.gender === "f" ? "а" : ""} из совета и из секты. Остальные старейшины теперь говорят тише.`); }
    case "library": { const pool = libPool(data, s), tc = pick(pool, rng); (s.familyTechs ??= []).push(tc.id); sc.libAt = age;
      const caught = rng() < (H.libraryRisk ?? 0.3); if (caught) { stand(s, H.libraryStanding ?? -12); sc.grudge = (sc.grudge || 0) + 1; }
      return say(`Ночью ты переписал(а) «${tc.name}» для родовой библиотеки.${caught ? " Смотритель видел свет в окне — к утру знал весь совет." : " Никто не видел."}`, "clan"); }
  }
  return { ok: false, msg: "Нет такого действия." };
}
// Авторежим правит просто: стены в войну, мир, если положение шатается, ученики до трёх, иногда пилюли и свиток роду. Казну себе не берёт.
function autoHead(data, s, rng) {
  const sc = s.life.sect, H = HP(data), T = () => sc.treasury ?? 0;
  if (sc.war && !fortified(s) && T() >= (H.fortifyCost ?? 80)) headAction(data, s, "fortify", null, rng);
  if (sc.war && (sc.standing ?? 50) < 35 && T() >= (H.truceCost ?? 40)) headAction(data, s, "truce", null, rng);
  if (aliveDis(sc).length < 3 && T() >= (H.recruitCost ?? 60)) headAction(data, s, "recruit", null, rng);
  if (T() >= 3 * (H.pillCost ?? 30) && aliveDis(sc).length && rng() < 0.25) headAction(data, s, "pills", null, rng);
  if ((sc.standing ?? 50) >= 55 && rng() < 0.3) { const it = headPanel(data, s)?.groups.flatMap(g => g.items).find(x => x.act === "library"); if (it?.ok) headAction(data, s, "library", null, rng); }
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
  if (r.sectGrudgeMin != null && !((sc?.grudge || 0) >= r.sectGrudgeMin)) return false;
  if (r.sectTreasuryMin != null && !((sc?.treasury ?? 0) >= r.sectTreasuryMin)) return false;
  if (r.sectNoWar && sc?.war) return false;
  if (r.sectEnemyAny && !(sc && sectEnemies(data, s).length)) return false;
  if (r.hasDisciple && !aliveDis(sc).length) return false;
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
  if (ef.sectHeir && !sc.heirApparent && !sc.head?.self && sc.rank >= (SUCC(data).heirMinRank ?? 3)) { sc.headHeir = null; sc.heirApparent = true; F.famNote(data, s, null, `Глава ${sc.head?.name || ""} назвал(а) тебя преемником.`.replace("назвал(а)", sc.head?.gender === "f" ? "назвала" : "назвал"), "rank", "sect"); }
  if (ef.sectHeirLost && sc.heirApparent) { sc.heirApparent = false; L.logLine(s, "Совет больше не зовёт тебя преемником.", "sect"); }
  if (ef.sectYield && sc.seatFor === topRank(data)) { appointOther(data, s, rng, "Ты уступил(а) печать."); return; }
  if (isHead(s)) {
    if (ef.sectTreasury) sc.treasury = Math.max(0, (sc.treasury ?? 0) + ef.sectTreasury);
    if (ef.sectFortify) sc.fortUntil = L0.age + (HP(data).fortifyYears ?? 6);
    if (ef.sectDeclareWar && !sc.war) { const en = sectEnemies(data, s); if (en.length) startWar(data, s, G.sectById(data, pick(en, rng)), rng, true); }
    if (ef.sectAlly) { const c = allyCandidates(data, s); if (c.length) addAlly(data, s, pick(c, rng)); }
    if (ef.discipleNew) { const d = newDisciple(data, s, rng, ef.discipleNew === "genius"); (sc.disciples ??= []).push(d); L.logLine(s, `${d.name} — ${d.gender === "f" ? "твоя новая ученица" : "твой новый ученик"}. Дар — ${talentWord(d.talent)}.`, "sect"); }
    if (ef.discipleTrain) for (const d of aliveDis(sc)) d.talent = capT(data, (d.talent || 1) + 0.08);
    if (ef.discipleLoss) { const ds = aliveDis(sc); if (ds.length) { const d = pick(ds, rng); d.alive = false; L.logLine(s, `${d.gender === "f" ? "Ученица" : "Ученик"} ${d.name} не вернул${d.gender === "f" ? "ась" : "ся"}.`, "sect"); } }
    if (ef.sectGrudge) sc.grudge = Math.max(0, (sc.grudge || 0) + ef.sectGrudge);
    if (ef.sectGrudgeClear) sc.grudge = 0;
  }
  if (ef.sectTruce && sc.war) { const foe = G.sectById(data, sc.war.with); sc.war = null; L.logLine(s, `С ${foe?.name} заключён мир.`, "sect"); }
  if (ef.sectTrial) doTrial(data, s, rng);
  if (ef.sectWait) sc.lastTrial = L0.age - (cfg(data).trial?.gapYears ?? 3) + 1;
}
export function vars(data, s) {
  const sc = s.life?.sect, sd = sectDef(data, s), m = sc?.master;
  const mw = m ? `${m.title} ${given(m.name)}` : "наставник";
  return { sect: sd?.name || "секта", master: mw, Master: mw[0].toUpperCase() + mw.slice(1), peerRival: rival(sc)?.name || "соперник", peerFriend: friend(sc)?.name || "друг", sectEnemy: G.sectById(data, sc?.war?.with)?.name || "враги", sectHead: sc?.head && !sc.head.self ? sc.head.name : "глава", peerRivalHigh: highRival(sc)?.name || "соперник",
    sectFoe: G.sectById(data, sc?.war?.with || (sc ? sectEnemies(data, s)[0] : null))?.name || "враждебной секты", disciple: aliveDis(sc).sort((a, b) => (b.talent || 0) - (a.talent || 0))[0]?.name || "ученик" };
}
