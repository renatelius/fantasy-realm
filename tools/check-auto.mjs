// Проверка авторежима: N жизней с авто и без. Запуск из папки проекта:
//   node tools/check-auto.mjs [N]
import fs from "node:fs";
import { newState } from "../src/state.js";
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
    res.push({ age: s.life.age, aw: s.life.awakened, r: s.realmIndex, br: s.life.chronicle.filter(x => x.kind === "break").length, kids: s.life.children.length, spouse: !!s.life.spouse });
  }
  const aw = res.filter(r => r.aw), avg = (a, f) => (a.reduce((t, x) => t + f(x), 0) / Math.max(1, a.length)).toFixed(1);
  return { жизней: N, средний_возраст: avg(res, r => r.age), пробудились: aw.length, ступени: [0, 1, 2].map(i => aw.filter(r => r.r === i).length), прорывов: avg(aw, r => r.br), с_супругом: res.filter(r => r.spouse).length, детей: avg(res, r => r.kids) };
}
console.log("АВТО ", JSON.stringify(run(true)));
console.log("БЕЗ  ", JSON.stringify(run(false)));
