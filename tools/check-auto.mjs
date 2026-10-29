// Проверка авторежима: N жизней с авто и без, разбивка по трём путям. Запуск из папки проекта:
//   node tools/check-auto.mjs [N]
import fs from "node:fs";
import { newState } from "../src/state.js";
import * as G from "../src/game.js";
import * as L from "../src/life.js";
import * as A from "../src/auto.js";

const names = ["realms", "techniques", "enemies", "world", "events", "chronicle", "jobs", "jokes", "sects", "kin", "crafts"];
const data = Object.fromEntries(names.map(n => [n, JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`, import.meta.url), "utf8"))]));
L.setYearHook((d, s, r) => A.autoYear(d, s, r));
const N = +process.argv[2] || 200;

function run(auto) {
  const res = [];
  for (let k = 0; k < N; k++) {
    const s = newState();
    s.settings.autoPlay = auto; s.settings.auto = auto ? "best" : "off"; s.settings.speed = "x16"; s.settings.noPauses = true;
    L.startLife(data, s, "new"); s.life.phase = "play";
    let t = 0, g = 0;
    while (s.life.alive && g++ < 200000) {
      if (s.life.pendingRoot) L.finishRoot(data, s);
      if (s.life.pending) L.autoChoose(data, s, "best");
      t += 1000; L.lifeTick(data, s, t); A.autoTick(data, s);
    }
    res.push({ age: s.life.age, aw: s.life.awakened, path: s.pathId, r: s.realmIndex, br: s.life.chronicle.filter(x => x.kind === "break").length, kids: s.life.children.length, spouse: !!s.life.legacy?.spouseName, battle: /бою/.test(s.life.legacy?.cause || "") });
  }
  const avg = (a, f) => (a.reduce((t, x) => t + f(x), 0) / Math.max(1, a.length)).toFixed(1);
  const byPath = {};
  for (const p of data.realms.paths) {
    const a = res.filter(r => r.aw && r.path === p.id);
    byPath[p.name] = { жизней: a.length, ступени: p.realms.map((_, i) => i).map(i => a.filter(r => r.r === i).length), возраст: avg(a, r => r.age), в_бою: a.filter(r => r.battle).length };
  }
  return { итог: { жизней: N, средний_возраст: avg(res, r => r.age), прорывов: avg(res.filter(r => r.aw), r => r.br), с_супругом: res.filter(r => r.spouse).length, детей: avg(res, r => r.kids) }, пути: byPath };
}
for (const [name, auto] of [["АВТО", true], ["БЕЗ ", false]]) {
  const r = run(auto);
  console.log(name, JSON.stringify(r.итог));
  for (const [p, v] of Object.entries(r.пути)) console.log("   ", p.padEnd(10), JSON.stringify(v));
}

// Род: 40 семей × 4 поколения на авторежиме; наследник — старший живой ребёнок.
function lineage(F = 40, GEN = 4) {
  const rows = Array.from({ length: GEN }, () => ({ n: 0, lvl: 0, age0: 0, married: 0, kids: 0, lib: 0, sect: 0 }));
  for (let f = 0; f < F; f++) {
    const s = newState(); s.settings.autoPlay = true; s.settings.speed = "x16"; s.settings.noPauses = true;
    L.startLife(data, s, "new"); s.life.phase = "play";
    for (let g = 0; g < GEN; g++) {
      const r = rows[g]; r.n++; r.age0 += s.life.age; r.married += !!s.life.spouse; r.kids += s.life.children.length; r.lib += (s.familyTechs || []).length; r.sect += !!s.life.sect;
      let t = 0, k = 0;
      while (s.life.alive && k++ < 200000) { if (s.life.pendingRoot) L.finishRoot(data, s); if (s.life.phase === "path") s.life.phase = "play"; if (s.life.pending) L.autoChoose(data, s, "best"); t += 1000; L.lifeTick(data, s, t); A.autoTick(data, s); }
      r.lvl += s.life.awakened ? G.maxLevel(data, s) + 1 : 0;
      const kids = s.life.legacy?.children || [];
      if (!kids.length) break;
      const i = kids.reduce((b, c, j) => (c.age > kids[b].age ? j : b), 0);
      L.startLife(data, s, "heir", Math.random, i);
    }
  }
  return rows.map((r, g) => r.n ? { поколение: g + 1, семей: r.n, старт_возраст: (r.age0 / r.n).toFixed(0), слой_в_конце: (r.lvl / r.n).toFixed(1), в_браке_на_старте: r.married, детей_на_старте: (r.kids / r.n).toFixed(1), библиотека: (r.lib / r.n).toFixed(1), в_секте: r.sect } : null).filter(Boolean);
}
console.log(`РОД (поколение → средний итоговый слой, 1–${data.realms.paths[0].realms.reduce((n, r) => n + r.layers, 0)}):`);
for (const r of lineage()) console.log("   ", JSON.stringify(r));
