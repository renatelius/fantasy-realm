// Пиксель-арт без картинок: сцена года, аватар в паспорте, карта Янь. Только canvas, без DOM-логики игры.
const by = (arr, id) => arr.find(x => x.id === id);
function rnd(seed) { let x = seed >>> 0 || 1; return () => ((x = Math.imul(x ^ (x >>> 15), 2246822519) ^ Math.imul(x ^ (x >>> 13), 3266489917)) >>> 0) / 4294967296; }
const hash = str => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const SKY = {
  quiet: ["#18233a", "#2a3a58"], balance: ["#1d2c44", "#35506e"], dao: ["#2a2148", "#5a4a7a"], rift: ["#2a0f18", "#6a1f2a"],
};
const LAND = {
  huangfeng: { hill: "#3a4a2a", ground: "#5a4a2a", top: "#6b8a3a" },
  qinglong: { hill: "#2a4a3e", ground: "#3a3a32", top: "#3d7a52" },
  haiyun: { hill: "#2a3a4a", ground: "#5a5040", top: "#6a7a5a", sea: true },
  hanmu: { hill: "#4a4a3a", ground: "#6a5a3a", top: "#8a8a4a" },
  penglai: { hill: "#3a5a5a", ground: "#4a5a4a", top: "#5ab08a", sea: true },
  yanjing: { hill: "#3a3a48", ground: "#5a5048", top: "#7a6a5a" },
  liangzhou: { hill: "#5a4a32", ground: "#7a6440", top: "#9a8050" },
  kunlun: { hill: "#5a6a7a", ground: "#b8c4cc", top: "#e6ecef", peaks: true },
  hedu: { hill: "#2a2a2e", ground: "#3a3632", top: "#4a4440" },
};

function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }

function person(ctx, x, y, h, cfg) {
  // h — рост в пикселях (6..16). Голова, тело, ноги.
  const head = Math.max(2, Math.round(h * 0.28)), body = Math.round(h * 0.42), legs = h - head - body;
  px(ctx, x, y - h, 3, head, cfg.skin);
  px(ctx, x - (cfg.long ? 0 : 0), y - h, 3, 1, cfg.hair); if (cfg.long) px(ctx, x - 1, y - h, 1, head + 2, cfg.hair);
  if (cfg.topknot) px(ctx, x + 1, y - h - 1, 1, 1, cfg.hair);
  px(ctx, x - 1, y - h + head, 5, body, cfg.robe);
  if (cfg.sash) px(ctx, x - 1, y - h + head + Math.floor(body / 2), 5, 1, cfg.sash);
  px(ctx, x, y - legs, 1, legs, "#22201c"); px(ctx, x + 2, y - legs, 1, legs, "#22201c");
  if (cfg.sword) { px(ctx, x + 4, y - h + head - 1, 1, body + 2, "#c8d0d8"); px(ctx, x + 3, y - h + head + body - 2, 3, 1, "#d9b45a"); }
  if (cfg.aura) { ctx.fillStyle = cfg.aura; ctx.fillRect(x - 3, y - h - 2, 9, h + 2); }
}

const ROBE = ["#7a2f3a", "#2f5a7a", "#4a6a3a", "#6a5a8a", "#8a6a2a", "#3a6a6a"];
const REALM_ROBE = ["#e6ecef", "#3ecf9f", "#d9b45a"];

