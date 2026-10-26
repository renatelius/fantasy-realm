import { load, save, reset } from "./save.js";
import * as G from "./game.js";
import * as C from "./combat.js";
import * as L from "./life.js";
import * as A from "./auto.js";
import { drawScene, drawAvatar, drawYanMap } from "./pixel.js";

const $ = id => document.getElementById(id);
const setHTML = (el, h) => { if (el && el._h !== h) { el.innerHTML = h; el._h = h; } };
const setHidden = (el, v) => { if (el && el.hidden !== v) el.hidden = v; };
const n01 = v => Math.max(0, Math.min(100, v));
const pct = (a, b) => (a / b * 100);

const names = ["realms", "techniques", "enemies", "world", "events", "chronicle", "jobs", "jokes"];
const data = Object.fromEntries(await Promise.all(names.map(async n => [n, await (await fetch(`data/${n}.json`)).json()])));
const by = (arr, id) => arr.find(x => x.id === id);
const GRADE = Object.fromEntries(data.techniques.grades.map(g => [g.id, g]));
const W = data.world, J = data.jokes;

let s = load();
if (!s.life) L.startLife(data, s, "new");
if (!s.techniqueSlots) s.techniqueSlots = { neigong: s.techniqueId, body: null, martial: null, qinggong: null, yishu: null, anqi: null };
if (s.life && !s.life.focusId) s.life.focusId = "family";
if (s.life?.phase === "birth") s.life.phase = "cert";
L.setYearHook((d, st, rng) => A.autoYear(d, st, rng));

let autoAt = null, spinState = null; // spinState: {kind, stage:"idle"|"rolling"|"done", at}
const F = t => L.fmt(s, t);
const log = (msg, kind = "cult") => L.logLine(s, msg, kind);
const done = () => { render(); save(s); };
const speedSpec = () => W.time.speeds[s.settings.speed] ?? W.time.speeds.normal;
const factor = () => speedSpec().factor ?? 1;
const g = (m, f) => s.life.gender === "m" ? m : f;
const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const jpick = (arr, key) => arr[hash(key) % arr.length];

// ───────── сводные числа рождения ─────────
const share = (arr, x) => x.weight / arr.reduce((t, y) => t + y.weight, 0);
function birthFacts(l) {
  const region = by(W.regions, l.regionId), wealth = by(W.wealth, l.wealthId), phy = by(W.physiques, l.physiqueId), era = by(W.eras, l.eraId);
  const avgLife = W.regions.reduce((t, r) => t + r.expectLife * share(W.regions, r), 0);
  const avgInf = W.regions.reduce((t, r) => t + r.infantDeath * share(W.regions, r), 0);
  const avgQi = W.regions.reduce((t, r) => t + r.qiMult * share(W.regions, r), 0);
  const expect = Math.round(region.expectLife + wealth.lifeBonus + (phy.lifeBonus || 0));
  const inf = region.infantDeath * (phy.hazard || 1) * (wealth.hazard / 0.0045) ** 0.5;
  const wIdx = W.wealth.findIndex(w => w.id === wealth.id);
  return { region, wealth, phy, era, avgLife, avgInf, avgQi, expect, inf, wIdx,
    regShare: share(W.regions, region), phyShare: share(W.physiques, phy), qi: region.qiMult * era.qiMult * (phy.qiMult || 1) };
}
const TRANS = { а:"A",б:"B",в:"V",г:"G",д:"D",е:"E",ё:"E",ж:"ZH",з:"Z",и:"I",й:"I",к:"K",л:"L",м:"M",н:"N",о:"O",п:"P",р:"R",с:"S",т:"T",у:"U",ф:"F",х:"KH",ц:"TS",ч:"CH",ш:"SH",щ:"SH",ы:"Y",э:"E",ю:"YU",я:"YA" };
const lat = t => [...t.toLowerCase()].map(c => TRANS[c] ?? (/[a-z]/.test(c) ? c.toUpperCase() : "<")).join("");
function mrz(l) {
  const a = `I<YAN${lat(l.surname)}<<${lat(l.name.split(" ").slice(1).join(" "))}`.padEnd(36, "<").slice(0, 36);
  const b = `${String(hash(l.name) % 1e9).padStart(9, "0")}${l.gender === "m" ? "M" : "F"}${by(W.regions, l.regionId).id.toUpperCase().slice(0, 3)}<${l.generation}`.padEnd(36, "<").slice(0, 36);
  return a + "<br>" + b;
}
const docNo = l => `№ ЯНЬ-${l.eraId.toUpperCase().slice(0, 3)}-${String(hash(l.name + l.regionId) % 1e6).padStart(6, "0")}`;
const dots = i => "●".repeat(i + 1) + "○".repeat(Math.max(0, 4 - i));

