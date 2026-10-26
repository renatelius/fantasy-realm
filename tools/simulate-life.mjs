// Симулятор жизней: бот играет полные жизни (медитация, приключения, прорывы, случайный выбор в карточках).
// Запуск: node tools/simulate-life.mjs [жизней=400] [скорость=normal]
import fs from "fs";
import * as G from "../src/game.js";
import * as C from "../src/combat.js";
import * as L from "../src/life.js";
import { newState } from "../src/state.js";

const rd = n => JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`, import.meta.url)));
const data = Object.fromEntries(["realms", "techniques", "enemies", "world", "events", "chronicle", "jobs"].map(n => [n, rd(n)]));
const N = +process.argv[2] || 400, speed = process.argv[3] || "normal";
function rngFrom(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN;
const tally = () => ({});
const inc = (o, k) => (o[k] = (o[k] || 0) + 1);

function playLife(seed, mode, prevState, mercy = false) {
  const rng = rngFrom(seed), s = newState(); s.settings.speed = speed;
  if (prevState) s.lineage = prevState.lineage; else if (!mercy) s.lineage = [{}]; // без «защиты первой жизни»: измеряем обычную жизнь
  L.startLife(data, s, mode, rng, 0);
  s.life.phase = "play"; // рулетки рождения — интерфейс; в симуляции сразу играем
  let now = 0, events = 0;
  for (let sec = 1; sec < 6 * 3600 && s.life.alive; sec++) {
    now = sec * 1000;
    L.lifeTick(data, s, now, rng);
    if (s.life.pendingRoot) L.finishRoot(data, s, rng);
    if (s.life.pending) {
      const e = data.events.events.find(x => x.id === s.life.pending);
      const ok = e.choices.map((c, i) => i).filter(i => !e.choices[i].minStones || s.spiritStones >= e.choices[i].minStones);
      L.chooseOption(data, s, ok[Math.floor(rng() * ok.length)], rng); events++; continue;
    }
    if (!s.life.alive || !s.life.awakened) continue;
    if (C.adventureReady(s, s.clockMs)) C.adventure(data, s, s.clockMs, rng);
    if (!s.ownedTechniques.includes("jade_flow") && s.spiritStones >= 150) G.learnTechnique(data, s, "jade_flow");
    if (G.canBreakthrough(data, s)) {
      if (s.pills < 1 && s.spiritStones >= G.pillPrice(data, s)) G.buyPill(data, s);
      G.breakthrough(data, s, s.pills >= 1, rng);
    }
  }
  return { s, minutes: now / 60000, events };
}

// 1) распределение лотереи рождения
const rng0 = rngFrom(1), W = data.world, cnt = { region: tally(), era: tally(), wealth: tally(), root: tally() };
const B = 20000;
for (let i = 0; i < B; i++) { const b = L.rollBirth(data, rng0); inc(cnt.region, b.regionId); inc(cnt.era, b.eraId); inc(cnt.wealth, b.wealthId); inc(cnt.root, b.rootId); }
console.log(`Лотерея рождения (${B} бросков), доли:`);
for (const [k, o] of Object.entries(cnt)) console.log(`  ${k}: ` + Object.entries(o).map(([id, n]) => `${id} ${(n / B * 100).toFixed(1)}%`).join(", "));

// 2) полные жизни
const res = [], causes = tally(), reached = [0, 0, 0, 0, 0], diedChild = [], pathT = tally();
for (let i = 0; i < N; i++) {
  const { s, minutes, events } = playLife(100 + i, "new");
  const l = s.life; res.push({ age: l.age, minutes, events, awakened: l.awakened, realm: s.realmIndex, layer: s.layer, cause: l.legacy.cause, married: !!l.spouse || l.children.length > 0, kids: l.children.length, heirs: l.legacy.children.length });
  { const all = [...data.world.deathCauses.child, ...data.world.deathCauses.adult, "Дожил(а) отведённый срок", "Ушёл(ла) от старости", "Погиб(ла) в шторме", "Сорвался(лась) с горной тропы"];
    inc(causes, all.find(c => L.gtext(c, "m") === l.legacy.cause || L.gtext(c, "f") === l.legacy.cause) || l.legacy.cause); }
  if (l.awakened) { inc(pathT, s.pathId); for (let r = 0; r <= s.realmIndex; r++) reached[r]++; }
}
const aw = res.filter(r => r.awakened);
console.log(`\nЖизни (${N}, скорость ${speed}):`);
console.log(`  умерли до пробуждения (до 16 лет): ${((1 - aw.length / N) * 100).toFixed(1)}%`);
console.log(`  медианный возраст смерти: ${med(res.map(r => r.age))} (из пробудившихся: ${med(aw.map(r => r.age))})`);
console.log(`  медианная длительность жизни: ${med(res.map(r => r.minutes)).toFixed(1)} мин; пробудившихся: ${med(aw.map(r => r.minutes)).toFixed(1)} мин`);
console.log(`  медиана карточек за жизнь: ${med(res.map(r => r.events))}`);
console.log(`  достигли ступени (доля от всех жизней): ` + reached.map((n, i) => `ступень ${i + 1} ${(n / N * 100).toFixed(0)}%`).join(", "));
console.log("  пути пробудившихся: " + Object.entries(pathT).map(([k, n]) => `${k} ${(n / Math.max(1, aw.length) * 100).toFixed(0)}%`).join(", "));
console.log(`  медианный итоговый слой пробудившихся: ${med(aw.map(r => r.realm * 9 + r.layer))} (глобально, 1–27)`);
console.log(`  семья: женились/вышли замуж ${(aw.filter(r => r.married).length / Math.max(1, aw.length) * 100).toFixed(0)}% пробудившихся, медиана детей ${med(aw.map(r => r.kids))}, оставили живого наследника ${(aw.filter(r => r.heirs > 0).length / Math.max(1, aw.length) * 100).toFixed(0)}%`);
console.log("  причины смерти: " + Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${L.gtext(c, "m")} ${(n / N * 100).toFixed(0)}%`).join("; "));

