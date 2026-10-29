// Авторежим: персонаж сам делает всё самое выгодное для себя.
// Вызывается после каждого прожитого года (хук из life.js) и раз в тик интерфейса.
// Порядок года:
//   1) ремесло — самое доходное из доступных;   2) дети ≥ 6 лет — «помощь» (камни);
//   3) фокус — до пробуждения «семья» (меньше риск), после — «гунфу», но «семья», если есть супруг и детей < 2;
//      в секте — «служба секте», когда до ранга не хватает только заслуг; казна рода покупает свиток, если хватает с запасом;
//   4) техники — в каждый слот лучшая ДОСТУПНАЯ (рынок, род, секта по рангу, найденные), с запасом камней на пилюлю;
//   5) прорывы — пока хватает ци: пилюля, если она даёт ≥ +8% или шанс < 60%; до 12 попыток за вызов;
//      порог легенды — только на закате жизни (с oldAgeStart − 3% срока) и с пилюлей;
//   6) приключение — если шанс победы ≥ 55% (поражение ранит и может убить; враги бьют техниками).
//   0) путь — ступор (до слоя > autoOutYears лет или порог легенды до заката) → открытый путь, где слой
//      наберётся быстрее всего (хотя бы вдвое быстрее). Застрял и там — снова к самому быстрому. На закате — к порогу легенды.
//      Пока проигрываем (< 70%), техники приёмы/закал тела/скрытое оружие покупаются первыми и без запаса на пилюлю.
import * as G from "./game.js";
import * as C from "./combat.js";
import * as L from "./life.js";
import * as S from "./sect.js";
import * as CL from "./clan.js";
import * as CR from "./craft.js";

const TYPE_VALUE = {
  neigong: t => (t.qiMultiplier || 1) * 10,
  body: t => (t.hpMult || 1) * 4 + (t.defMult || 1) * 3 + (t.atkMult || 1) * 2,
  martial: t => (t.atkMult || 1) * 5 + (t.defMult || 1) * 2 + (t.critAdd || 0) * 20,
  qinggong: t => (t.critAdd || 0) * 30 + (t.hazardCut || 0) * 20 + 1,
  yishu: t => (t.hazardCut || 0) * 40 + (1 - (t.pillMul || 1)) * 20 + 1,
  anqi: t => (t.atkMult || 1) * 4 + (t.critAdd || 0) * 20,
};

function power(st) { return st.hp * 0.25 + st.atk * 3 + st.def * 2; }