// ───────── рулетки ─────────
const SPIN = {
  region: { title: "Где ты родишься", sub: "Небо бросает жребий по всей Великой Янь. Ты не выбираешь.", list: () => W.regions, cur: l => l.regionId,
    label: r => `${r.name}<small>${r.han}</small>`, after: "spinPhysique",
    result: r => `<div class="big">${r.name}（${r.han}）</div><div class="dim">${r.kind}. Здесь рождается ${Math.round(share(W.regions, r) * 100)}% младенцев Янь. ${jpick(J.region[r.id] || J.region.any, s.life.name)}</div>` },
  physique: { title: "Телосложение", sub: "Повитуха щупает кости. Мастера скажут потом, что видели всё сразу.", list: () => W.physiques, cur: l => l.physiqueId,
    label: p => `${p.name}<small>${p.han}</small>`, after: "cert",
    result: p => `<div class="big">${p.name}（${p.han}）</div><div class="dim">${p.text} Выпадает 1 из ${Math.round(1 / share(W.physiques, p))}.</div>` },
  root: { title: "Пробуждение корней", sub: "Шестнадцать лет. Старейшина кладёт твою ладонь на камень проверки. Вся деревня делает вид, что не смотрит.", list: () => W.roots, cur: l => l.rootId,
    label: r => r.name, after: "play",
    result: () => { const l = s.life, r = by(W.roots, l.rootId); return `<div class="big">${L.rootText(data, l)}</div><div class="dim">Множитель ци ×${r.qiMult}. Такая жила выпадает 1 из ${l.rootOdds}. ${jpick(J.root[r.id] || [], l.name + l.age)}</div>`; } },
};

function renderSpin(kind) {
  const S = SPIN[kind], l = s.life, list = S.list();
  if (!spinState || spinState.kind !== kind) spinState = { kind, stage: "idle" };
  if (spinState.stage === "rolling" && spinState.drawn) return;
  const steps = ["region", "physique", "cert"].map((k, i) => `<i class="${["region", "physique", "cert"].indexOf(kind) >= i || kind === "root" ? "on" : ""}"></i>`).join("");
  const rolling = spinState.stage !== "idle";
  // лента: 7 кругов + цель
  const curId = rolling ? S.cur(l) : null;
  const tape = [];
  for (let k = 0; k < 7; k++) list.forEach(x => tape.push(x));
  const target = curId ? tape.length + list.findIndex(x => x.id === curId) : 1;
  list.forEach(x => tape.push(x)); list.forEach(x => tape.push(x));
  setHTML($("spin"), `<div class="reg"><div class="reg-h">${kind === "root" ? "Камень проверки корней" : "Регистрация рождения"}<small>${docNo(l)}</small></div><div class="reg-b">
    ${kind === "root" ? "" : `<div class="steps">${steps}</div>`}
    <div class="lbl">${kind === "root" ? l.name + " · " + l.age + " лет" : "Рулетка судьбы"}</div>
    <div class="big-name">${S.title}</div><div class="dim">${S.sub}</div>
    <div class="wheel"><div class="mark"></div><ul id="wheel" style="transform:translateY(${-(spinState.stage === "done" ? target - 1 : 0) * 52}px)">${tape.map(x => `<li>${S.label(x)}</li>`).join("")}</ul></div>
    <div class="dim small">${list.map(x => `${x.name.split(" (")[0]} ${Math.round(share(list, x) * 100)}%`).join(" · ")}</div>
    <div class="res" id="spin-res">${spinState.stage === "done" ? S.result(list.find(x => x.id === curId)) : ""}</div>
    <div class="actions">${spinState.stage === "idle" ? `<button class="pink" data-spin="go">Крутить</button>` : spinState.stage === "done" ? `<button class="pink" data-spin="next">${kind === "root" ? "Вступить на Путь" : "Дальше"}</button>` : `<button class="pink" disabled>Небо думает…</button>`}</div>
  </div></div>`);
  if (spinState.stage === "rolling" && !spinState.drawn) {
    spinState.drawn = true;
    const shift = -(target - 1) * 52;
    requestAnimationFrame(() => requestAnimationFrame(() => { const u = $("wheel"); if (u) u.style.transform = `translateY(${shift}px)`; }));
  }
}
function startSpin() {
  const kind = spinState.kind;
  if (kind === "root") L.finishRoot(data, s);
  spinState.stage = "rolling"; spinState.drawn = false; spinState.at = Date.now() + 2500;
  render();
}
function nextSpin() {
  const kind = spinState.kind; spinState = null;
  if (kind === "root") { s.life.phase = "play"; s.lastReal = null; }
  else s.life.phase = SPIN[kind].after;
  done();
}

