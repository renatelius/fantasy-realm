// Проверка авторежима: N жизней с авто и без, разбивка по трём путям. Запуск из папки проекта:
//   node tools/check-auto.mjs [N]
import fs from "node:fs";
import { newState } from "../src/state.js";
import * as G from "../src/game.js";
import * as L from "../src/life.js";
import * as A from "../src/auto.js";

const names = ["realms", "techniques", "enemies", "world", "events", "chronicle", "jobs", "jokes"];
const data = Object.fromEntries(names.map(n => [n, JSON.parse(fs.readFileSync(new URL(`../data/${n}.json`, import.meta.url), "utf8"))]));
L.setYearHook((d, s, r) => A.autoYear(d, s, r));
const N = +process.argv[2] || 200;

function run(auto) {
  const res = [];
  for (let k = 0; k < N; k++) {
    const s = newState();
    s.settings.autoPlay = auto; s.settings.auto = auto ? "best" : "off"; s.settings.speed = "x16";
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
    byPath[p.name] = { жизней: a.length, ступени: [0, 1, 2, 3, 4].map(i => a.filter(r => r.r === i).length), возраст: avg(a, r => r.age), в_бою: a.filter(r => r.battle).length };
  }
  return { итог: { жизней: N, средний_возраст: avg(res, r => r.age), прорывов: avg(res.filter(r => r.aw), r => r.br), с_супругом: res.filter(r => r.spouse).length, детей: avg(res, r => r.kids) }, пути: byPath };
}
for (const [name, auto] of [["АВТО", true], ["БЕЗ ", false]]) {
  const r = run(auto);
  console.log(name, JSON.stringify(r.итог));
  for (const [p, v] of Object.entries(r.пути)) console.log("   ", p.padEnd(10), JSON.stringify(v));
}