// 3) цепочка наследников
const chain = [], base = newState();
let st = base; // первая жизнь рода идёт под защитой неба
for (let g = 0; g < 4; g++) { const r = playLife(500 + g, g === 0 ? "new" : "heir", g === 0 ? undefined : st, g === 0); st = r.s; chain.push(`${r.s.life.name}: ${r.s.life.age} лет, ${G.pathOf(data, r.s).name}: ${G.realmsOf(data, r.s)[r.s.realmIndex].name} ${r.s.layer}`); }
console.log("\nПример цепочки рода (4 поколения):\n  " + chain.join("\n  "));

// 4) наследник против новой судьбы: насколько сильно наследие меняет исход
const cmp = { heir: [], fresh: [] };
for (let i = 0; i < Math.min(N, 200); i++) {
  const par = playLife(2000 + i, "new");
  if (!par.s.life.awakened) continue;
  const h = playLife(3000 + i, "heir", par.s), f = playLife(3000 + i, "new");
  const lvl = r => r.s.life.awakened ? r.s.realmIndex * 9 + r.s.layer : 0;
  cmp.heir.push({ lvl: lvl(h), dead16: !h.s.life.awakened }); cmp.fresh.push({ lvl: lvl(f), dead16: !f.s.life.awakened });
}
const rep = (n, a) => `${n}: медианный слой ${med(a.map(x => x.lvl))}, умерли до 16 лет ${(a.filter(x => x.dead16).length / a.length * 100).toFixed(0)}% (n=${a.length})`;
console.log("\nНаследник vs новая судьба:\n  " + rep("наследник", cmp.heir) + "\n  " + rep("новая судьба", cmp.fresh));
