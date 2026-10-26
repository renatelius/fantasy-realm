// Симулятор баланса: бот медитирует, ходит в приключения, покупает пилюли и технику, прорывается.
// Запуск: node tools/simulate.mjs [часы=3] [запусков=200]
import fs from "fs";
import * as G from "../src/game.js";
import * as C from "../src/combat.js";
import { newState } from "../src/state.js";

const rd = p => JSON.parse(fs.readFileSync(new URL("../data/" + p, import.meta.url)));
const data = { realms: rd("realms.json"), techniques: rd("techniques.json"), enemies: rd("enemies.json") };
const hours = +process.argv[2] || 3, runs = +process.argv[3] || 200;

function rngFrom(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function runBot(seed) {
  const rng = rngFrom(seed), s = newState(); let now = 0; s.lastTick = 0;
  const reached = {}, totalStones = { earned: 0 };
  for (let sec = 0; sec < hours * 3600; sec++) {
    now = sec * 1000; G.tick(data, s, now);
    if (C.adventureReady(s, now)) { const b = s.spiritStones; C.adventure(data, s, now, rng); totalStones.earned += Math.max(0, s.spiritStones - b); }
    if (!s.ownedTechniques.includes("jade_flow") && s.spiritStones >= 150) G.learnTechnique(data, s, "jade_flow");
    if (G.canBreakthrough(data, s)) {
      if (s.pills < 1 && s.spiritStones >= G.pillPrice(data, s)) G.buyPill(data, s);
      const key = `${s.realmIndex}-${s.layer}`;
      const r = G.breakthrough(data, s, s.pills >= 1, rng);
      if (r.ok) reached[`${s.realmIndex}-${s.layer}`] = sec;
    }
  }
  return { s, reached };
}

const times = {}, finals = [];
for (let i = 0; i < runs; i++) {
  const { s, reached } = runBot(i + 1);
  finals.push(C.globalLevel(data, s) + 1);
  for (const [k, v] of Object.entries(reached)) (times[k] ||= []).push(v);
}
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`Симуляция: ${runs} ботов, ${hours} ч.`);
console.log("Медианное время достижения (мин) — ступень-слой:");
const keys = Object.keys(times).sort((a, b) => { const [r1, l1] = a.split("-").map(Number), [r2, l2] = b.split("-").map(Number); return r1 - r2 || l1 - l2; });
for (const k of keys) { const [r, l] = k.split("-").map(Number); console.log(`  ${data.realms.realms[r].name} ${l}: ${(med(times[k]) / 60).toFixed(1)} мин (достигли ${times[k].length}/${runs})`); }
console.log(`Медианный итоговый глобальный уровень за ${hours} ч: ${med(finals)}`);

console.log("\nВинрейт боя по глобальному уровню L (2000 боёв на врага):");
const rng = rngFrom(999);
for (const L of [0, 4, 8, 12, 20]) {
  const s = newState(); let rem = L; s.realmIndex = 0;
  while (s.realmIndex < data.realms.realms.length - 1 && rem >= data.realms.realms[s.realmIndex].layers) { rem -= data.realms.realms[s.realmIndex].layers; s.realmIndex++; }
  s.layer = rem + 1;
  const row = data.enemies.enemies.map(e => { let w = 0; for (let i = 0; i < 2000; i++) if (C.fight(data, s, e, rng).win) w++; return `${e.id}: ${(w / 20).toFixed(0)}%`; });
  console.log(`  L=${L}: ${row.join(" | ")}`);
}