// ───────── свидетельство о рождении ─────────
function renderCert() {
  const l = s.life, f = birthFacts(l), h = l.household;
  const sib = h?.siblings?.length ? h.siblings.map(x => `${x.rel === "старш." ? "старш." : "младш."} ${x.gender === "m" ? "брат" : "сестра"}, ${x.age}`).join("; ") : "нет";
  const peers = (l.peers || []).map((p, i) => `<div class="row2"><b style="text-align:left">${p.name}</b><span>${p.region} · ${p.gender === "m" ? "М" : "Ж"} · ${p.wealth.toLowerCase()}</span></div>`).join("");
  setHTML($("cert"), `<div class="reg"><div class="reg-h">Регистрация рождения<small>${docNo(l)}</small></div><div class="reg-b">
    <div class="seal">${by(W.regions, l.regionId).han[0]}</div>
    <div class="lbl">Имя</div><div class="big-name">${l.name}</div>
    <div>${L.birthBlurb(data, s)}</div>
    <div class="dim small" style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">Чтобы прожить жизнь до ожидаемого срока, нужно около ${Math.round(f.expect * 0.15 * W.time.yearSeconds / 60 + 3)} минут на ×1 (детство идёт быстрее). Закроешь вкладку — жизнь подождёт в этом браузере.</div>
    <div class="grid3">
      <div>Пол<b>${g("Мужской", "Женский")}</b></div>
      <div>Край рождения<b>${f.region.name}</b></div>
      <div>Место<b>${f.region.kind}</b></div>
      <div>Достаток семьи<b><span class="dots">${dots(f.wIdx)}</span><br>${f.wealth.name}</b></div>
      <div>Возраст родителей<b>Мать ${h?.mother.age} · Отец ${h?.father.age}</b></div>
      <div>Работа родителей<b>Мать: ${h?.mother.job} · Отец: ${h?.father.job}</b></div>
      <div>Дом<b>${h?.house || "—"}</b></div>
      <div>Вера дома<b>${jpick(W.creeds, l.name)}</b></div>
      <div>Ожидаемый срок<b>${f.expect} лет</b></div>
      <div>Телосложение<b>${f.phy.name}（${f.phy.han}）</b></div>
      <div>Риск умереть до 5 лет<b>${(f.inf * 100).toFixed(1)}%</b></div>
      <div>Эпоха<b>${f.era.name}</b></div>
    </div>
    <canvas class="yanmap" id="yanmap" width="300" height="120"></canvas>
    <div class="dim small" style="text-align:center">Вот где на карте Великой Янь твой край. Чжао на картах нет — его стёрли.</div>
    <div class="hl">Из младенцев, что рождаются сегодня, <b>${(f.regShare * 100).toFixed(1)}%</b> рождаются в краю «${f.region.name}» — это 1 из ${Math.round(1 / f.regShare)}. Вся твоя судьба (край × эпоха × достаток × тело) выпадает <b>1 из ${(l.odds || 1).toLocaleString("ru-RU")}</b>.</div>
    <table class="cmp"><tr><th>Если бы вы родились в один день</th><th>В среднем по Янь</th><th>${f.region.name} (ты)</th></tr>
      <tr><td>Ожидаемый срок жизни</td><td>${f.avgLife.toFixed(1)}</td><td>${f.expect}</td></tr>
      <tr><td>Риск умереть до 5 лет</td><td>${(f.avgInf * 100).toFixed(1)}%</td><td>${(f.inf * 100).toFixed(1)}%</td></tr>
      <tr><td>Насыщенность ци (×)</td><td>${f.avgQi.toFixed(2)}</td><td>${f.qi.toFixed(2)}</td></tr>
      <tr><td>Камней в колыбели</td><td>${Math.round(W.wealth.reduce((t, w) => t + w.stones * share(W.wealth, w), 0))}</td><td>${f.wealth.stones}</td></tr>
    </table>
    <div class="dim small">Корни спят до ${W.time.awakeningAge} лет. ${jpick(J.cert, l.name)}</div>
    <div class="lbl" style="margin-top:14px">Родившиеся где-то в Янь в ту же секунду</div>${peers}
    <div class="dim small" style="margin-top:6px">Их жизни тоже пойдут. Покажем, кем они стали, рядом с твоей.</div>
    <div class="actions"><button class="ghost" data-cert="copy">Скопировать карточку</button><button class="pink" data-cert="go">Начать эту жизнь</button></div>
  </div></div>`);
  drawYanMap($("yanmap"), W.regions, f.region);
}

