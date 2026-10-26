// Авторежим: персонаж сам делает всё самое выгодное для себя.
// Вызывается после каждого прожитого года (хук из life.js) и раз в тик интерфейса.
// Порядок года:
//   1) ремесло — самое доходное из доступных;   2) дети ≥ 6 лет — «помощь» (камни);
//   3) фокус — до пробуждения «семья» (меньше риск), после — «гунфу», но «семья», если есть супруг и детей < 2;
//   4) техники — в каждый слот лучшая доступная по ценности, с запасом камней на пилюлю;
//   5) прорывы — пока хватает ци: пилюля, если она даёт ≥ +8% или шанс < 60%; до 12 попыток за вызов;
//   6) приключение — если готово и победа вероятна (сравнение боевой силы ≥ 1.1).
import * as G from "./game.js";
import * as C from "./combat.js";
import * as L from "./life.js";

const TYPE_VALUE = {
  neigong: t => (t.qiMultiplier || 1) * 10,
  body: t => (t.hpMult || 1) * 4 + (t.defMult || 1) * 3 + (t.atkMult || 1) * 2,
  martial: t => (t.atkMult || 1) * 5 + (t.defMult || 1) * 2 + (t.critAdd || 0) * 20,
  qinggong: t => (t.critAdd || 0) * 30 + (t.hazardCut || 0) * 20 + 1,
  yishu: t => (t.hazardCut || 0) * 40 + (1 - (t.pillMul || 1)) * 20 + 1,
  anqi: t => (t.atkMult || 1) * 4 + (t.critAdd || 0) * 20,
};

function power(st) { return st.hp * 0.25 + st.atk * 3 + st.def * 2; }

function pickJob(data, s) {
  const jobs = data.jobs.jobs.filter(j => L.jobEligible(data, s, j, "self"));
  if (!jobs.length) return;
  const best = jobs.reduce((a, b) => (b.stones - b.hazard * 2000 > a.stones - a.hazard * 2000 ? b : a));
  if (best.id !== s.life.jobId) L.setJob(data, s, best.id, "self");
  if (s.life.spouse) {
    const sj = data.jobs.jobs.filter(j => L.jobEligible(data, s, j, "spouse"));
    const b2 = sj.reduce((a, b) => (b.stones > a.stones ? b : a), sj[0]);
    if (b2 && b2.id !== s.life.spouse.jobId) L.setJob(data, s, b2.id, "spouse");
  }
}

function pickFocus(data, s) {
  const l = s.life;
  let want = "family";
  if (l.awakened) {
    const kids = l.children.filter(c => c.alive).length;
    want = l.spouse && kids < 2 && l.age <= 45 ? "family" : "practice";
    if (l.age >= 0.92 * L.lifespan(data, s)) want = "rest";
  } else if (l.age >= (data.jobs.workAge || 12)) want = "work";
  if (l.focusId !== want) L.setFocus(data, s, want);
}

function pickChildren(data, s) {
  s.life.children.forEach((c, i) => {
    if (c.alive && L.childAge(s, c) >= 6 && c.task !== "help") L.setChildTask(data, s, i, "help");
  });
}

function pickTechniques(data, s, say) {
  const reserve = G.pillPrice(data, s);
  for (const type of data.techniques.types) {
    const cur = G.slottedTechs(data, s)[type.id];
    const val = TYPE_VALUE[type.id] || (() => 0);
    const curV = cur ? val(cur) : -1;
    const cands = data.techniques.techniques
      .filter(t => t.type === type.id && (t.minRealm || 0) <= s.realmIndex && val(t) > curV + 1e-9)
      .filter(t => s.ownedTechniques.includes(t.id) || s.spiritStones - G.techCost(data, s, t) >= reserve)
      .sort((a, b) => val(b) - val(a));
    if (!cands.length) continue;
    const t = cands[0];
    const r = G.learnTechnique(data, s, t.id);
    if (r.ok) say(`Освоено: «${t.name}» (${type.han}).`);
  }
}

function doBreakthroughs(data, s, say, rng) {
  for (let i = 0; i < 12 && G.canBreakthrough(data, s); i++) {
    const raw = G.breakthroughChance(data, s, false), withPill = G.breakthroughChance(data, s, true);
    const wantPill = withPill - raw >= 0.08 || raw < 0.6;
    if (wantPill && s.pills < 1) G.buyPill(data, s);
    const use = wantPill && s.pills >= 1;
    const before = `${data.realms.realms[s.realmIndex].name} ${s.layer}`;
    const r = G.breakthrough(data, s, use, rng);
    say(r.ok ? `Автопрорыв${use ? " с пилюлей" : ""}: ${before} → ${data.realms.realms[s.realmIndex].name}, слой ${s.layer}.` : `Прорыв сорвался${use ? " даже с пилюлей" : ""}: ци рассеялась.`, r.ok ? "break" : "cult");
    if (!r.ok) break;
  }
  if (!G.canBreakthrough(data, s) && s.pills < 1 && s.spiritStones >= G.pillPrice(data, s) * 2) G.buyPill(data, s);
}

function doAdventure(data, s, say, rng) {
  if (!C.adventureReady(s, s.clockMs)) return;
  const P = power(C.playerStats(data, s));
  const avg = data.enemies.enemies.reduce((t, e) => t + power(C.enemyStats(data, s, e)), 0) / data.enemies.enemies.length;
  if (P < avg * 1.1) return;
  const r = C.adventure(data, s, s.clockMs, rng);
  say(r.msg, r.win ? "adv" : "cult");
}

export function autoYear(data, s, rng = Math.random) {
  if (!s.settings.autoPlay) return;
  const l = s.life;
  if (!l?.alive || l.phase !== "play") return;
  const say = (m, k = "cult") => L.logLine(s, m, k);
  pickJob(data, s); pickChildren(data, s); pickFocus(data, s);
  if (!l.awakened) return;
  pickTechniques(data, s, say);
  doBreakthroughs(data, s, say, rng);
  doAdventure(data, s, say, rng);
}

// Между годами (на медленной скорости ци копится внутри года) — только прорывы и приключения.
export function autoTick(data, s, rng = Math.random) {
  if (!s.settings.autoPlay) return;
  const l = s.life;
  if (!l?.alive || l.phase !== "play" || l.pending || l.pendingRoot || !l.awakened) return;
  const say = (m, k = "cult") => L.logLine(s, m, k);
  doBreakthroughs(data, s, say, rng);
  doAdventure(data, s, say, rng);
}