export function drawScene(host, data, s) {
  const l = s.life, W = data.world, era = l.eraId, land = LAND[l.regionId] || LAND.huangfeng;
  const Wd = 160, Ht = 64, R = rnd(hash(l.name + l.regionId));
  let c = host.querySelector("canvas");
  if (!c) { c = document.createElement("canvas"); c.className = "scene"; c.width = Wd; c.height = Ht; host.appendChild(c); }
  const ctx = c.getContext("2d");
  const night = l.age % 3 !== 1;
  const [s0, s1] = SKY[era] || SKY.balance;
  const grd = ctx.createLinearGradient(0, 0, 0, Ht); grd.addColorStop(0, night ? s0 : "#5a7a9a"); grd.addColorStop(1, night ? s1 : "#a8c0c8");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, Wd, Ht);
  // звёзды или облака
  for (let i = 0; i < 26; i++) { const x = R() * Wd, y = R() * 26; if (night) px(ctx, x, y, 1, 1, R() < 0.3 ? "#fff" : "#9fb0c8"); }
  for (let i = 0; i < 3; i++) { const x = (R() * Wd + l.age * 3) % (Wd + 20) - 20, y = 6 + R() * 12; px(ctx, x, y, 14, 3, night ? "#4a5468" : "#e6ecef"); px(ctx, x + 3, y - 2, 8, 2, night ? "#4a5468" : "#e6ecef"); }
  // луна/солнце; в эпоху Разлома — трещина в небе
  px(ctx, 128, 7, 7, 7, night ? "#e8e0c0" : "#ffe8a0");
  if (era === "rift") { ctx.strokeStyle = "#ff6a6a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(48, 8); ctx.lineTo(44, 14); ctx.lineTo(54, 22); ctx.stroke(); }
  // горы
  const hy = x => 30 + Math.sin(x / 17 + hash(l.regionId) % 7) * 6 + (l.regionId === "qinglong" ? -8 * Math.abs(Math.sin(x / 23)) : land.peaks ? -12 * Math.abs(Math.sin(x / 19)) : 0);
  ctx.fillStyle = land.hill; ctx.beginPath(); ctx.moveTo(0, 44);
  for (let x = 0; x <= Wd; x += 8) ctx.lineTo(x, hy(x));
  ctx.lineTo(Wd, 44); ctx.fill();
  if (land.peaks) for (let x = 0; x <= Wd; x += 4) if (hy(x) < 24) px(ctx, x, hy(x), 4, 2, "#e6ecef"); // снежные шапки Куньлуня
  if (l.regionId === "yanjing") { // стена столицы и надвратная башня
    px(ctx, 70, 34, 90, 12, "#5a4a44"); for (let x = 70; x < Wd; x += 6) px(ctx, x, 32, 3, 2, "#5a4a44");
    px(ctx, 104, 24, 20, 10, "#6a3a30"); px(ctx, 100, 22, 28, 2, "#7a2f3a"); px(ctx, 110, 38, 8, 8, "#2a1a14");
    if (night) { px(ctx, 107, 28, 2, 2, "#f0c060"); px(ctx, 119, 28, 2, 2, "#f0c060"); }
  }
  if (l.regionId === "liangzhou") { // сигнальная башня; ночью — дым
    px(ctx, 118, 22, 6, 22, "#4a3a2a"); px(ctx, 116, 20, 10, 2, "#3a2a1a");
    if (night) for (let i = 0; i < 5; i++) px(ctx, 119 + (i % 2), 18 - i * 3, 3, 2, "#8a8a8a88");
  }
  if (l.regionId === "hedu") { // обломки колонн стёртого дворца
    px(ctx, 100, 30, 3, 16, "#6a6460"); px(ctx, 108, 36, 3, 10, "#6a6460"); px(ctx, 116, 26, 3, 20, "#6a6460"); px(ctx, 96, 28, 12, 2, "#5a5450");
    for (let i = 0; i < 12; i++) px(ctx, 90 + R() * 40, 44 + R() * 2, 1, 1, "#8a847e");
  }
  if (l.regionId === "qinglong") { // храм на горе
    px(ctx, 100, 18, 12, 2, "#7a2f3a"); px(ctx, 102, 20, 8, 5, "#3a2a22"); px(ctx, 98, 17, 16, 1, "#2a1a14");
  }
  if (land.sea) { px(ctx, 0, 40, Wd, 6, "#2a5a7a"); for (let x = 0; x < Wd; x += 6) px(ctx, x + (l.age % 6), 41, 3, 1, "#6aa0c0"); }
  if (l.regionId === "penglai") { px(ctx, 20, 30, 18, 2, "#e6ecef55"); px(ctx, 60, 26, 24, 2, "#e6ecef44"); }
  // земля
  px(ctx, 0, 46, Wd, 18, land.ground); px(ctx, 0, 46, Wd, 2, land.top);
  for (let i = 0; i < 30; i++) px(ctx, R() * Wd, 48 + R() * 14, 1, 1, "#00000033");
  // дом по достатку
  const w = l.wealthId, hx = 10;
  if (w === "poor") { px(ctx, hx, 38, 16, 9, "#4a3a2a"); px(ctx, hx - 2, 35, 20, 3, "#7a6a3a"); px(ctx, hx + 6, 42, 4, 5, "#1a1410"); }
  else if (w === "noble" || w === "cultclan") {
    px(ctx, hx, 32, 30, 15, "#d8d0c0"); px(ctx, hx - 4, 28, 38, 4, "#7a2f3a"); px(ctx, hx - 6, 27, 4, 2, "#7a2f3a"); px(ctx, hx + 32, 27, 4, 2, "#7a2f3a");
    px(ctx, hx + 12, 38, 6, 9, "#3a2a22"); px(ctx, hx + 4, 35, 4, 4, night ? "#f0c060" : "#4a5a6a"); px(ctx, hx + 22, 35, 4, 4, night ? "#f0c060" : "#4a5a6a");
    if (w === "cultclan") { px(ctx, hx + 13, 22, 4, 5, "#d9b45a"); px(ctx, hx + 14, 20, 2, 2, "#fff6c0"); }
  } else { px(ctx, hx, 36, 22, 11, "#8a6a4a"); px(ctx, hx - 3, 32, 28, 4, "#5a3a2a"); px(ctx, hx + 9, 40, 4, 7, "#2a1a14"); px(ctx, hx + 3, 39, 3, 3, night ? "#f0c060" : "#4a5a6a"); }
  // фонари / столб
  px(ctx, 60, 30, 1, 17, "#3a2a1a"); px(ctx, 58, 30, 5, 3, "#c0392b"); if (night) px(ctx, 59, 31, 3, 1, "#ffb060");

  // люди: игрок + семья
  const ground = 58, people = [];
  const mine = { skin: "#e8c8a0", hair: "#1a1410", long: l.gender === "f", topknot: l.gender === "m" && l.age >= 16, robe: l.awakened ? REALM_ROBE[Math.floor(s.tier ?? s.realmIndex)] || "#e6ecef" : ROBE[hash(l.name) % ROBE.length], sash: l.awakened ? "#7a2f3a" : null, sword: l.awakened && l.age >= 18 };
  const h = l.age < 3 ? 6 : l.age < 12 ? 9 + Math.floor(l.age / 3) : l.age > 70 ? 13 : 15;
  const hh = l.household;
  if (hh && l.age < 22) {
    people.push({ h: l.age < 40 ? 15 : 13, cfg: { skin: "#d8b890", hair: "#2a1a14", topknot: true, robe: "#4a4a3a" } });
    people.push({ h: 14, cfg: { skin: "#e8c8a0", hair: "#1a1410", long: true, robe: "#7a4a5a" } });
  }
  if (l.spouse) people.push({ h: 14, cfg: { skin: "#e8c8a0", hair: "#1a1410", long: l.spouse.gender === "f", topknot: l.spouse.gender === "m", robe: "#5a6a8a" } });
  people.push({ h, cfg: mine, me: true });
  if (hh && l.age < 22) hh.siblings.slice(0, 3).forEach((sb, i) => people.push({ h: Math.min(15, 7 + Math.floor((sb.age + l.age) / 2)), cfg: { skin: "#e8c8a0", hair: "#1a1410", long: sb.gender === "f", robe: ROBE[(i + 2) % ROBE.length] } }));
  l.children.filter(k => k.alive).slice(0, 4).forEach((k, i) => { const a = l.age - k.born; people.push({ h: a < 3 ? 6 : Math.min(15, 8 + Math.floor(a / 2)), cfg: { skin: "#e8c8a0", hair: "#1a1410", long: k.gender === "f", robe: ROBE[(i + 4) % ROBE.length] } }); });
  let x = 70;
  for (const p of people) {
    if (p.me && l.awakened) { ctx.fillStyle = (s.tier ?? s.realmIndex) >= 2 ? "#d9b45a33" : "#3ecf9f26"; ctx.fillRect(x - 4, ground - p.h - 4, 11, p.h + 4); }
    person(ctx, x, ground, p.h, p.cfg); x += 9;
  }
  // собака-талисман (как щенок у 1in8b) — у каждого дома своя
  const dx = x + 4;
  px(ctx, dx, ground - 4, 6, 3, "#c89a5a"); px(ctx, dx + 5, ground - 6, 3, 3, "#c89a5a"); px(ctx, dx + 7, ground - 5, 1, 1, "#1a1410");
  px(ctx, dx, ground - 1, 1, 1, "#c89a5a"); px(ctx, dx + 4, ground - 1, 1, 1, "#c89a5a"); px(ctx, dx - 1, ground - 5, 1, 2, "#c89a5a");
  if (!l.alive) { ctx.fillStyle = "#000a"; ctx.fillRect(0, 0, Wd, Ht); px(ctx, 76, 40, 8, 18, "#6a6a6a"); px(ctx, 74, 38, 12, 3, "#8a8a8a"); }
}