// ───────── игра ─────────
function stage(l) {
  if (l.age < 3) return "младенец"; if (l.age < 12) return "дитя"; if (l.age < 16) return "отрок";
  const r = l.age / L.lifespan(data, s);
  return r < 0.25 ? "расцвет" : r < 0.7 ? "зрелость" : "закат";
}
function lifeStats() {
  const l = s.life, st = l.stats, span = L.lifespan(data, s);
  return {
    health: n01(100 - (l.age / span) * 55 - (st.karma < 0 ? 8 : 0)),
    joy: n01(42 + st.karma * 3 + (l.spouse ? 8 : 0) + l.children.filter(c => c.alive).length * 4),
    mind: n01(l.rootRevealed ? 35 + st.daoHeart * 5 + s.realmIndex * 12 : 10 + Math.min(l.age, 16) * 1.5),
    bonds: n01(20 + st.connections * 4 + (l.spouse ? 15 : 0)),
  };
}

function renderHeader() {
  const l = s.life, span = L.lifespan(data, s);
  setHTML($("brand"), `<b>1</b> из ${(l.odds || 1).toLocaleString("ru-RU")}`);
  setHTML($("agebig"), `Возраст<b>${l.age}</b>`);
  setHTML($("topline"), `${l.name} · ${by(W.eras, l.eraId).name}${l.awakened ? " · " + data.realms.realms[s.realmIndex].name + ", слой " + s.layer : ""}`);
  $("topbar").style.width = `${Math.min(100, pct(l.age, span))}%`;
  const sp = Object.entries(W.time.speeds).map(([k, v]) =>
    `<button class="${s.settings.speed === k ? "on" : ""}" data-speed="${k}">${k === "pause" ? "❚❚ Пауза" : k === "next" ? "До следующего выбора »" : v.label}</button>`).join("");
  setHTML($("speeds"), sp + `<button class="auto ${s.settings.autoPlay ? "on" : ""}" data-act="auto" title="Персонаж сам выбирает выгодное: карточки, ремесло, фокус, техники, пилюли, прорывы, приключения">⚙ Авторежим${s.settings.autoPlay ? ": вкл" : ""}</button>
    <button data-act="reset">Выйти</button>`);
}

function renderPass() {
  const l = s.life, f = birthFacts(l);
  setHTML($("pass"), `<div class="pass-h"><span>Личные данные · ЯНЬ</span><span>${l.generation} пок.</span></div><div class="pass-b">
    <div class="pass-top"><canvas class="ava" id="ava" width="14" height="17"></canvas><div><div class="pname serif">${l.name}</div>
    <div class="dim small">${stage(l)}${l.awakened ? " · " + data.realms.realms[s.realmIndex].name : ""}</div></div></div>
    <div class="kv"><span>Пол</span><b>${g("мужской", "женский")}</b>
      <span>Край</span><b>${f.region.name}</b>
      <span>Тело</span><b>${f.phy.name} ${f.phy.han}</b>
      <span>Род</span><b><span class="dots">${dots(f.wIdx)}</span> ${f.wealth.name.toLowerCase()}</b>
      <span>Корни</span><b>${l.rootRevealed ? L.rootText(data, l) : `спят до ${W.time.awakeningAge} лет`}</b>
      <span>Ремесло</span><b>${L.jobById(data, l.jobId)?.name || (l.age < 6 ? "ещё не учится" : "пока нет")}</b>
    </div>
    <div class="mrz">${mrz(l)}</div></div>`);
  drawAvatar($("ava"), l, s);
}

function renderStats() {
  const l = s.life, v = lifeStats(), st = l.stats;
  const bar = (n, k, c) => `<div class="stat"><span>${n}</span><div class="track"><i style="width:${v[k]}%;background:${c}"></i></div><b>${Math.round(v[k])}</b></div>`;
  setHTML($("stats"), `<h2>Состояние <small>0–100</small></h2>
    ${bar("Здоровье", "health", "var(--hp)")}${bar("Покой", "joy", "var(--joy)")}${bar("Путь", "mind", "var(--mind)")}${bar("Связи", "bonds", "var(--bond)")}
    <details><summary>Что значат эти показатели?</summary><div class="dim small" style="margin-top:6px">Здоровье падает с годами и злыми делами. Покой — карма, супруг, дети. Путь — дао-сердце и ступень. Связи — люди, которые придут на похороны.</div></details>
    <div class="mini"><div>Духовные камни<b>${s.spiritStones}</b></div><div>Пилюли<b>${s.pills}</b></div>
      <div>Дао-сердце<b>${st.daoHeart}</b></div><div>Карма<b>${st.karma > 0 ? "+" : ""}${st.karma}</b></div></div>`);
}

