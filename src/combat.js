// Бой и приключения. Формулы:
//   L = глобальный уровень = сумма слоёв пройденных ступеней + (layer-1)
//   stat(L) = base * growth^L
//   урон = max(1, atk * U(0.9..1.1) - def * 0.5), крит игрока x critMult
//   награда: камни = enemy.stones * (1 + 0.15*L); ци = qiRewardShare * qiRequired
//   техника врага: лучшая из enemy.techniques с fromLevel ≤ L; множит hp/atk/def врага.
//     Враги растут техниками так же, как игрок: кто не учит 招式/外功, тот отстаёт.
//   поражение: рана (срок −woundYears) и шанс гибели = deathOnLoss * (1/hpMult тела)^2 * (0.7 с 轻功 — успел уйти)
import { qiRequired, slottedTechs, realmsOf, pathOf, techUsable, techAccess, luckyScroll } from "./game.js";
import { die } from "./life.js";

export function globalLevel(data, s) {
  let L = s.layer - 1;
  for (let i = 0; i < s.realmIndex; i++) L += realmsOf(data, s)[i].layers;
  return L;
}

export function playerStats(data, s) {
  const p = data.enemies.player, g = Math.pow(p.growth, globalLevel(data, s));
  const sl = slottedTechs(data, s);
  const body = s.life && data.world.physiques?.find(x => x.id === s.life.physiqueId);
  const pc = pathOf(data, s).combat || {}; // путь тела крепче, путь духа бьёт сильнее, но хрупок
  const hp = p.hpBase * g * (sl.body?.hpMult || 1) * (body?.hpMult || 1) * (pc.hp || 1);
  const atk = p.atkBase * g * (sl.martial?.atkMult || 1) * (sl.body?.atkMult || 1) * (sl.anqi?.atkMult || 1) * (body?.atkMult || 1) * (pc.atk || 1);
  const def = p.defBase * g * (sl.body?.defMult || 1) * (sl.martial?.defMult || 1) * (body?.defMult || 1) * (pc.def || 1);
  const crit = p.critChance + (sl.qinggong?.critAdd || 0) + (sl.martial?.critAdd || 0) + (sl.anqi?.critAdd || 0) + (body?.critAdd || 0) + (pc.crit || 0);
  return { hp, atk, def, crit };
}

export function enemyTech(data, s, e) {
  const L = globalLevel(data, s);
  return (e.techniques || []).filter(t => t.fromLevel <= L).sort((a, b) => b.fromLevel - a.fromLevel)[0] || null;
}
export function enemyStats(data, s, e) {
  const p = data.enemies.player, g = Math.pow(p.growth, globalLevel(data, s) + e.levelOffset);
  const t = enemyTech(data, s, e);
  return { hp: p.hpBase * g * e.hpMult * (t?.hpMult || 1), atk: p.atkBase * g * e.atkMult * (t?.atkMult || 1), def: p.defBase * g * e.defMult * (t?.defMult || 1) };
}

export function fight(data, s, e, rng = Math.random) {
  const P = playerStats(data, s), E = enemyStats(data, s, e), cfg = data.enemies.player;
  let ph = P.hp, eh = E.hp, rounds = 0;
  const hit = (atk, def) => Math.max(1, atk * (0.9 + 0.2 * rng()) - def * 0.5);
  while (ph > 0 && eh > 0 && rounds < data.enemies.adventure.maxRounds) {
    rounds++;
    eh -= hit(P.atk, E.def) * (rng() < (P.crit ?? cfg.critChance) ? cfg.critMult : 1);
    if (eh <= 0) break;
    ph -= hit(E.atk, P.def);
  }
  return { win: eh <= 0, rounds, hpLeft: Math.max(0, Math.round(ph)) };
}

