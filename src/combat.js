// Бой и приключения. Формулы:
//   L = глобальный уровень = сумма слоёв пройденных ступеней + (layer-1)
//   stat(L) = base * growth^L
//   урон = max(1, atk * U(0.9..1.1) - def * 0.5), крит игрока x critMult
//   награда: камни = enemy.stones * (1 + 0.15*L); ци = qiRewardShare * qiRequired
import { qiRequired, slottedTechs } from "./game.js";

export function globalLevel(data, s) {
  let L = s.layer - 1;
  for (let i = 0; i < s.realmIndex; i++) L += data.realms.realms[i].layers;
  return L;
}

export function playerStats(data, s) {
  const p = data.enemies.player, g = Math.pow(p.growth, globalLevel(data, s));
  const sl = slottedTechs(data, s);
  const body = s.life && data.world.physiques?.find(x => x.id === s.life.physiqueId);
  const hp = p.hpBase * g * (sl.body?.hpMult || 1) * (body?.hpMult || 1);
  const atk = p.atkBase * g * (sl.martial?.atkMult || 1) * (sl.body?.atkMult || 1) * (sl.anqi?.atkMult || 1);
  const def = p.defBase * g * (sl.body?.defMult || 1) * (sl.martial?.defMult || 1);
  const crit = p.critChance + (sl.qinggong?.critAdd || 0) + (sl.martial?.critAdd || 0) + (sl.anqi?.critAdd || 0);
  return { hp, atk, def, crit };
}

export function enemyStats(data, s, e) {
  const p = data.enemies.player, g = Math.pow(p.growth, globalLevel(data, s) + e.levelOffset);
  return { hp: p.hpBase * g * e.hpMult, atk: p.atkBase * g * e.atkMult, def: p.defBase * g * e.defMult };
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

export function adventureReady(s, now = Date.now()) { return now >= s.adventureReadyAt; }

export function adventure(data, s, now = Date.now(), rng = Math.random) {
  if (s.life && !s.life.awakened) return { ok: false, msg: "Корни не проверены: путь культивации ещё закрыт." };
  if (!adventureReady(s, now)) return { ok: false, msg: "Ты ещё восстанавливаешь силы." };
  const cfg = data.enemies.adventure, list = data.enemies.enemies;
  const e = list[Math.floor(rng() * list.length)];
  const r = fight(data, s, e, rng);
  if (!r.win) {
    s.losses += 1; s.adventureReadyAt = now + cfg.lossCooldownSec * 1000;
    return { ok: false, enemy: e.id, win: false, msg: `Поражение от: ${e.name}. Нужен отдых.` };
  }
  const stones = Math.round(e.stones * (1 + 0.15 * globalLevel(data, s)));
  const qi = Math.floor(cfg.qiRewardShare * qiRequired(data, s));
  const pill = rng() < cfg.pillDropChance;
  s.wins += 1; s.spiritStones += stones; s.qi = Math.min(qiRequired(data, s), s.qi + qi);
  if (pill) s.pills += 1;
  s.adventureReadyAt = now + cfg.cooldownSec * 1000;
  return { ok: true, enemy: e.id, win: true, msg: `Победа над «${e.name}»: +${stones} камней, +${qi} ци${pill ? ", найдена пилюля" : ""}.` };
}