function renderCult() {
  const l = s.life, el = $("cult");
  if (!l.awakened || !l.alive) { setHTML(el, `<h2>Путь <small>закрыт</small></h2><div class="dim">${l.alive ? `Корни спят. Проверка в ${W.time.awakeningAge} лет — до неё ${Math.max(0, W.time.awakeningAge - l.age)} г.` : "Путь окончен."}</div>`); return; }
  const r = data.realms.realms[s.realmIndex], need = G.qiRequired(data, s), locked = !!l.pending, sp = speedSpec();
  const ch = G.breakthroughChance(data, s), chp = G.breakthroughChance(data, s, true);
  const leftSec = Math.max(0, s.adventureReadyAt - s.clockMs) / 1000;
  setHTML(el, `<h2>Путь <small>${s.wins}П · ${s.losses}П</small></h2>
    <div class="realm">${r.name}<small>слой ${s.layer}/${r.layers}</small></div>
    <div class="track" style="margin:8px 0 4px"><i style="width:${Math.min(100, pct(s.qi, need))}%;background:var(--jade)"></i></div>
    <div class="dim small">${Math.floor(s.qi)} / ${need} ци · ${sp.untilEvent ? "прокрутка" : `+${(G.qiPerSecond(data, s) * factor()).toFixed(1)}/с`}</div>
    <div class="dim small">Прорыв: ${Math.round(ch * 100)}% · с пилюлей ${Math.round(chp * 100)}% · пилюля ${G.pillPrice(data, s)} камней</div>
    ${s.settings.autoPlay ? `<div class="note">Авторежим сам прорывается, покупает пилюли, когда они выгодны, и учит лучшие техники.</div>` : ""}
    <div class="btns">
      <button data-c="break" ${locked || !G.canBreakthrough(data, s) ? "disabled" : ""}>Прорыв</button>
      <button data-c="breakp" ${locked || !G.canBreakthrough(data, s) || s.pills < 1 ? "disabled" : ""}>С пилюлей</button>
      <button data-c="pill" ${locked || s.spiritStones < G.pillPrice(data, s) ? "disabled" : ""}>Купить пилюлю</button>
      <button data-c="adv" ${locked || leftSec > 0 ? "disabled" : ""}>${leftSec > 0 ? `Отдых ${Math.ceil(leftSec)} с` : "В приключение"}</button>
    </div>`);
}

function sceneCaption(l) {
  const f = birthFacts(l), h = l.household;
  const fam = [];
  if (l.spouse) fam.push(g("с женой", "с мужем"));
  const kids = l.children.filter(c => c.alive).length;
  if (kids) fam.push(`${kids} ${kids === 1 ? "ребёнок" : kids < 5 ? "ребёнка" : "детей"}`);
  if (!l.spouse && l.age < 20 && h) fam.push(`с родителями${h.siblings.length ? ` и ${h.siblings.length} ${h.siblings.length === 1 ? "братом или сестрой" : "братьями и сёстрами"}` : ""}`);
  const joke = jpick(J.scene, l.name + l.age);
  return `${f.region.name} · ${h?.house || "дом"} ${fam.length ? "· " + fam.join(", ") : ""}<div class="dim small" style="margin-top:4px">${joke}</div>`;
}

function renderFocus() {
  const l = s.life, el = $("focus");
  if (!l.alive) { setHTML(el, ""); setHidden(el, true); return; }
  setHidden(el, false);
  const foc = data.jobs.focuses.find(x => x.id === l.focusId) || data.jobs.focuses[0];
  const f = birthFacts(l);
  const small = l.age < 6;
  const jobs = data.jobs.jobs.filter(j => L.jobEligible(data, s, j, "self"));
  const jobChips = l.age >= data.jobs.workAge && jobs.length ? `<div class="lbl" style="margin-top:10px">Ремесло</div><div class="chips">${jobs.map(j => `<button class="${j.id === l.jobId ? "on" : ""}" data-job="${j.id}" data-who="self">${j.name} · ${j.stones}</button>`).join("")}</div>` : "";
  setHTML(el, `<h2>Фокус этого года</h2>
    <div class="dim">${stage(l)[0].toUpperCase() + stage(l).slice(1)} · ${f.region.name} · ${f.era.name}</div>
    ${small ? `<div class="dim" style="margin-top:8px">${jpick(J.baby, l.name + l.age)} С шести лет ты сможешь выбирать, на что тратить год. Этот отрезок можно спокойно пролистать на ×8.</div>` : `
    <div class="chips">${data.jobs.focuses.map(x => `<button class="${x.id === foc.id ? "on" : ""}" data-focus="${x.id}">${x.name}</button>`).join("")}</div>
    <div class="dim">${foc.text}</div>${jobChips}`}
    ${s.settings.autoPlay && !small ? `<div class="note">Авторежим: фокус, ремесло и дела детей выбираются сами.</div>` : ""}`);
}