export function drawAvatar(c, l, s) {
  if (!c) return;
  const ctx = c.getContext("2d"); ctx.clearRect(0, 0, 14, 17);
  px(ctx, 0, 0, 14, 17, "#24343a");
  const robe = l.awakened ? REALM_ROBE[Math.floor(s.tier ?? s.realmIndex)] || "#e6ecef" : ROBE[hash(l.name) % ROBE.length];
  px(ctx, 4, 3, 6, 6, "#e8c8a0"); px(ctx, 4, 2, 6, 2, "#1a1410");
  if (l.gender === "f") { px(ctx, 3, 3, 1, 8, "#1a1410"); px(ctx, 10, 3, 1, 8, "#1a1410"); }
  else if (l.age >= 16) px(ctx, 6, 0, 2, 2, "#1a1410");
  px(ctx, 5, 5, 1, 1, "#1a1410"); px(ctx, 8, 5, 1, 1, "#1a1410");
  if (l.age > 60) { px(ctx, 4, 2, 6, 2, "#c8c8c8"); px(ctx, 5, 8, 4, 2, "#d8d8d8"); }
  px(ctx, 2, 10, 10, 7, robe); px(ctx, 6, 10, 2, 7, "#00000033");
  if (l.awakened) px(ctx, 2, 13, 10, 1, "#7a2f3a");
}