// Склонность к делу: талант с чжуачжоу, родной край, ремесло родителей. Не одна «лучшая» работа на всех,
// а любая из близких к лучшей (в пределах 20% ценности) — выбор постоянный для этой жизни (по имени).
const hashStr = t => { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// Насколько опасность работы бьёт по этой жизни: культиватор на высокой ступени переживает то, что убьёт простого.
function hazardWeight(data, s) {
  const l = s.life, wl = data.world.life;
  return l.awakened ? (wl.awakenedHazardMult ?? 0.4) * Math.pow(wl.realmHazardDecay ?? 0.7, G.maxTier(data, s)) : 1;
}
// Есть ли ступень выше в этом деле (карьерная лестница) — работа с перспективой ценится чуть выше.
const hasLadder = (data, j) => data.jobs.jobs.some(x => x.need?.from?.jobs.includes(j.id));
function jobValue(data, s, j) {
  const l = s.life, train = l.craft?.appr?.skill || null;
  const parents = [l.household?.father?.job, l.household?.mother?.job].filter(Boolean);
  return j.stones * CR.payMulFor(data, s, j) - j.hazard * CR.hazMul(data, s, j.id) * 2000 * hazardWeight(data, s)
    + (hasLadder(data, j) && CR.jobXp(s, j.id) < 45 ? 1.5 : 0)     // перспектива: дорасти до старшего
    + (l.awakened ? ((j.qiMul || 1) - 1) * 30 : 0)            // на Пути +10% ци ≈ 3 камня в год
    + (train && data.crafts?.jobSkill?.[j.id]?.[train] ? 1 : 0)  // работа качает навык, которому учимся
    + (data.crafts?.talentJobs?.[l.talentId]?.includes(j.id) ? 2 : 0)        // к чему тянуло с детства
    + (j.region ? 1 : 0)                                          // местное ремесло: в родном краю знают
    + (parents.includes(j.name) ? 1.5 : 0)                        // ремесло родителей
    + CR.perkValue(j.perk, l.awakened) * 0.6;                     // польза кроме камней: связи, лад, находки, бой
}
function pickJob(data, s) {
  const l = s.life;
  if (l.age < (data.jobs.workAge || 12)) return; // в младенчестве «работу» не выбирают
  // Куда не возьмут (шанс < 25%) или уже отказали в этом году — туда не идём; ценность × шанс найма.
  const jobs = data.jobs.jobs.filter(j => L.jobEligible(data, s, j, "self") && (j.id === l.jobId || (!CR.refusedNow(s, j.id) && CR.hireChance(data, s, j) >= 0.25)));
  if (!jobs.length) return;
  const val = j => jobValue(data, s, j) * (j.id === l.jobId ? 1 : 0.5 + 0.5 * CR.hireChance(data, s, j));
  const top = Math.max(...jobs.map(val));
  const near = jobs.filter(j => val(j) >= top - Math.max(1, Math.abs(top) * 0.2)).sort((a, b) => a.id < b.id ? -1 : 1);
  const want = near[hashStr(l.name + (l.generation || 1)) % near.length];
  const cur = jobs.find(j => j.id === l.jobId);
  // Повышение в своём деле берут сразу, если оно не хуже нынешнего места.
  // (шанс на повышение — «место освободилось» — не отсекает: просятся каждый год, пока не возьмут)
  const promo = data.jobs.jobs.filter(j => j.need?.from?.jobs.includes(l.jobId) && L.jobEligible(data, s, j, "self") && !CR.refusedNow(s, j.id))
    .sort((a, b) => jobValue(data, s, b) - jobValue(data, s, a))[0];
  if (promo && cur && jobValue(data, s, promo) >= jobValue(data, s, cur)) { const r = L.setJob(data, s, promo.id, "self"); if (r.ok) { pickSpouseJob(data, s); return; } }
  // Опытное ремесло не бросают ради малой прибавки (мастерство, craft.js).
  if (want.id !== l.jobId && (!cur || val(want) > val(cur) * 1.15 + 0.5)) L.setJob(data, s, want.id, "self");
  pickSpouseJob(data, s);
}
// Супруг: своя склонность (талант, если есть, и имя — вместо «самого доходного для всех»), опыт держит на месте.
function pickSpouseJob(data, s) {
  const l = s.life, sp = l.spouse; if (!sp) return;
  const sj = data.jobs.jobs.filter(j => j.id !== "home" && L.jobEligible(data, s, j, "spouse"));
  if (!sj.length) return;
  const val = j => j.stones * CR.spouseRankPay(data, s, j.id) - j.hazard * 2000 + (data.crafts?.talentJobs?.[sp.talentId]?.includes(j.id) ? 2 : 0) + CR.perkValue(j.perk, false) * 0.4;
  const top = Math.max(...sj.map(val));
  const near = sj.filter(j => val(j) >= top - Math.max(1.5, Math.abs(top) * 0.3)).sort((a, b) => a.id < b.id ? -1 : 1);
  const want = near[hashStr(sp.name) % near.length], cur = sj.find(j => j.id === sp.jobId);
  if (want.id !== sp.jobId && (!cur || val(want) > val(cur) * 1.15 + 0.5)) L.setJob(data, s, want.id, "spouse");
}

function pickFocus(data, s) {
  const l = s.life;
  let want = "family";
  if (l.awakened) {
    const kids = l.children.filter(c => c.alive).length;
    want = l.spouse && kids < 2 && l.age <= 45 ? "family" : "practice";
    // В секте: служить, когда до следующего ранга не хватает только заслуг (sect.js → serviceWanted).
    if (want === "practice" && S.serviceWanted(data, s)) want = "sect";
    if (l.age >= 0.92 * L.lifespan(data, s)) want = "rest";
  } else if (l.age >= (data.jobs.workAge || 12)) want = "work";
  if (l.focusId !== want) L.setFocus(data, s, want);
}

function pickChildren(data, s) {
  // Старший живой ребёнок — в мастерскую, если родителю есть чему учить; остальные помогают по дому.
  const l = s.life, teach = l.jobId && l.jobId !== "home" && CR.jobXp(s, l.jobId) >= 20;
  const eldest = l.children.findIndex(c => c.alive && L.childAge(s, c) >= 6);
  l.children.forEach((c, i) => {
    if (!c.alive || L.childAge(s, c) < 6) return;
    const want = teach && i === eldest ? "workshop" : l.biz ? "biz" : "help";
    if (c.task !== want) L.setChildTask(data, s, i, want);
  });
}

// Шанс победы кэшируется по ступени, слою, слотам и телу (оценка — 36 пробных боёв).
let oddsKey = "", oddsWin = 1;
function winChance(data, s) {
  const k = [s.pathId, s.realmIndex, s.layer, JSON.stringify(s.techniqueSlots), s.life?.physiqueId].join("|");
  if (k !== oddsKey) { oddsKey = k; oddsWin = C.adventureOdds(data, s, 12).win; }
  return oddsWin;
}
const COMBAT_FIRST = ["martial", "body", "anqi", "neigong", "qinggong", "yishu"];
function pickTechniques(data, s, say) {
  // Враги бьют техниками: если проигрываем — сначала приёмы/закал тела/скрытое оружие и без запаса на пилюлю.
  const losing = winChance(data, s) < 0.7;
  const reserve = losing ? 0 : G.pillPrice(data, s);
  const order = losing ? COMBAT_FIRST.map(id => data.techniques.types.find(t => t.id === id)).filter(Boolean) : data.techniques.types;
  for (const type of order) {
    if (type.id === "neigong" && s.pathId === "body") continue; // телу внутренняя работа не помогает копить закалку
    const cur = G.slottedTechs(data, s)[type.id];
    // Ценность с учётом пути: внутренняя работа — по реальной силе на этом пути и прорыву; закал тела на пути тела — ещё и закалка.
    const base = TYPE_VALUE[type.id] || (() => 0);
    const val = type.id === "neigong" ? (t => G.neigongMult(data, s, t) * 10 + (t.path ? (t.breakAdd || 0) * 50 : 0))
      : type.id === "body" && s.pathId === "body" ? (t => base(t) + G.bodyForgeMult(data, s, t) * 8) : base;
    const curV = cur ? val(cur) : -1;
    const cands = data.techniques.techniques
      .filter(t => t.type === type.id && G.techUsable(data, s, t) && (t.minRealm || 0) <= G.tierOf(data, s) && val(t) > curV + 1e-9)
      .filter(t => G.techAccess(data, s, t).ok)
      .filter(t => s.ownedTechniques.includes(t.id) || s.spiritStones - G.techCost(data, s, t) >= reserve
        || (G.techAccess(data, s, t).src === "sect" && (s.life.sect?.contrib || 0) >= S.contribCost(data, s, t)))
      .sort((a, b) => val(b) - val(a));
    if (!cands.length) continue;
    const t = cands[0];
    const r = G.learnTechnique(data, s, t.id);
    if (r.ok) say(`Освоено: «${t.name}» (${type.name.toLowerCase()}).`);
  }
}

// Несколько путей: застрял — развивай другой (слои других путей дают бонус к прорыву всех).
function sunset(data, s) { return s.life.age >= ((data.world.life.oldAgeStart ?? 0.88) - 0.03) * L.lifespan(data, s); }
// Лет до следующего слоя: медитация + ци за победы (авто ходит в бой при шансе ≥ 55%).
function yearsToNext(data, p, win) {
  const T = data.world.time, cfg = data.enemies.adventure, need = G.qiRequired(data, p);
  const adv = win >= 0.55 ? (T.yearSeconds / cfg.cooldownSec) * win * (cfg.qiRewardShare || 0) * need * (G.realmsOf(data, p)[p.realmIndex]?.qiRewardMul ?? 1) * G.pathSpeedMul(data, p) : 0;
  const rate = G.qiPerSecond(data, p) * T.yearSeconds + adv;
  return rate > 0 ? Math.max(0, need - p.qi) / rate : Infinity;
}
// Ступор: если на текущем пути до следующего слоя дольше autoOutYears лет (или порог легенды до заката) —
// переходим на открытый путь, где слой наберётся быстрее всего (медитация + ци за победы), если там хотя бы
// вдвое быстрее. Временное замедление после смены в оценку не входит — иначе авто металось бы туда-обратно.
// На закате — к порогу легенды сильнейшим путём. Цена смены — game.js → pathSpeedMul.
function pickPath(data, s, say) {
  if (s.settings.autoPaths === false || G.pathSwitchWait(data, s)) return;
  const ids = G.openPaths(data, s), cur = s.pathId || "qi";
  if (ids.length < 2) return;
  const cp = data.realms.crossPath || {}, outY = cp.autoOutYears ?? 3, faster = cp.autoFaster ?? 0.5;
  const probes = ids.map(id => ({ id, p: { ...G.pathProbe(data, s, id), pathSlowUntil: null } }));
  const winOf = x => x.id === cur ? winChance(data, s) : (x.win ??= C.adventureOdds(data, x.p, 6).win);
  const yrs = x => x.y ??= G.legendGate(data, x.p) ? (G.gateWaitYears(data, x.p) || !sunset(data, s) ? Infinity : 0) : yearsToNext(data, x.p, winOf(x));
  const lvl = x => G.levelOf(data, x.id, x.p);
  const main = probes.reduce((a, b) => lvl(b) > lvl(a) ? b : a), here = probes.find(x => x.id === cur);
  let target = null;
  if (sunset(data, s)) {
    if (cur !== main.id && G.legendGate(data, main.p) && !G.gateWaitYears(data, main.p)) target = main.id;
  } else if (yrs(here) > outY) {
    const best = probes.filter(x => x.id !== cur && yrs(x) < yrs(here) * faster).sort((a, b) => yrs(a) - yrs(b))[0];
    if (best) target = best.id;
  }
  if (!target || target === cur) return;
  const was = G.pathOf(data, s).name, r = G.switchPath(data, s, target);
  if (r.ok) say(sunset(data, s) ? `На закате — к порогу легенды. ${r.msg}` : `${was} упёрся в стену. ${r.msg}`, "awaken");
}

function doBreakthroughs(data, s, say, rng) {
  for (let i = 0; i < 12 && G.canBreakthrough(data, s); i++) {
    const raw = G.breakthroughChance(data, s, false), withPill = G.breakthroughChance(data, s, true);
    // Порог легенды: только на закате (с oldAgeStart − 3% срока, сейчас 75% — терять нечего), с пилюлей и шансом ≥ 4%.
    if (G.legendGate(data, s) && (s.life.age < ((data.world.life.oldAgeStart ?? 0.88) - 0.03) * L.lifespan(data, s) || withPill < 0.04 || (s.pills < 1 && s.spiritStones < G.pillPrice(data, s)))) break;
    const wantPill = withPill - raw >= 0.08 || raw < 0.6 || G.legendGate(data, s);
    if (wantPill && s.pills < 1 && !S.sectPill(data, s)) G.buyPill(data, s); // сначала пилюля за вклад
    const use = wantPill && s.pills >= 1;
    const before = `${G.realmsOf(data, s)[s.realmIndex].name} ${s.layer}`;
    const r = G.breakthrough(data, s, use, rng);
    say(r.ok ? `Автопрорыв${use ? " с пилюлей" : ""}: ${before} → ${G.realmsOf(data, s)[s.realmIndex].name}, слой ${s.layer}.` : `${use ? "Даже с пилюлей не вышло. " : ""}${r.msg}`, r.ok ? "break" : "cult");
    if (r.fatal) { say(r.msg, "death"); break; }
    if (!r.ok) break;
  }
  if (!G.canBreakthrough(data, s) && s.pills < 1 && s.spiritStones >= G.pillPrice(data, s) * 2) G.buyPill(data, s);
}

function doAdventure(data, s, say, rng) {
  if (!C.adventureReady(s, s.clockMs)) return;
  // Приключения опасны (рана, шанс гибели), враги с техниками. Авто идёт, когда победа вероятнее 55%.
  if (winChance(data, s) < 0.55) return;
  const before = s.spiritStones;
  const r = C.adventure(data, s, s.clockMs, rng);
  // Победы копятся в итог года (иначе на ×16 летопись тонет в «Победа над волком»); поражения и смерть — сразу.
  if (r.win) { const y = (s.life.advYear ??= { w: 0, st: 0 }); y.w++; y.st += Math.max(0, s.spiritStones - before); if (r.scroll) say(`Удача в приключении: свиток «${r.scroll.name}».`, "luck"); }
  else say(r.msg, r.fatal ? "death" : "cult");
}
function flushAdventures(s, say) {
  const y = s.life?.advYear; if (!y?.w) return;
  say(`За год: ${y.w} ${y.w % 10 === 1 && y.w % 100 !== 11 ? "победа" : [2, 3, 4].includes(y.w % 10) && ![12, 13, 14].includes(y.w % 100) ? "победы" : "побед"} в приключениях, +${L.stonesW(y.st)}.`, "adv");
  s.life.advYear = null;
}

export function autoYear(data, s, rng = Math.random) {
  if (!s.settings.autoPlay) return;
  const l = s.life;
  if (!l?.alive || l.phase !== "play") return;
  const say = (m, k = "cult") => L.logLine(s, m, k);
  flushAdventures(s, say);
  pickJob(data, s); pickChildren(data, s); pickFocus(data, s);
  CL.autoClan(data, s, rng);
  CR.autoCraft(data, s, rng);
  if ((l.sect?.standing ?? 100) < 35) S.giveAlms(data, s);
  if (!l.awakened) return;
  pickPath(data, s, say);
  pickTechniques(data, s, say);
  doBreakthroughs(data, s, say, rng);
  doAdventure(data, s, say, rng);
}

// Между годами (на медленной скорости ци копится внутри года) — только прорывы и приключения.
export function autoTick(data, s, rng = Math.random) {
  if (!s.settings.autoPlay) return;
  const l = s.life;
  if (!l?.alive || l.phase !== "play" || l.pending || l.pendingRoot || l.pause || !l.awakened) return;
  const say = (m, k = "cult") => L.logLine(s, m, k);
  doBreakthroughs(data, s, say, rng);
  doAdventure(data, s, say, rng);
}