function renderFamily() {
  const l = s.life, h = l.household;
  const rows = [];
  if (h && l.age < 60) {
    rows.push(`<div class="row2"><span>Мать</span><b>${h.mother.name} · ${h.mother.age + l.age} лет<small>${h.mother.job}</small></b></div>`);
    rows.push(`<div class="row2"><span>Отец</span><b>${h.father.name} · ${h.father.age + l.age} лет<small>${h.father.job}</small></b></div>`);
    if (h.siblings.length) rows.push(`<div class="row2"><span>Братья и сёстры</span><b>${h.siblings.map(x => `${x.gender === "m" ? "брат" : "сестра"} ${x.name.split(" ").pop()}, ${Math.max(0, x.age + (x.rel === "старш." ? l.age : l.age))}`).join("<br>")}</b></div>`);
  }
  if (l.spouse) rows.push(`<div class="row2"><span>${l.spouse.gender === "m" ? "Супруг" : "Супруга"}</span><b>${l.spouse.name}<small>${L.jobById(data, l.spouse.jobId)?.name || ""}</small></b></div>`);
  l.children.forEach((c, i) => {
    const a = L.childAge(s, c);
    const tasks = c.alive && a >= 6 ? `<div class="chips" style="justify-content:flex-end;margin:4px 0 0">${data.jobs.childTasks.map(t => `<button class="${(c.task || "home") === t.id ? "on" : ""}" data-child="${i}" data-task="${t.id}">${t.name}</button>`).join("")}</div>` : "";
    rows.push(`<div class="row2"><span>${c.gender === "m" ? "Сын" : "Дочь"}</span><b>${c.name} · ${c.alive ? a + " лет" : "умер(ла)"}${tasks}</b></div>`);
  });
  setHTML($("family"), `<h2>Семья и жизнь</h2>${rows.join("") || `<div class="dim">Один(а) под небом.</div>`}`);
}

function peerStatus(p, i) {
  const age = s.life.age;
  if (age < 6) return "раннее детство";
  if (age < 16) return jpick(J.peerKid, p.name + Math.floor(age / 4));
  const roll = hash(p.name + "fate") % 100;
  if (p.rootId && age >= 16) {
    const lvl = Math.min(9, 1 + Math.floor((age - 16) / 6 * (1 + (hash(p.name) % 3) / 2)));
    if (roll < 8 && age > 40) return `<i>ушёл(ла) в затвор и не вышел(ла)</i>`;
    return `Конденсация ци, слой ${lvl}. ${jpick(J.peerCult, p.name + Math.floor(age / 7))}`;
  }
  if (roll < 6 + age / 4) return age > 30 ? `<i>погиб(ла): ${jpick(J.peerDeath, p.name)}</i>` : jpick(J.peerAdult, p.name + Math.floor(age / 7));
  return jpick(J.peerAdult, p.name + Math.floor(age / 7));
}
function renderPeers() {
  const l = s.life;
  if (!l.peers?.length) { setHTML($("peers"), `<h2>Родившиеся в ту же секунду</h2><div class="dim">Наследник рода: ровесников тебе не записали.</div>`); return; }
  setHTML($("peers"), `<h2>Родившиеся в ту же секунду <small>в этом возрасте</small></h2>` + l.peers.map((p, i) =>
    `<div class="peer"><b>${p.name}</b> <span class="dim small" style="float:right">${p.gender === "m" ? "М" : "Ж"}</span><div>${p.region}</div><div>${L.gtext(peerStatus(p, i), p.gender)}</div></div>`).join(""));
}

function renderMap() {
  const l = s.life, span = L.lifespan(data, s), f = birthFacts(l);
  const n = Math.min(600, Math.ceil(Math.max(span, f.expect, l.age + 1) / 12) * 12);
  const ev = new Set(l.chronicle.filter(x => x.kind === "event").map(x => x.age));
  const br = new Set(l.chronicle.filter(x => x.kind === "break").map(x => x.age));
  const aw = new Set(l.chronicle.filter(x => x.kind === "awaken").map(x => x.age));
  let h = "";
  for (let a = 0; a < n; a++) {
    const c = [a < l.age ? "p" : "", ev.has(a) ? "ev" : "", br.has(a) ? "br" : "", aw.has(a) ? "aw" : "", a === l.age && l.alive ? "now" : "", a === f.expect - 1 ? "exp" : "", !l.alive && a === l.age ? "dead" : ""].join(" ");
    h += `<i class="${c}" title="${a} лет"></i>`;
  }
  setHTML($("lmap"), h);
}

function renderEvent() {
  const l = s.life, el = $("event"), show = l.alive && !!l.pending;
  setHidden(el, !show);
  if (!show) return;
  const e = by(data.events.events, l.pending);
  setHTML(el, `<h3>${F(e.title)}</h3><p>${F(e.text)}</p>` + e.choices.map((c, i) =>
    `<button class="block" data-i="${i}" ${c.minStones && s.spiritStones < c.minStones ? "disabled" : ""}>${F(c.label)}${c.minStones ? ` <span class="dim">(камней: ${c.minStones})</span>` : ""}</button>`).join("")
    + (s.settings.autoPlay ? `<div class="dim small" style="margin-top:8px">Авторежим выберет самое выгодное через пару секунд…</div>` : ""));
}