export function drawYanMap(c, regions, cur) {
  if (!c) return;
  // Рисуем в логических 300×120, холст в 2 раза больше — без размытия на широком экране.
  const ctx = c.getContext("2d"), K = c.width / 300, Wd = 300, Ht = 120;
  ctx.setTransform(K, 0, 0, K, 0, 0);
  ctx.clearRect(0, 0, Wd, Ht);
  const R = rnd(7);
  // точечная карта материка: эллипс + шум
  for (let y = 0; y < Ht; y += 4) for (let x = 0; x < Wd; x += 4) {
    const nx = (x - Wd * 0.45) / (Wd * 0.42), ny = (y - Ht * 0.5) / (Ht * 0.42);
    const d = nx * nx + ny * ny + Math.sin(x / 13) * 0.12 + Math.cos(y / 9) * 0.1;
    if (d < 1) px(ctx, x, y, 2, 2, d < 0.9 ? "#3a4a54" : "#2a363e");
  }
  // остров Пэнлай
  for (let y = 18; y < 42; y += 4) for (let x = 226; x < 252; x += 4) if (R() < 0.7) px(ctx, x, y, 2, 2, "#3a4a54");
  // стёртое Чжао: пустое пятно с тушью
  ctx.fillStyle = "#0f151a"; ctx.beginPath(); ctx.ellipse(Wd * 0.52, Ht * 0.36, 16, 10, 0.3, 0, 7); ctx.fill();
  ctx.fillStyle = "#5a6a74"; ctx.font = "9px serif"; ctx.fillText("?", Wd * 0.52 - 8, Ht * 0.36 + 3);
  for (const r of regions) {
    const x = r.x / 100 * Wd, y = r.y / 100 * Ht, on = r.id === cur.id;
    ctx.fillStyle = on ? "#3ecf9f" : "#6a7a84"; ctx.beginPath(); ctx.arc(x, y, on ? 4 : 2, 0, 7); ctx.fill();
    if (on) { ctx.strokeStyle = "#3ecf9f"; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); }
    ctx.fillStyle = on ? "#e6ecef" : "#6a7a84"; ctx.font = `${on ? "bold 8" : "7"}px sans-serif`; ctx.fillText(r.short || r.name, x + (on ? 11 : 5), y + 3);
  }
}