// Оценка для интерфейса: шанс победы (враг случайный) и шанс гибели за один поход.
export function adventureOdds(data, s, n = 30, rng = Math.random) {
  const list = data.enemies.enemies, cfg = data.enemies.adventure;
  let wins = 0;
  for (const e of list) for (let i = 0; i < n; i++) if (fight(data, s, e, rng).win) wins++;
  const win = wins / (list.length * n);
  const body = s.life && data.world.physiques?.find(x => x.id === s.life.physiqueId);
  const flee = slottedTechs(data, s).qinggong ? 0.7 : 1;
  const death = (1 - win) * (cfg.deathOnLoss || 0) * Math.pow(1 / (body?.hpMult || 1), 2) * flee;
  return { win, death };
}

// Подсказка новичку: самая дешёвая доступная боевая техника (招式 / 外功 / 暗器), которая лучше текущей.
export function combatHint(data, s, cost) {
  const sl = slottedTechs(data, s), val = t => (t.atkMult || 1) * (t.hpMult || 1) * (t.defMult || 1) * (1 + (t.critAdd || 0));
  const cands = data.techniques.techniques
    .filter(t => ["martial", "body", "anqi"].includes(t.type) && techUsable(data, s, t) && techAccess(data, s, t).ok && (t.minRealm || 0) <= s.realmIndex && !s.ownedTechniques.includes(t.id))
    .filter(t => val(t) > (sl[t.type] ? val(sl[t.type]) : 1) + 1e-9)
    .map(t => ({ t, c: cost(t) })).sort((a, b) => a.c - b.c);
  const empty = ["martial", "body"].filter(k => !sl[k]).length;
  return { tech: cands[0]?.t || null, cost: cands[0]?.c ?? null, empty };
}

export function adventureReady(s, now = Date.now()) { return now >= s.adventureReadyAt; }

export function adventure(data, s, now = Date.now(), rng = Math.random) {
  if (s.life && !s.life.awakened) return { ok: false, msg: "Корни не проверены: путь культивации ещё закрыт." };
  if (!adventureReady(s, now)) return { ok: false, msg: "Ты ещё восстанавливаешь силы." };
  const cfg = data.enemies.adventure, list = data.enemies.enemies;
  const e = list[Math.floor(rng() * list.length)];
  const r = fight(data, s, e, rng);
  const et = enemyTech(data, s, e), with_ = et ? ` («${et.name}» ${et.han})` : "";
  if (!r.win) {
    s.losses += 1; s.adventureReadyAt = now + cfg.lossCooldownSec * 1000;
    const body = s.life && data.world.physiques?.find(x => x.id === s.life.physiqueId);
    const flee = slottedTechs(data, s).qinggong ? 0.7 : 1;
    const pDeath = (cfg.deathOnLoss || 0) * Math.pow(1 / (body?.hpMult || 1), 2) * flee;
    if (s.life && rng() < pDeath) {
      die(data, s, `Пал(а) в бою: ${e.name}`, rng);
      return { ok: false, enemy: e.id, win: false, fatal: true, msg: `Последний бой: ${e.name}${with_}. Меч выпал из руки.` };
    }
    if (s.life && cfg.woundYears) s.life.ageShift -= cfg.woundYears;
    return { ok: false, enemy: e.id, win: false, wound: true, msg: `Поражение от: ${e.name}${with_}. Рана заживёт, но годы она забрала${cfg.woundYears ? ` (срок −${cfg.woundYears})` : ""}.` };
  }
  const stones = Math.round(e.stones * (1 + 0.15 * globalLevel(data, s)));
  const qi = Math.floor(cfg.qiRewardShare * qiRequired(data, s));
  const pill = rng() < cfg.pillDropChance;
  s.wins += 1; s.spiritStones += stones; s.qi = Math.min(qiRequired(data, s), s.qi + qi);
  if (pill) s.pills += 1;
  // Удача: в тайнике врага — свиток тайной техники своего пути.
  const scroll = s.life?.awakened && rng() < (cfg.scrollChance || 0) ? luckyScroll(data, s, rng) : null;
  s.adventureReadyAt = now + cfg.cooldownSec * 1000;
  return { ok: true, enemy: e.id, win: true, scroll, msg: `Победа над «${e.name}»${with_}: +${stones} камней, +${qi} ци${pill ? ", найдена пилюля" : ""}${scroll ? `, в тайнике — свиток «${scroll.name}»` : ""}.` };
}