function summaryText(gx) {
  return `${gx.name} — ${gx.ageAtDeath} лет. ${gx.cause}.\n${gx.epitaph}\nКорни: ${gx.rootName}. ${gx.regionName}, ${gx.eraName}.\n` +
    gx.words.map(w => (w.who ? w.who + ": " : "") + "«" + w.text + "»").join("\n");
}
function renderDeath() {
  const l = s.life, el = $("death");
  setHidden(el, l.alive);
  if (l.alive) return;
  const gx = l.legacy;
  const heirs = gx.children.map((c, i) => `<button class="block" data-heir="${i}">Продолжить родом: ${c.name} (${c.gender === "m" ? "сын" : "дочь"}, ${c.age} лет)</button>`).join("");
  setHTML(el, `<h2>${gx.name} · ${gx.ageAtDeath} лет</h2><div class="dim">${gx.cause}. Корни: ${gx.rootName}</div>
    <p class="serif" style="font-size:1.05rem">${gx.epitaph}</p>
    ${gx.words.map(w => `<div class="quote">«${w.text}»${w.who ? `<small>${w.who}</small>` : ""}</div>`).join("")}
    ${gx.children.length ? "" : `<p class="dim">Род пресёкся: некому продолжить дело.</p>`}
    ${heirs}<button class="block" data-new="1">Новая судьба (случайное рождение)</button><button class="block" data-copy="1">Копировать итог</button>`);
}
function renderTree() {
  const rows = s.lineage.map(x => `<li style="margin-left:${Math.min(x.generation - 1, 8) * 12}px">${x.name} · ${x.ageAtDeath} лет · ${x.awakened ? x.realmName + ", слой " + x.layer : "не ступил(а) на Путь"}</li>`);
  if (s.life.alive) rows.push(`<li style="margin-left:${Math.min(s.life.generation - 1, 8) * 12}px;color:var(--jade)">${s.life.name} · ${s.life.age} лет · живёт</li>`);
  setHTML($("tree"), rows.join(""));
}
function techLine(t) {
  const gr = GRADE[t.grade], own = s.ownedTechniques.includes(t.id), act = s.techniqueSlots?.[t.type] === t.id;
  const bits = [t.qiMultiplier ? `ци ×${t.qiMultiplier}` : "", t.hpMult ? `тело ×${t.hpMult}` : "", t.atkMult ? `удар ×${t.atkMult}` : "", t.defMult ? `защита ×${t.defMult}` : "", t.critAdd ? `крит +${Math.round(t.critAdd * 100)}%` : "", t.hazardCut ? `риск −${Math.round(t.hazardCut * 100)}%` : "", t.pillMul ? `пилюля ×${t.pillMul}` : ""].filter(Boolean).join(" · ");
  const needRealm = !own && (t.minRealm || 0) > s.realmIndex;
  const st = own ? (act ? "в работе" : "изучена") : `${t.cost} камней`;
  const dis = !s.life.alive || !!s.life.pending || act || needRealm || !s.life.awakened;
  return `<button class="tech g-${t.grade}" data-t="${t.id}" ${dis ? "disabled" : ""}><b>${t.name}</b> · ${gr.han} · ${st}${needRealm ? ` · с ${data.realms.realms[t.minRealm].name}` : ""}<small>${bits}. ${t.text}</small></button>`;
}
function renderTechs() {
  const det = $("techs").closest("details"); if (!det.open) return;
  setHTML($("techs"), data.techniques.types.map(type => {
    const list = data.techniques.techniques.filter(t => t.type === type.id).sort((a, b) => GRADE[a.grade].rank - GRADE[b.grade].rank);
    return `<h4 style="margin:12px 0 2px">${type.han} · ${type.name}</h4>` + list.map(techLine).join("");
  }).join(""));
}

let lastSceneKey = "";
function render() {
  const l = s.life;
  const phase = l.phase === "birth" ? "cert" : l.phase;
  const spin = phase === "spinRegion" ? "region" : phase === "spinPhysique" ? "physique" : (l.pendingRoot || spinState?.kind === "root") && l.alive ? "root" : null;
  setHidden($("hdr"), !!spin || phase === "cert");
  setHidden($("spin"), !spin); setHidden($("cert"), phase !== "cert" || !!spin);
  setHidden($("app"), !!spin || phase === "cert");
  if (spin) { renderSpin(spin); return; }
  if (phase === "cert") { renderCert(); return; }
  renderHeader(); renderPass(); renderStats(); renderCult(); renderFocus(); renderFamily(); renderPeers(); renderMap();
  renderEvent(); renderDeath(); renderTree(); renderTechs();
  const key = [l.age, l.alive, l.spouse?.name, l.children.length, s.realmIndex, l.awakened, l.eraId].join("|");
  if (key !== lastSceneKey) { lastSceneKey = key; drawScene($("scene"), data, s); setHTML($("scene-cap"), sceneCaption(l)); }
  const pop = 25000 + (hash(l.name) % 9000) + l.age * 13;
  setHTML($("chron-sub"), `Сейчас в этой симуляции Янь живут ${pop.toLocaleString("ru-RU")} человек · ${Math.round(pop * birthFacts(l).regShare).toLocaleString("ru-RU")} в твоём краю, кроме тебя`);
  setHTML($("chron"), l.chronicle.slice().reverse().map(x => `<li class="k-${x.kind}"><span class="a">${x.age} ${x.age % 10 === 1 && x.age !== 11 ? "год" : [2, 3, 4].includes(x.age % 10) && ![12, 13, 14].includes(x.age % 100) ? "года" : "лет"}</span><span>${x.msg}</span></li>`).join(""));
}

// ───────── события ─────────
document.body.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.spin === "go") return startSpin();
  if (d.spin === "next") return nextSpin();
  if (d.cert === "go") { L.acceptBirth(s); s.life.phase = "play"; s.lastReal = null; L.logLine(s, L.birthBlurb(data, s), "birth"); return done(); }
  if (d.cert === "copy") { navigator.clipboard?.writeText($("cert").innerText.slice(0, 1200)); b.textContent = "Скопировано"; return; }
  if (d.speed) { s.settings.speed = d.speed; return done(); }
  if (d.act === "auto") { s.settings.autoPlay = !s.settings.autoPlay; s.settings.auto = s.settings.autoPlay ? "best" : "off"; autoAt = null; log(s.settings.autoPlay ? "Авторежим включён: судьба сама ищет выгоду." : "Авторежим выключен.", "info"); return done(); }
  if (d.act === "reset") { if (confirm("Сбросить всё, включая родовое древо?")) { s = reset(); L.startLife(data, s, "new"); spinState = null; done(); } return; }
  if (d.c === "break") { log(G.breakthrough(data, s, false).msg, "break"); return done(); }
  if (d.c === "breakp") { log(G.breakthrough(data, s, true).msg, "break"); return done(); }
  if (d.c === "pill") { log(G.buyPill(data, s) ? "Куплена пилюля." : "Не хватает камней."); return done(); }
  if (d.c === "adv") { const r = C.adventure(data, s, s.clockMs); log(r.msg, r.win ? "adv" : "cult"); return done(); }
  if (d.i !== undefined && b.closest("#event")) { const r = L.chooseOption(data, s, +d.i); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.heir !== undefined) { L.startLife(data, s, "heir", Math.random, +d.heir); return done(); }
  if (d.new) { L.startLife(data, s, "new"); spinState = null; return done(); }
  if (d.copy) { navigator.clipboard?.writeText(summaryText(s.life.legacy)); b.textContent = "Скопировано"; return; }
  if (d.focus) { L.setFocus(data, s, d.focus); return done(); }
  if (d.job) { const r = L.setJob(data, s, d.job, d.who); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.child !== undefined) { L.setChildTask(data, s, +d.child, d.task); return done(); }
  if (d.t) { const r = G.learnTechnique(data, s, d.t); log(r.msg, r.ok ? "cult" : "info"); return done(); }
});
$("techs").closest("details").addEventListener("toggle", () => { $("techs")._h = null; render(); });

setInterval(() => {
  const l = s.life;
  // рулетка докрутилась
  if (spinState?.stage === "rolling" && Date.now() >= spinState.at) { spinState.stage = "done"; render(); }
  // авторежим сам крутит рулетку корней и жмёт «дальше»
  if (s.settings.autoPlay && spinState?.kind === "root") {
    if (spinState.stage === "idle" && !spinState.autoAt) spinState.autoAt = Date.now() + 1200;
    if (spinState.stage === "idle" && Date.now() >= spinState.autoAt) startSpin();
    if (spinState.stage === "done") { spinState.doneAt ??= Date.now() + 2200; if (Date.now() >= spinState.doneAt) nextSpin(); }
  }
  if (spinState) { s.lastReal = null; return; }
  L.lifeTick(data, s);
  A.autoTick(data, s);
  if (l.pending && (s.settings.autoPlay || s.settings.auto !== "off")) {
    if (autoAt == null) autoAt = Date.now() + (speedSpec().factor >= 8 || speedSpec().untilEvent ? 700 : 1800);
    else if (Date.now() >= autoAt) { L.autoChoose(data, s, s.settings.autoPlay ? "best" : s.settings.auto); autoAt = null; save(s); }
  } else autoAt = null;
  render();
}, 250);
setInterval(() => save(s), 5000);
render();
