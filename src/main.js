import { load, save, reset, tabLock } from "./save.js";
import * as G from "./game.js";
import * as C from "./combat.js";
import * as L from "./life.js";
import * as A from "./auto.js";
import * as KF from "./family.js";
import * as CL from "./clan.js";
import * as S from "./sect.js";
import { drawScene, drawAvatar, drawYanMap } from "./pixel.js";

const $ = id => document.getElementById(id);
// Текст игрока (заметки в паузах) — только экранированным: иначе «<» ломает вёрстку, а в заметку можно вставить разметку.
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const setHTML = (el, h) => { if (el && el._h !== h) { el.innerHTML = h; el._h = h; } };
const setHidden = (el, v) => { if (el && el.hidden !== v) el.hidden = v; };
const n01 = v => Math.max(0, Math.min(100, v));
const pct = (a, b) => (a / b * 100);
const yw = n => L.yearsW(n), stw = n => L.stonesW(n);

const names = ["realms", "techniques", "enemies", "world", "events", "chronicle", "jobs", "jokes", "sects", "kin"];
const data = Object.fromEntries(await Promise.all(names.map(async n => [n, await (await fetch(`data/${n}.json`)).json()])));
const by = (arr, id) => arr.find(x => x.id === id);
const GRADE = Object.fromEntries(data.techniques.grades.map(g => [g.id, g]));
const W = data.world, J = data.jokes;

// Версия интерфейса. Сейв, сделанный до рулеток рождения, начинается заново с рождения
// (иначе загружается старая жизнь — например, наследник 23 лет — и рулеток не видно).
const UI_VERSION = 2;
let s = load();
const brokenSave = !!s.brokenSave; delete s.brokenSave;
if ((s.settings?.uiVersion || 0) < UI_VERSION) { s = reset(); L.startLife(data, s, "new"); }
s.settings.uiVersion = UI_VERSION;
if (!s.life) L.startLife(data, s, "new");
if (brokenSave) L.logLine(s, "Старое сохранение не прочиталось, поэтому началась новая жизнь. Копия старого цела: localStorage, ключ «fantasy-realm-save-broken».", "info");
// Телосложения переименованы: старый сейв с удалённым id не должен ломать интерфейс.
const PHY_ALIAS = { iron: "tiger" };
const fixPhy = id => by(W.physiques, id) ? id : (PHY_ALIAS[id] && by(W.physiques, PHY_ALIAS[id]) ? PHY_ALIAS[id] : "plain");
if (s.life) { s.life.physiqueId = fixPhy(s.life.physiqueId); s.life.children?.forEach(c => { if (c.physiqueId) c.physiqueId = fixPhy(c.physiqueId); }); }
s.lineage?.forEach(e => e.children?.forEach(c => { if (c.physiqueId) c.physiqueId = fixPhy(c.physiqueId); }));
// Супруги из старых сейвов: дорисовать тело, корни и душу (нужны для наследования от двух родителей).
if (s.life?.spouse) L.ensureGenes(data, s.life.spouse);
s.life?.children?.forEach(c => { if (c.spouse) L.ensureGenes(data, c.spouse); });
if (!s.techniqueSlots) s.techniqueSlots = { neigong: s.techniqueId, body: null, martial: null, qinggong: null, yishu: null, anqi: null };
if (s.life && !s.life.focusId) s.life.focusId = "family";
if (s.life?.phase === "birth") s.life.phase = "cert";
// v10: живая семья, род и ранг секты для старых сейвов (и подстановки {parent}, {rival}, {master}… в текстах).
L.setFmtData(data);
L.ensureKin(data, s);
L.setYearHook((d, st, rng) => A.autoYear(d, st, rng));

let autoAt = null, pauseAt = null, spinState = null; // spinState: {kind, stage:"idle"|"rolling"|"done", at}
const F = t => L.fmt(s, t);
const log = (msg, kind = "cult") => L.logLine(s, msg, kind);
const done = () => { render(); save(s); };
const speedSpec = () => W.time.speeds[s.settings.speed] ?? W.time.speeds.normal;
const factor = () => speedSpec().factor ?? 1;
const g = (m, f) => s.life.gender === "m" ? m : f;
const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const jpick = (arr, key) => arr[hash(key) % arr.length];
// Для списков людей: общий сдвиг от «эпохи жизни» + индекс → у соседей по списку разные строки.
const jpickI = (arr, key, i) => arr[(hash(key) + i) % arr.length];

// ───────── сводные числа рождения ─────────
const share = (arr, x) => x.weight / arr.reduce((t, y) => t + y.weight, 0);
function birthFacts(l) {
  const region = by(W.regions, l.regionId), wealth = by(W.wealth, l.wealthId), phy = by(W.physiques, l.physiqueId), era = by(W.eras, l.eraId);
  const avgLife = W.regions.reduce((t, r) => t + r.expectLife * share(W.regions, r), 0);
  const avgInf = W.regions.reduce((t, r) => t + r.infantDeath * share(W.regions, r), 0);
  const avgQi = W.regions.reduce((t, r) => t + r.qiMult * share(W.regions, r), 0);
  let expect = Math.round(region.expectLife + wealth.lifeBonus + (phy.lifeBonus || 0));
  if (phy.capAge) expect = Math.min(expect, phy.capAge);
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
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const fxChips = p => L.physiqueEffects(p).map(e => `<span class="fx ${e.good ? "" : "bad"}">${e.t}</span>`).join("");
// Доля одним форматом: от 10% — целые проценты, реже — с десятой (1,6%). Раньше часть была «31%», часть «1 из 64».
const oneIn = (arr, x) => { const p = share(arr, x) * 100; return `${p >= 10 ? p.toFixed(0) : p.toFixed(1).replace(".", ",")}%`; };
const dots = i => "●".repeat(i + 1) + "○".repeat(Math.max(0, 4 - i));

// ───────── рулетки ─────────
const SPIN = {
  region: { title: "Где ты родишься", sub: "Небо бросает жребий по всей Великой Янь. Ты не выбираешь.", list: () => W.regions, cur: l => l.regionId,
    label: r => `${r.name}<small>${r.han}</small>`, after: "spinPhysique",
    result: r => `<div class="big">${r.name}（${r.han}）</div><div class="dim">${cap(r.kind)}. Здесь рождается ${Math.round(share(W.regions, r) * 100)}% младенцев Янь. ${jpick(J.region[r.id] || J.region.any, s.life.name)}</div>` },
  physique: { title: "Телосложение", sub: "Повитуха щупает кости. Мастера скажут потом, что видели всё сразу.", list: () => W.physiques, cur: l => l.physiqueId,
    label: p => `<span class="${p.bad ? "bad-n" : share(W.physiques, p) < 0.04 ? "rare-n" : ""}">${p.name}</span><small>${p.han}</small>`, after: "cert",
    result: p => `<div class="big ${p.bad ? "bad-n" : ""}">${p.name}（${p.han}）</div><div class="dim">${L.gtext(p.text, s.life.gender)} ${p.bad ? "Тяжёлое тело." : ""} Выпадает ${oneIn(W.physiques, p)}.</div><div style="margin-top:6px">${fxChips(p) || `<span class="fx">без особенностей</span>`}</div>` },
  root: { title: "Пробуждение корней", sub: "Шестнадцать лет. Старейшина кладёт твою ладонь на камень проверки. Вся деревня делает вид, что не смотрит.", list: () => W.roots, cur: l => l.rootId,
    label: r => r.name, after: "play",
    result: () => { const l = s.life, r = by(W.roots, l.rootId), soul = W.souls?.find(x => x.id === l.soulId);
      return `<div class="big ${r.qiMult ? "" : "bad-n"}">${L.rootText(data, l)}</div><div class="dim">${r.qiMult ? `Множитель ци ×${r.qiMult}.` : "Путь ци закрыт. Так рождается большинство — и большинство не знает, что есть другие пути."} Такая жила выпадает 1 из ${l.rootOdds}. ${jpick(J.root[r.id] || [], l.name + l.age)}</div>
      ${soul ? `<div style="margin-top:8px"><span class="lbl">Душа</span> <b class="${soul.mult ? "rare-n" : ""}">${soul.name}（${soul.han}）</b><div class="dim small">${soul.text}${soul.mult ? " Путь духа открыт." : ""}</div></div>` : ""}`; } },
};

function renderSpin(kind) {
  $("spin").style.maxWidth = "";
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
    <div class="dim small">${list.map(x => `${x.name.split(" (")[0]} ${oneIn(list, x)}`).join(" · ")}</div>
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
  if (!spinState) return; // двойной клик по «Дальше»
  const kind = spinState.kind; spinState = null;
  if (kind === "root") { s.life.phase = "path"; pathAutoAt = null; }
  else s.life.phase = SPIN[kind].after;
  done();
}

// ───────── выбор пути ─────────
let pathAutoAt = null;
function renderPath() {
  $("spin").style.maxWidth = "1000px";
  const l = s.life, opts = L.pathOptions(data, s), best = L.bestPath(data, s);
  const root = by(W.roots, l.rootId), soul = W.souls?.find(x => x.id === l.soulId);
  const cards = opts.map(o => {
    const p = o.path, cb = p.combat || {};
    const fx = [[cb.hp, `тело ×${cb.hp}`, cb.hp > 1], [cb.atk, `удар ×${cb.atk}`, cb.atk > 1], [cb.def, `защита ×${cb.def}`, cb.def > 1],
      [cb.crit, `крит +${Math.round((cb.crit || 0) * 100)}%`, true], [p.hazardMul !== 1, `беды ${p.hazardMul < 1 ? "−" : "+"}${Math.round(Math.abs(1 - p.hazardMul) * 100)}%`, p.hazardMul < 1],
      [p.daoHeartMul, `дао-сердце ×${p.daoHeartMul} к прорыву`, true], [p.id === "body", "лет меньше", false]]
      .filter(x => x[0]).map(([, t, good]) => `<span class="fx ${good ? "" : "bad"}">${t}</span>`).join("");
    return `<div class="pcard ${o.ok ? "" : "off"} ${o.path.id === best ? "best" : ""}">
      <div class="lbl">${p.han}</div><div class="pname serif">${p.name}</div>
      <div class="dim small">${p.text}</div>
      <div class="small" style="margin:8px 0 4px">Скорость: <b>×${o.mult.toFixed(2)}</b>${o.path.id === best ? ` · <b style="color:var(--jade)">лучший для тебя</b>` : ""}</div>
      <div>${fx}</div>
      <ol class="rl">${p.realms.map(r => `<li class="${r.legend ? "leg" : ""}">${r.name} <small>${r.han} · до ${r.maxAge} лет</small></li>`).join("")}</ol>
      ${o.ok ? `<button class="pink" data-path="${p.id}">Вступить</button>` : `<span class="fx bad">закрыт: ${o.why}</span>`}
    </div>`;
  }).join("");
  setHTML($("spin"), `<div class="reg" style="max-width:none"><div class="reg-h">Выбор пути<small>${l.name} · ${yw(l.age)}</small></div><div class="reg-b">
    <div class="dim">Корни: <b>${L.rootText(data, l)}</b>${soul ? ` · Душа: <b>${soul.name}</b>` : ""} · Тело: <b>${by(W.physiques, l.physiqueId)?.name}</b>. Это первый путь: позже можно развивать и другие открытые — каждый их слой прибавляет к прорыву (до +${Math.round((data.realms.crossPath?.cap ?? 0.25) * 100)}%). Золотом — легенды: в мире Печати до них доходят единицы.</div>
    <div class="pcards">${cards}</div>
    ${s.settings.autoPlay ? `<div class="dim small" style="margin-top:8px">Авторежим выберет лучший путь через пару секунд…</div>` : ""}
  </div></div>`);
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
      <div>Место<b>${cap(f.region.kind)}</b></div>
      <div>Достаток семьи<b><span class="dots">${dots(f.wIdx)}</span><br>${f.wealth.name}</b></div>
      <div>Возраст родителей<b>Мать ${h?.mother.age} · Отец ${h?.father.age}</b></div>
      <div>Работа родителей<b>Мать: ${h?.mother.job} · Отец: ${h?.father.job}</b></div>
      <div>Дом<b>${cap(h?.house) || "—"}</b></div>
      <div>Вера дома<b>${cap(jpick(W.creeds, l.name))}</b></div>
      <div>Ожидаемый срок<b>${yw(f.expect)}</b></div>
      <div>Телосложение<b>${f.phy.name}（${f.phy.han}）</b><span style="text-transform:none;letter-spacing:0">${fxChips(f.phy)}</span></div>
      <div>Риск умереть до 5 лет<b>${(f.inf * 100).toFixed(1)}%</b></div>
      <div>Эпоха<b>${f.era.name}</b></div>
    </div>
    <canvas class="yanmap" id="yanmap" width="600" height="240"></canvas>
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
  if (l.age < 30) return "юность";
  const r = l.age / L.lifespan(data, s);
  return r < (W.life.oldAgeStart ?? 0.78) ? "зрелость" : "закат";
}
function lifeStats() {
  const l = s.life, st = l.stats, span = L.lifespan(data, s);
  return {
    health: n01(100 - (l.age / span) * 55 - (st.karma < 0 ? 8 : 0)),
    joy: n01(42 + st.karma * 3 + (l.spouse ? 8 : 0) + l.children.filter(c => c.alive).length * 4 + ((l.fam?.harmony ?? 55) - 55) * 0.3),
    mind: n01(l.rootRevealed ? 35 + st.daoHeart * 5 + G.maxTier(data, s) * 12 : 10 + Math.min(l.age, 16) * 1.5),
    bonds: n01(20 + st.connections * 4 + (l.spouse ? 15 : 0)),
  };
}

function renderHeader() {
  const l = s.life, span = L.lifespan(data, s);
  setHTML($("brand"), l.odds ? `<b>1</b> из ${l.odds.toLocaleString("ru-RU")}` : `Род <b>${l.surname}</b> · ${l.generation}-е поколение`);
  setHTML($("agebig"), `Возраст<b>${l.age}</b>`);
  setHTML($("topline"), `${l.name} · ${by(W.eras, l.eraId).name}${l.awakened ? " · " + G.realmsOf(data, s)[s.realmIndex].name + ", слой " + s.layer : ""}`);
  $("topbar").style.width = `${Math.min(100, pct(l.age, span))}%`;
  const sp = Object.entries(W.time.speeds).map(([k, v]) =>
    `<button class="${s.settings.speed === k ? "on" : ""}" data-speed="${k}">${k === "pause" ? "❚❚ Пауза" : k === "next" ? "До следующего выбора »" : v.label}</button>`).join("");
  setHTML($("speeds"), sp + `<button class="auto ${s.settings.autoPlay ? "on" : ""}" data-act="auto" title="Персонаж сам выбирает выгодное: карточки, ремесло, фокус, техники, пилюли, прорывы, приключения">⚙ Авторежим${s.settings.autoPlay ? ": вкл" : ""}</button>
    <button data-act="pauses" title="Тихие паузы в 5, 15, 30, 50, 70 лет: вопрос о жизни и строка на память">✎ Паузы${s.settings.noPauses ? ": выкл" : ""}</button>
    <button data-act="newlife" title="Бросить эту жизнь и родиться заново: рулетки края и тела. Родовое древо сохранится">↻ Новая судьба</button>
    <button data-act="reset" title="Стереть всё, включая родовое древо">Стереть всё</button>`);
}

function renderPass() {
  const l = s.life, f = birthFacts(l);
  setHTML($("pass"), `<div class="pass-h"><span>Личные данные · ЯНЬ</span><span>${l.generation} пок.</span></div><div class="pass-b">
    <div class="pass-top"><canvas class="ava" id="ava" width="14" height="17"></canvas><div><div class="pname serif">${l.name}</div>
    <div class="dim small">${stage(l)}${l.awakened ? " · " + G.realmsOf(data, s)[s.realmIndex].name : ""}</div></div></div>
    <div class="kv"><span>Пол</span><b>${g("мужской", "женский")}</b>
      <span>Край</span><b>${f.region.name}</b>
      <span>Тело</span><b title="${L.physiqueEffects(f.phy).map(e => e.t).join(", ")}" class="${f.phy.bad ? "bad-n" : ""}">${f.phy.name} ${f.phy.han}<br>${fxChips(f.phy)}</b>
      <span>Род</span><b><span class="dots">${dots(f.wIdx)}</span> ${f.wealth.name.toLowerCase()}</b>
      <span>Корни</span><b>${l.rootRevealed ? L.rootText(data, l) : `спят до ${W.time.awakeningAge} лет`}</b>
      ${l.soulId ? `<span>Душа</span><b>${W.souls?.find(x => x.id === l.soulId)?.name || "—"}</b>` : ""}
      ${l.awakened ? `<span>Путь</span><b style="color:var(--jade)">${G.pathOf(data, s).name} ${G.pathOf(data, s).han}</b>` : ""}
      ${CL.clanOf(s) ? `<span>Клан</span><b>род ${l.surname} · ${CL.tierName(data, CL.clanOf(s))}</b>` : ""}
      ${l.sect ? `<span>Секта</span><b>${G.sectById(data, l.sect.id)?.name} · ${G.sectRankName(s, data)}</b>` : ""}
      <span>Ремесло</span><b>${L.jobById(data, l.jobId)?.name || (l.age < 6 ? "ещё не учится" : "пока нет")}</b>
    </div>
    <div class="mrz">${mrz(l)}</div></div>`);
  drawAvatar($("ava"), l, { ...s, tier: l.awakened ? G.tierOf(data, s) : 0 });
}

function renderStats() {
  const l = s.life, v = lifeStats(), st = l.stats;
  const bar = (n, k, c) => `<div class="stat"><span>${n}</span><div class="track"><i style="width:${v[k]}%;background:${c}"></i></div><b>${Math.round(v[k])}</b></div>`;
  setHTML($("stats"), `<h2>Состояние <small>0–100</small></h2>
    ${bar("Здоровье", "health", "var(--hp)")}${bar("Покой", "joy", "var(--joy)")}${bar("Путь", "mind", "var(--mind)")}${bar("Связи", "bonds", "var(--bond)")}
    <details><summary>Что значат эти показатели?</summary><div class="dim small" style="margin-top:6px">Здоровье падает с годами и злыми делами. Покой — карма, супруг, дети. Путь — дао-сердце и ступень. Связи — люди, которые придут на похороны.</div></details>
    <div class="mini"><div>Духовные камни<b>${s.spiritStones}</b></div><div>Пилюли<b>${s.pills}</b></div>
      <div>Дао-сердце<b>${st.daoHeart}${(() => { const d = l.awakened ? G.pathPassives(data, s).dao : 0; return d >= 0.1 ? ` <small style="color:var(--jade)">+${d.toFixed(1)}</small>` : ""; })()}</b></div><div>Карма<b>${st.karma > 0 ? "+" : ""}${st.karma}</b></div></div>`);
}

let oddsKey = "", oddsVal = null;
function advOdds() {
  const key = [s.pathId, s.realmIndex, s.layer, JSON.stringify(s.techniqueSlots), s.life.physiqueId, s.spiritStones > 0].join("|");
  if (key !== oddsKey) { oddsKey = key; oddsVal = C.adventureOdds(data, s); }
  return oddsVal;
}
// Подсказка новичку: шанс победы низкий → какие техники есть у врагов и что выучить.
function newbieHint(o) {
  if (s.settings.autoPlay || o.win >= 0.6) return "";
  const techs = [...new Set(data.enemies.enemies.map(e => C.enemyTech(data, s, e)).filter(Boolean).map(t => `«${t.name}»`))];
  const h = C.combatHint(data, s, t => G.techCost(data, s, t));
  const type = h.tech && data.techniques.types.find(x => x.id === h.tech.type);
  const what = h.tech ? `Выучи «${h.tech.name}» (${type.han}) за ${stw(h.cost)}${s.spiritStones < h.cost ? ` — не хватает ${h.cost - s.spiritStones}: поработай год-другой` : " — хватает уже сейчас"}.` : "Подходящих техник на этой ступени нет: копи камни на пилюлю и прорвись.";
  const why = techs.length ? `Враги здесь бьют техниками: ${techs.join(", ")}. ` : "";
  const slots = h.empty ? ` Пустых боевых слотов: ${h.empty} из 2 (招式, 外功).` : "";
  return `<div class="note" style="border-color:var(--gold);background:#d9b45a12">Шанс победы ниже 60%. ${why}${what}${slots} Список — «Техники» справа.</div>`;
}
function renderCult() {
  const l = s.life, el = $("cult");
  if (!l.awakened || !l.alive) { setHTML(el, `<h2>Путь <small>закрыт</small></h2><div class="dim">${l.alive ? `Корни спят. Проверка в ${W.time.awakeningAge} лет — до неё ${Math.max(0, W.time.awakeningAge - l.age)} г.` : "Путь окончен."}</div>`); return; }
  const r = G.realmsOf(data, s)[s.realmIndex], need = G.qiRequired(data, s), locked = !!l.pending || !!l.pause, sp = speedSpec();
  const ch = G.breakthroughChance(data, s), chp = G.breakthroughChance(data, s, true);
  const leftSec = Math.max(0, s.adventureReadyAt - s.clockMs) / 1000;
  setHTML(el, `<h2>Путь <small>побед ${s.wins} · поражений ${s.losses}</small></h2>
    <div class="realm">${r.name}<small>слой ${s.layer}/${r.layers}</small></div>
    <div class="track" style="margin:8px 0 4px"><i style="width:${Math.min(100, pct(s.qi, need))}%;background:var(--jade)"></i></div>
    <div class="dim small">${Math.floor(s.qi)} / ${need} ${G.pathOf(data, s).res || "ци"} · ${sp.untilEvent ? "прокрутка" : (factor() ? `+${(G.qiPerSecond(data, s) * factor()).toFixed(1)}/с` : `пауза · +${G.qiPerSecond(data, s).toFixed(1)}/с на ×1`)}</div>
    ${G.legendGate(data, s) ? `<div class="note" style="border-color:var(--red);background:#e06a6a14">Порог легенды: «${G.realmsOf(data, s)[s.realmIndex + 1].name}». Шанс урезан ×${data.realms.breakthrough.legendChanceMul}, при неудаче ${Math.round((data.realms.breakthrough.legendDeathChance || 0) * 100)}% погибнуть — Печать замечает тех, кто растёт слишком высоко. Пилюля обязательна.${G.gateWaitYears(data, s) ? ` Жилы заживают ещё ${G.gateWaitYears(data, s)} г.` : ""}</div>` : ""}
    <div class="dim small">Прорыв: ${Math.round(ch * 100)}% · с пилюлей ${Math.round(chp * 100)}% · пилюля ${stw(G.pillPrice(data, s))}</div>
    ${pathsBlock(locked)}
    ${(() => { const o = advOdds(); return `<div class="dim small">Приключение: победа ~${Math.round(o.win * 100)}% · <span style="color:${o.death > 0.01 ? "var(--red)" : "inherit"}">гибель ~${(o.death * 100).toFixed(1)}%</span> · поражение = рана (срок −${data.enemies.adventure.woundYears || 0})</div>${newbieHint(o)}`; })()}
    ${s.settings.autoPlay ? `<div class="note">Авторежим сам прорывается, покупает пилюли, когда они выгодны, и учит лучшие техники.</div>` : ""}
    <div class="btns">
      <button data-c="break" ${locked || !G.canBreakthrough(data, s) ? "disabled" : ""}>Прорыв</button>
      <button data-c="breakp" ${locked || !G.canBreakthrough(data, s) || s.pills < 1 ? "disabled" : ""}>С пилюлей</button>
      <button data-c="pill" ${locked || s.spiritStones < G.pillPrice(data, s) ? "disabled" : ""}>Купить пилюлю</button>
      <button data-c="adv" ${locked || leftSec > 0 ? "disabled" : ""}>${leftSec > 0 ? `Отдых ${Math.ceil(leftSec)} с` : "В приключение"}</button>
    </div>`);
}

// Несколько путей: список открытых, кнопка «Развивать», бонус к прорыву от слоёв других путей.
// Компактно: строка на путь (имя, ступень, кнопка) + строка эффектов; итог — одной строкой; пояснения — под спойлером.
let pathInfoOpen = false;
document.addEventListener("toggle", e => { if (e.target.id === "pathinfo") pathInfoOpen = e.target.open; }, true);
function pathsBlock(locked) {
  const open = (data.realms.paths || []).filter(p => G.pathOpen(data, s, p));
  if (open.length < 2) return "";
  const wait = G.pathSwitchWait(data, s), bonus = G.crossPathBonus(data, s), cp = data.realms.crossPath || {}, cap = cp.cap ?? 0.25;
  const mul = G.pathSpeedMul(data, s), slow = G.switchSlowLeft(s);
  const rows = open.map(p => {
    const cur = p.id === s.pathId, pr = G.pathProbe(data, s, p.id), started = cur || !!s.paths?.[p.id];
    const need = G.qiRequired(data, pr), short = p.short || { qi: "Ци", body: "Тело", spirit: "Дух" }[p.id] || p.name;
    const at = started ? `${G.realmsOf(data, pr)[pr.realmIndex].name} · ${pr.layer}${!cur && pr.qi > 0 ? ` · ${Math.floor(pr.qi / need * 100)}%` : ""}` : "не начат";
    const fx = started ? G.passiveText(data, s, p.id) : "";
    return `<div class="prow${cur ? " cur" : ""}"><span class="pn">${cur ? "▶ " : ""}${short}</span><span class="pa">${at}</span>${cur ? `<span class="pb dim">сейчас</span>` : `<button class="pb" data-sw="${p.id}" ${locked || wait ? "disabled" : ""}>Развивать</button>`}${fx ? `<span class="pfx">${fx}</span>` : ""}</div>`;
  }).join("");
  const sum = `Прорыв <b>+${Math.round(bonus * 100)}%</b> · скорость <b style="color:${mul < 1 ? "var(--red)" : "inherit"}">×${mul.toFixed(2)}</b>${slow ? ` · перестройка ${slow} г.` : ""}${wait ? ` · смена через ${wait} г.` : ""}`;
  return `<div class="lbl" style="margin-top:10px">Пути</div><div class="prows">${rows}</div>
    <div class="dim small" style="margin-top:4px">${sum}</div>
    <details id="pathinfo"${pathInfoOpen ? " open" : ""}><summary>Как это работает?</summary><div class="dim small" style="margin-top:4px;line-height:1.45">
      Развивать можно любой открытый путь, менять — раз в год. Ци у каждого пути своя и копится, пока он активен.<br>
      Эффекты всех начатых путей складываются, срок жизни прибавляет каждый (сильнейший — целиком, остальные — ${Math.round((cp.otherLifeShare ?? 0) * 100)}%).<br>
      Слои других путей: +${+((cp.perLayer ?? 0) * 100).toFixed(1)}% к прорыву за слой, не больше +${Math.round(cap * 100)}%.<br>
      Цена: каждый развитый путь сверх одного −${Math.round((cp.splitPenalty ?? 0) * 100)}% к ци и наградам; после смены ${cp.switchSlowYears ?? 0} г. скорость ×${cp.switchSlowMul ?? 1}.
    </div></details>`;
}

function sceneCaption(l) {
  const f = birthFacts(l), h = l.household;
  const fam = [];
  if (l.spouse) fam.push(g("с женой", "с мужем"));
  const kids = l.children.filter(c => c.alive).length;
  if (kids) fam.push(`${kids} ${kids === 1 ? "ребёнок" : kids < 5 ? "ребёнка" : "детей"}`);
  if (!l.spouse && l.age < 20 && h) {
    const live = h.siblings.filter(x => x.alive !== false && l.age - (x.born ?? -x.age) >= 0);
    const b = live.filter(x => x.gender === "m").length, g = live.length - b;
    const sib = [b ? (b === 1 ? "братом" : `${b} братьями`) : "", g ? (g === 1 ? "сестрой" : `${g} сёстрами`) : ""].filter(Boolean).join(" и ");
    const par = [h.father, h.mother].filter(p => p?.alive !== false && p).length;
    fam.push(`${par === 2 ? "с родителями" : par === 1 ? (h.father?.alive ? "с отцом" : "с матерью") : "без родителей"}${sib ? ", " + sib : ""}`);
  }
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
  const jobChips = l.age >= data.jobs.workAge && jobs.length ? `<div class="lbl" style="margin-top:10px">Ремесло</div>
    <select class="jobsel" data-who="self" ${s.settings.autoPlay ? "disabled" : ""}>${jobs.slice().sort((a, b) => b.stones - a.stones).map(j => `<option value="${j.id}" ${j.id === l.jobId ? "selected" : ""}>${j.name} — ${j.stones} камн./год${j.hazard ? " · риск" : ""}</option>`).join("")}</select>` : "";
  setHTML(el, `<h2>Фокус этого года</h2>
    <div class="dim">${stage(l)[0].toUpperCase() + stage(l).slice(1)} · ${f.region.name} · ${f.era.name}</div>
    ${small ? `<div class="dim" style="margin-top:8px">${jpick(J.baby, l.name + l.age)} С шести лет ты сможешь выбирать, на что тратить год. Этот отрезок можно спокойно пролистать на ×8.</div>` : `
    <div class="chips">${data.jobs.focuses.filter(x => !x.inSect || l.sect).map(x => `<button class="${x.id === foc.id ? "on" : ""}" data-focus="${x.id}">${x.name}${x.fx ? `<small class="fxh">${x.fx}</small>` : ""}</button>`).join("")}</div>
    <div class="dim">${foc.text}</div>${jobChips}`}
    ${s.settings.autoPlay && !small ? `<div class="note">Авторежим: фокус, ремесло и дела детей выбираются сами.</div>` : ""}`);
}

// ───────── семья: показатели дома, лента перемен, живые родители, братья и сёстры ─────────
const arrow = v => v > 0 ? `<i class="tr up" title="за последние годы выросло">↑</i>` : v < 0 ? `<i class="tr down" title="за последние годы упало">↓</i>` : `<i class="tr" title="без перемен">→</i>`;
const freshChip = p => p?.fresh && s.life.age - p.fresh.a <= 1 ? `<span class="fx fresh">${p.fresh.t}</span>` : "";
const harmWord = h => h < 30 ? "разлад" : h < 50 ? "натянуто" : h < 70 ? "ровно" : "тепло";
function kinRow(label, p, age, sub = "", extra = "") {
  const dead = p.alive === false;
  return `<div class="row2${dead ? " dead" : ""}"><span>${label}</span><b>${p.name} · ${dead ? `† ${p.deathAge != null ? yw(p.deathAge) : ""}` : yw(Math.max(0, age))}${freshChip(p)}${sub && !dead ? `<small>${sub}</small>` : ""}${extra}</b></div>`;
}
function renderFamily() {
  const l = s.life, h = l.household, f = l.fam || {}, tr = KF.trends(data, s), bf = birthFacts(l);
  const rows = [];
  for (const k of ["father", "mother"]) {
    const p = h?.[k]; if (!p) continue;
    rows.push(kinRow(k === "father" ? "Отец" : "Мать", p, p.age + l.age, [p.prevLife ? "прошлая жизнь рода" : p.job, p.cult ? "культиватор" : ""].filter(Boolean).join(" · ")));
  }
  for (const x of h?.siblings || []) {
    const a = l.age - x.born; if (a < 0) continue;
    const lbl = `${x.born < 0 ? "Старш." : "Младш."} ${x.gender === "m" ? "брат" : "сестра"}`;
    rows.push(kinRow(lbl, x, a, x.alive && a >= W.time.awakeningAge ? L.childSummary(data, s, x) : x.physiqueName ? `тело «${x.physiqueName}»` : ""));
  }
  if (l.spouse) rows.push(`<div class="row2"><span>${l.spouse.gender === "m" ? "Супруг" : "Супруга"}</span><b>${l.spouse.name}${freshChip(l.spouse)}<small>${[L.jobById(data, l.spouse.jobId)?.name, L.genesText(data, l.spouse), l.spouse.clan ? `дом ${l.spouse.clan}` : ""].filter(Boolean).join(" · ")}</small></b></div>`);
  l.children.forEach((c, i) => {
    const a = L.childAge(s, c);
    const tasks = c.alive && a >= 6 ? `<div class="chips" style="justify-content:flex-end;margin:4px 0 0">${data.jobs.childTasks.map(t => `<button class="${(c.task || "home") === t.id ? "on" : ""}" data-child="${i}" data-task="${t.id}">${t.name}</button>`).join("")}</div>` : "";
    rows.push(kinRow(c.gender === "m" ? "Сын" : "Дочь", c, a, c.alive ? L.childSummary(data, s, c) : "", c.alive && a < 16 ? tasks : ""));
  });
  const ch = (f.changes || []).slice(-5).reverse().map(x => `<li><span class="a">${yw(x.a)}</span><span>${x.t}</span></li>`).join("");
  const ty = data.kin?.family?.trendYears || 5;
  setHTML($("family"), `<h2>Семья и жизнь</h2>
    <div class="fammet">
      <div>Достаток<b><span class="dots">${dots(bf.wIdx)}</span> ${arrow(tr.w)}</b><small>${bf.wealth.name.toLowerCase()}</small></div>
      <div>Лад в доме<b>${Math.round(f.harmony ?? 55)} ${arrow(tr.h)}</b><small>${harmWord(f.harmony ?? 55)}</small></div>
      <div>Людей в роду<b>${KF.members(s)} ${arrow(tr.n)}</b><small>стрелки — за ${ty} лет</small></div>
    </div>
    ${ch ? `<div class="lbl" style="margin-top:8px">Что изменилось</div><ul class="chg">${ch}</ul>` : ""}
    ${rows.join("") || `<div class="dim">Один(а) под небом.</div>`}`);
}

// ───────── род: 名望, казна, устав, соседи, Зал предков ─────────
let hallOpen = false;
document.addEventListener("toggle", e => { if (e.target.id === "hall") hallOpen = e.target.open; }, true);
function renderClan() {
  const el = $("clan"), c = CL.clanOf(s), l = s.life;
  if (!c || !data.kin?.clan) { setHTML(el, ""); setHidden(el, true); return; }
  setHidden(el, false);
  const C = data.kin.clan, t = CL.tierIdx(data, c), tr = KF.trends(data, s), nt = C.tiers[t + 1];
  const rules = c.rules.map(id => CL.ruleDef(data, id)).filter(Boolean).map(r => `<div class="row2"><span>${r.name}</span><b class="dim small" style="font-weight:400">${r.text}</b></div>`).join("");
  const nb = c.rivals.slice().sort((a, b) => b.rel - a.rel).map(n => { const w = CL.relWord(data, n);
    return `<div class="row2"><span>Дом ${n.name} <small class="dim">${n.han}</small></span><b><span class="fx ${n.feud || n.rel <= -15 ? "bad" : ""}">${w}</span><small>${C.tiers[n.tier]?.name || ""}</small></b></div>`; }).join("");
  const cost = CL.scrollCost(data, s), canS = CL.canBuyScroll(data, s), head = CL.isHead(s), wait = CL.takeWait(data, s);
  const dis = !l.alive || !!l.pending ? "disabled" : "";
  const amt = Math.max(10, Math.floor(s.spiritStones * (C.donateShare ?? 0.2)));
  const share = Math.round((C.pillDiscount?.[t] || 0) * 100);
  const tablets = c.tablets.slice().reverse().map(x => `<li class="${x.life ? "life" : ""}">${x.life ? "★ " : ""}<b>${x.name}</b> · ${L.gtext(x.role, x.gender)}${x.age != null ? ` · ${yw(x.age)}` : ""}${x.realm ? ` · ${x.realm}` : ""}${x.sect ? ` · ${x.sect}` : ""}${x.cause ? `<small>${x.cause}</small>` : ""}</li>`).join("");
  setHTML(el, `<h2>Род ${c.surname} <small>${CL.tierName(data, c)}</small></h2>
    <div class="fammet">
      <div>名望<b>${Math.round(c.rep)} ${arrow(tr.r)}</b><small>${nt ? `до «${nt.name}» ещё ${Math.max(1, Math.ceil(nt.rep - c.rep))}` : "выше некуда"}</small></div>
      <div>Казна<b>${Math.floor(c.treasury)}</b><small>${share ? `платит ${share}% цены пилюли` : g("пилюли — сам", "пилюли — сама")}</small></div>
      <div>Глава<b>${CL.headName(s).split(" ").slice(1).join(" ") || CL.headName(s)}</b><small>${head ? "это ты" : "старший в доме"}</small></div>
    </div>
    <div class="lbl" style="margin-top:8px">Устав рода</div>${rules || `<div class="dim small">Устава нет: живут, как деды жили.</div>`}
    <div class="lbl" style="margin-top:8px">Соседние дома</div>${nb}
    <div class="btns">
      <button data-clan="donate" ${dis || s.spiritStones < amt ? "disabled" : ""}>Взнос в казну · ${stw(amt)}</button>
      <button data-clan="scroll" ${dis || !canS ? "disabled" : ""}>${cost != null ? `Свиток 中乘 в библиотеку · ${stw(cost)} из казны` : "Свитки — с «уважаемого рода»"}</button>
      ${head ? `<button data-clan="take" ${dis || wait ? "disabled" : ""}>${wait ? `Из казны — через ${wait} г.` : "Взять из казны (глава)"}</button>` : ""}
    </div>
    <details id="hall"${hallOpen ? " open" : ""}><summary>Зал предков 祠堂 · табличек: ${c.tablets.length}</summary><ul class="tree tablets">${tablets || `<li class="dim">Табличек ещё нет.</li>`}</ul></details>
    <div class="dim small" style="margin-top:6px">Род живёт дольше одной жизни: наследник получает часть казны, «новая судьба» с той же фамилией в том же краю — дальняя ветвь. Казна даёт ресурсы, а не ци: «род — это история, а не сила».</div>`);
}

// ───────── секта: ранг, 贡献, учитель, соученики, отношения ─────────
function renderSect() {
  const el = $("sect"), l = s.life, sc = l.sect;
  if (!l.alive || !sc) {
    const last = l.sectHistory?.[l.sectHistory.length - 1];
    if (l.alive && last) { setHidden(el, false); setHTML(el, `<h2>Секта <small>нет</small></h2><div class="dim">${G.sectById(data, last.id)?.name}: ${last.how === "expel" ? "изгнание" : g("ушёл сам", "ушла сама")} в ${yw(last.to)}. Выученное осталось, двери закрыты.</div>`); }
    else { setHTML(el, ""); setHidden(el, true); }
    return;
  }
  setHidden(el, false);
  const sd = G.sectById(data, sc.id), R = S.ranks(data), nr = R[sc.rank + 1], block = S.promoteBlock(data, s);
  const chain = R.map((r, i) => `<span class="${i === sc.rank ? "cur" : i < sc.rank ? "done" : ""}">${r.name}</span>`).join(" → ");
  const tierOk = !nr || G.maxTier(data, s) >= nr.tier;
  const need = nr ? `<div class="dim small">К рангу «${nr.name}»: ступень «${G.realmForTier(data, s, nr.tier).name}» ${tierOk ? "✓" : "✗"} · заслуги ${Math.floor(sc.merit)}/${nr.merit} ${sc.merit >= nr.merit ? "✓" : "✗"}${block && tierOk && sc.merit >= nr.merit ? ` · <span style="color:var(--gold)">${block}</span>` : !block ? ` · испытание: шанс ~${Math.round(S.trialChance(data, s) * 100)}%` : ""}</div>` : `<div class="dim small">Выше ранга нет.</div>`;
  const m = sc.master, frd = (sc.peers || []);
  const rules = (sd.rules || []).map(id => data.sects.ruleDefs?.[id]).filter(Boolean).map(r => `<span class="fx" title="${r.text}">${r.name}</span>`).join("");
  const names = ids => (ids || []).map(id => G.sectById(data, id)?.name).filter(Boolean).join(", ") || "—";
  const pc = S.pillCost(data, s), dis = !!l.pending ? "disabled" : "";
  const hd = sc.head, cands = hd?.self ? S.successorCandidates(data, s) : [];
  const succHtml = hd?.self ? `<div class="lbl" style="margin-top:10px">Преемник</div>
    <div class="dim small">${sc.successor ? `Назван: <b>${sc.successor.name}</b> (${sc.successor.who}).` : "Пока никто не назван — если умрёшь, печать отдаст совет: самому одарённому не из родни."} Назначить можно кого угодно; обычно печать отдают по дару. Родню заметно слабее лучшего ученика совет не простит.</div>
    ${cands.map(c => `<div class="row2"><span>${c.who}</span><b>${c.name}<small>дар: ${c.word}${c.cur ? " · названный преемник" : ""}</small>${c.cur ? "" : `<button data-succ="${c.i}" ${dis || s.settings.autoPlay ? "disabled" : ""}>Назначить</button>`}</b></div>`).join("")}`
    : sc.heirApparent ? `<div class="note">${hd?.regent ? `Печать завещана тебе. Пока ты не войдёшь в «${G.realmForTier(data, s, R[R.length - 1].tier).name}», правит регент ${hd.name}.` : `Глава назвал тебя преемником. Когда печать освободится, она ждёт тебя (нужна ступень «${G.realmForTier(data, s, R[R.length - 1].tier).name}»).`}</div>`
    : sc.headHeir ? `<div class="dim small" style="margin-top:4px">Преемник главы — ${sc.headHeir}.</div>` : "";
  setHTML(el, `<h2>${sd.name} <small>${sd.han} · ${G.sectRankName(s, data)}${sc.lay ? " (мирской)" : ""}</small></h2>
    <div class="dim small">${sd.desc || ""}</div>
    <div class="rankchain">${chain}</div>${need}
    <div class="dim small">Твой дар: ${S.talentWord(S.myTalent(data, s))} — по нему глава выбирает преемника.</div>
    <div class="fammet">
      <div>贡献<b>${Math.floor(sc.contrib)}</b><small>+${S.contribYear(data, s)} в год${l.focusId === "sect" ? " (служба)" : ""}</small></div>
      <div>Заслуги<b>${Math.floor(sc.merit)}</b><small>для рангов, не тратятся</small></div>
      <div>Положение<b>${Math.round(sc.standing)}</b><small>${sc.standing < 20 ? "на волоске" : sc.standing < 45 ? "косятся" : "в чести"}</small></div>
    </div>
    ${m ? `<div class="row2${m.alive ? "" : " dead"}"><span>${m.alive ? "Учитель" : "Учитель †"}</span><b>${m.title} ${m.name}${m.alive && !m.retired ? `<small>доверие ${Math.round(m.rel ?? 50)}</small>` : m.retired ? `<small>${g("теперь ты сам учишь", "теперь ты сама учишь")}</small>` : ""}</b></div>` : ""}
    ${sc.head ? `<div class="row2${sc.head.gone ? " dead" : ""}"><span>Глава секты</span><b>${sc.head.self ? g("ты сам", "ты сама") : sc.head.gone ? `${sc.head.name} †<small>печать ждёт преемника</small>` : `${sc.head.name}<small>${yw(Math.max(0, l.age - (sc.head.since ?? l.age)))} у печати${sc.head.peer === "rival" ? (sc.head.gender === "f" ? " · твоя соперница" : " · твой соперник") : sc.head.peer === "friend" ? (sc.head.gender === "f" ? " · твоя подруга" : " · твой друг") : ""}${sc.heirApparent ? " · ты — названный преемник" : ""}</small>`}</b></div>` : ""}
    ${frd.map(p => `<div class="row2${p.alive ? "" : " dead"}"><span>${p.kind === "friend" ? "Друг" : "Соперник"}</span><b>${p.name}${p.alive ? ` · ${R[p.rank]?.name}<small>дар: ${S.talentWord(S.peerTalent(p))}${sc.headHeir === p.name ? " · преемник главы" : ""}</small>` : " †"}</b></div>`).join("")}
    ${succHtml}
    <div class="row2"><span>Союзники</span><b>${names(sd.allies)}</b></div>
    <div class="row2"><span>Враги</span><b>${names(sd.enemies)}</b></div>
    ${sc.war ? `<div class="note" style="border-color:var(--red);background:#e06a6a14">Война с ${G.sectById(data, sc.war.with)?.name} — ещё ~${yw(Math.max(1, sc.war.until - l.age))}. Беды ×${data.sects.config?.warHazard ?? 1.2}, вклад ×${data.sects.config?.warContribMul ?? 1.5}.</div>` : ""}
    <div style="margin-top:6px">${rules}</div>
    <div class="btns">
      <button data-sect="pill" ${dis || sc.contrib < pc ? "disabled" : ""}>Пилюля за ${pc} 贡献</button>
      <button data-sect="leave" ${dis}>Уйти из секты</button>
    </div>
    <div class="dim small" style="margin-top:6px">贡献 — за год в секте, «Службу секте» (фокус), задания и победы. Техники секты можно оплатить 贡献 вместо камней.</div>`);
}

function peerStatus(p, i) {
  const age = s.life.age;
  if (age < 6) return "раннее детство";
  if (age < 16) return jpickI(J.peerKid, "kid" + Math.floor(age / 4), i);
  const roll = hash(p.name + "fate") % 100;
  const lvl = Math.min(9, 1 + Math.floor((age - 16) / 6 * (1 + (hash(p.name) % 3) / 2)));
  if (p.rootId && age >= 16) {
    if (roll < 8 && age > 40) return `<i>ушёл(ла) в затвор и не вышел(ла)</i>`;
    return `Конденсация ци, слой ${lvl}. ${jpickI(J.peerCult, "cult" + Math.floor(age / 7), i)}`;
  }
  if (roll % 3 === 0 && age >= 16) return `Закалка кожи, слой ${Math.max(1, lvl - 1)}. ${jpickI(J.peerAdult, "adult" + Math.floor(age / 7), i)}`;
  if (roll < 6 + age / 4) return age > 30 ? `<i>погиб(ла): ${jpick(J.peerDeath, p.name)}</i>` : jpickI(J.peerAdult, "adult" + Math.floor(age / 7), i);
  return jpickI(J.peerAdult, "adult" + Math.floor(age / 7), i);
}
function renderPeers() {
  const l = s.life;
  if (!l.peers?.length) { setHTML($("peers"), `<h2>Родившиеся в ту же секунду</h2><div class="dim">Наследник рода: ровесников тебе не записали.</div>`); return; }
  setHTML($("peers"), `<h2>Родившиеся в ту же секунду</h2><div class="lbl" style="margin:-6px 0 4px">в этом возрасте</div>` + l.peers.map((p, i) =>
    `<div class="peer"><div class="peer-h"><b>${p.name}</b><span>${p.region} · ${p.gender === "m" ? "М" : "Ж"}</span></div><div>${L.gtext(peerStatus(p, i), p.gender)}</div></div>`).join(""));
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
    h += `<i class="${c}" title="${yw(a)}"></i>`;
  }
  setHTML($("lmap"), h);
}

// Подсказка к варианту: в какую сторону он тянет (без точных чисел) и есть ли шанс/риск.
const FXN = { stones: "камни", karma: "карма", daoHeart: "дао-сердце", connections: "связи", qiPct: "ци", years: "срок", legacy: "наследие", pill: "пилюля" };
// Родня, род, секта: числа — стрелкой, флаги — словом (good = не красная плашка).
const KIN_FX = { harmony: "лад", famWealth: "достаток", rep: "名望", treasury: "казна", contrib: "贡献", sectStanding: "положение", masterRel: "учитель", rivalRel: "соседи", allyRel: "союзник", parentYears: "годы родителю" };
const KIN_FLAGS = { sectTrial: ["испытание", true], allyMarriage: ["брак союза", true], rivalMarriage: ["брак мира", true], feudEnd: ["мир", true], warEnd: ["перемирие", true], sibSect: ["родня в секту", true], clanRule: ["устав", true], sibMarry: ["свадьба", true],
  parentDeath: ["смерть родителя", false], spouseLeave: ["уход супруга", false], sectLeave: ["уход из секты", false], sectExpel: ["изгнание", false], masterDeath: ["смерть учителя", false], masterLost: ["учитель изгнан", false], peerFriendLost: ["друг отвернётся", false], sectWait: ["отсрочка", false] };
function choiceHint(c) {
  const ef = c.effects || {}, out = [];
  for (const [k, n] of Object.entries(FXN)) if (ef[k]) out.push(`<span class="fx ${ef[k] > 0 ? "" : "bad"}">${n}${ef[k] > 0 ? "↑" : "↓"}</span>`);
  if (ef.spouse) out.push(`<span class="fx">брак</span>`);
  if (ef.sect) out.push(`<span class="fx">секта</span>`);
  if (ef.tech || ef.scroll || ef.sectTech || ef.masterGift) out.push(`<span class="fx">свиток</span>`);
  for (const [k, n] of Object.entries(KIN_FX)) if (ef[k]) out.push(`<span class="fx ${ef[k] > 0 ? "" : "bad"}">${n}${ef[k] > 0 ? "↑" : "↓"}</span>`);
  for (const [k, [n, good]] of Object.entries(KIN_FLAGS)) if (ef[k]) out.push(`<span class="fx ${good ? "" : "bad"}">${n}</span>`);
  if (c.bonus) out.push(`<span class="fx">может повезти</span>`);
  if (c.risk) out.push(`<span class="fx bad">${c.risk.effects?.death ? "смертельный риск" : "есть риск"}</span>`);
  return out.join("");
}
function renderEvent() {
  const l = s.life, el = $("event"), show = l.alive && (!!l.pending || !!l.pause);
  setHidden(el, !show);
  if (!show) return;
  if (l.pause) {
    const p = l.pause, peers = (l.peers || []).map((x, i) => `${x.name.split(" ").pop()} (${x.region}): ${L.gtext(peerStatus(x, i), x.gender).replace(/<[^>]+>/g, "")}`).join(" · ");
    const draft = $("pausetxt")?.value || "";
    setHTML(el, `<div class="lbl">Пауза · ${yw(p.age)}</div><h3>${l.name.split(" ").slice(1).join(" ") || l.name}, ${yw(p.age)}</h3>
      ${p.stat ? `<p class="dim">${p.stat}</p>` : ""}${peers ? `<p class="dim small">Родились в ту же секунду — ${peers}</p>` : ""}
      <p class="serif" style="font-size:1.05rem">${p.q}</p>
      <textarea id="pausetxt" rows="2" maxlength="300" placeholder="Одна строка — останется в летописи этой жизни (необязательно)"></textarea>
      <button class="block" data-pause="write">Записать и жить дальше<small>написанное останется в записи этой жизни</small></button>
      <button class="block" data-pause="skip">Оставить при себе и жить дальше</button>
      <div class="dim small" style="margin-top:6px">${s.settings.autoPlay ? "Через мгновение жизнь пойдёт дальше. Начни писать — она подождёт. · " : ""}<a href="#" data-pause="off">Больше не показывать паузы</a></div>`);
    if (draft && $("pausetxt")) $("pausetxt").value = draft;
    return;
  }
  const e = by(data.events.events, l.pending);
  const auto = s.settings.autoPlay || s.settings.auto !== "off";
  if (auto && l.autoPick == null) { const best = L.autoPickList(data, s, s.settings.autoPlay ? "best" : s.settings.auto); l.autoPick = best.length ? best[Math.floor(Math.random() * best.length)] : null; }
  const pickTxt = auto && l.autoPick != null ? (l.autoHold ? `Авторежим ждёт: выбери сам(а).` : `Через мгновение выбирается «${F(e.choices[l.autoPick].label)}» · нажми на карточку, чтобы остановить`) : "";
  setHTML(el, `<h3>${F(e.title)}</h3><p>${F(e.text)}</p>${e.note ? `<p class="dim small">${F(e.note)}</p>` : ""}` + e.choices.map((c, i) =>
    `<button class="block ${auto && i === l.autoPick && !l.autoHold ? "picked" : ""}" data-i="${i}" ${c.minStones && s.spiritStones < c.minStones ? "disabled" : ""}>${F(c.label)}${c.minStones ? ` <span class="dim">(камней: ${c.minStones})</span>` : ""}<small>${choiceHint(c)}</small></button>`).join("")
    + (pickTxt ? `<div class="dim small" style="margin-top:8px" data-hold="1">${L.gtext(pickTxt, l.gender)}</div>` : ""));
}

function summaryText(gx) {
  if (gx.report?.share) return gx.report.share;
  return `${gx.name} — ${yw(gx.ageAtDeath)}. ${gx.cause}.\n${gx.epitaph}\nКорни: ${gx.rootName}. ${gx.regionName}, ${gx.eraName}.\n` +
    gx.words.map(w => (w.who ? w.who + ": " : "") + "«" + w.text + "»").join("\n");
}
function renderDeath() {
  const l = s.life, el = $("death");
  setHidden(el, l.alive);
  if (l.alive) return;
  const gx = l.legacy, R = gx.report;
  const cands = L.heirCandidates(data, gx);
  const hb = c => { const sum = L.childSummary(data, s, c.node);
    return `<button class="block" data-heir="${c.j}">Продолжить родом: ${c.node.name} (${c.word}, ${yw(c.age)})${sum ? `<small>${sum}</small>` : ""}</button>`; };
  const near = cands.filter(c => c.kind === "child"), far = cands.filter(c => c.kind !== "child");
  const heirs = near.map(hb).join("")
    + (far.length ? `<details class="kinheirs"${near.length ? "" : " open"} style="margin:6px 0"><summary>Другие родичи — внуки, правнуки, братья, сёстры, племянники (${far.length})</summary>${far.map(hb).join("")}</details>` : "")
    + (gx.familyTechs?.length ? `<div class="dim small" style="margin-top:6px">Родовая библиотека переходит наследнику: ${gx.familyTechs.length} свитк. — учатся бесплатно, если позволяет путь.</div>` : "");
  const row = (k, v) => v ? `<div class="row2"><span>${k}</span><b>${v}</b></div>` : "";
  const rep = R ? `<div class="lbl" style="margin-top:10px">Запись о смерти</div><p>${R.bio}</p>
    <p class="dim small">${R.longer != null ? `Из родившихся в этом краю дольше живут около ${String(R.longer).replace(".", ",")}%. ` : ""}${R.diff >= 0 ? `Это на ${yw(R.diff)} больше` : `Это на ${yw(-R.diff)} меньше`}, чем живут смертные в краю «${gx.regionName}» (${R.expect}).</p>
    ${row("Самый счастливый год", `${yw(R.happiest.age)}${R.happiest.why ? ` · ${R.happiest.why}` : ""}`)}
    ${row("Кто попрощался", R.farewell)}
    ${gx.sectSucc?.name ? row("Печать главы", `${gx.sectSucc.name} (${gx.sectSucc.who}, дар: ${gx.sectSucc.word}) — ${gx.sectSucc.will ? "по твоей воле" : "выбрал совет"}`) : ""}
    ${row("Дар с детства", R.talent)}
    ${row("На что ушли взрослые годы", R.years.join(" · "))}
    ${R.pattern ? `<div class="pattern"><div class="lbl">Узор этой жизни</div><div class="pname serif">${R.pattern.name}</div><div class="dim small">${R.pattern.text}</div>
      ${R.pattern.axes.map(x => `<div class="pair"><span>${x.a}</span><i style="--p:${x.word === "поровну" ? 50 : x.side ? (x.word.startsWith("сильно") ? 85 : 65) : (x.word.startsWith("сильно") ? 15 : 35)}%"></i><span>${x.b}</span><small>${x.word}</small></div>`).join("")}
      <div class="dim small">Ни одна сторона не лучше. Узор сложили возможности, время и люди рядом.</div></div>` : ""}
    ${R.notes.length || R.stars.length ? `<div class="lbl" style="margin-top:10px">Отмеченные мгновения</div><ul class="stars">${[...R.notes.map(n => `<li><b>${yw(n.age)}</b> ${n.q}<br>«${esc(n.text)}»</li>`), ...R.stars.filter(x => x.kind !== "note").map(x => `<li><b>${yw(x.age)}</b> ${x.msg}</li>`)].join("")}</ul>` : ""}` : "";
  setHTML(el, `<h2>${gx.name} · ${yw(gx.ageAtDeath)}</h2><div class="dim">${gx.cause}. Корни: ${gx.rootName}</div>
    <p class="serif" style="font-size:1.05rem">${gx.epitaph}</p>
    ${gx.words.map(w => `<div class="quote">«${w.text}»${w.who ? `<small>${w.who}</small>` : ""}</div>`).join("")}
    ${rep}
    ${cands.length ? "" : `<p class="dim">Род пресёкся: некому продолжить дело.</p>`}
    ${heirs}<button class="block" data-new="1">Новая судьба (случайное рождение)</button><button class="block" data-copy="1">Копировать итог от первого лица</button>`);
}
function renderTree() {
  const rows = s.lineage.map(x => `<li style="margin-left:${Math.min(x.generation - 1, 8) * 12}px">${x.name} · ${yw(x.ageAtDeath)} · ${x.awakened ? (x.pathName && x.pathName !== "—" ? x.pathName + ": " : "") + x.realmName + ", слой " + x.layer : "не ступил(а) на Путь"}</li>`);
  if (s.life.alive) rows.push(`<li style="margin-left:${Math.min(s.life.generation - 1, 8) * 12}px;color:var(--jade)">${s.life.name} · ${yw(s.life.age)} · живёт</li>`);
  setHTML($("tree"), rows.join(""));
}
function techLine(t) {
  const gr = GRADE[t.grade], own = s.ownedTechniques.includes(t.id), act = s.techniqueSlots?.[t.type] === t.id;
  const PN = { qi: "путь ци", body: "путь тела", spirit: "путь духа" };
  const eff = t.type === "neigong" && s.life.awakened && G.neigongMult(data, s, t) !== (t.qiMultiplier || 1)
    ? (s.pathId === "body" ? " (телу не нужно)" : ` (на твоём пути ×${G.neigongMult(data, s, t).toFixed(2)})`) : "";
  const bits = [t.path ? `<span class="fx ${G.techUsable(data, s, t) ? "" : "bad"}">${PN[t.path]}</span>` : "",
    t.qiMultiplier ? `ци ×${t.qiMultiplier}${eff}` : "", t.breakAdd ? `прорыв +${Math.round(t.breakAdd * 100)}%` : "", t.forgeMult ? `закалка ×${t.forgeMult}` : "", t.hpMult ? `тело ×${t.hpMult}` : "", t.atkMult ? `удар ×${t.atkMult}` : "", t.defMult ? `защита ×${t.defMult}` : "", t.critAdd ? `крит +${Math.round(t.critAdd * 100)}%` : "", t.hazardCut ? `риск −${Math.round(t.hazardCut * 100)}%` : "", t.pillMul ? `пилюля ×${t.pillMul}` : ""].filter(Boolean).join(" · ");
  const needRealm = !own && (t.minRealm || 0) > G.tierOf(data, s);
  const acc = G.techAccess(data, s, t), cost = G.techCost(data, s, t);
  const SRC = { family: "из родовой библиотеки · бесплатно", market: `рынок · ${stw(cost)}`, sect: `секта · ${stw(cost)} или ${S.contribCost(data, s, t)} 贡献` };
  const st = own ? (act ? "в работе" : "изучена") : acc.ok ? SRC[acc.src] : `🔒 ${acc.why}`;
  const dis = !s.life.alive || !!s.life.pending || act || needRealm || !s.life.awakened || !G.techUsable(data, s, t) || !acc.ok;
  return `<button class="tech g-${t.grade}" data-t="${t.id}" ${dis ? "disabled" : ""}><b>${t.name}</b> · ${gr.han} · ${st}${needRealm ? ` · нужна ступень «${G.realmForTier(data, s, t.minRealm).name}»` : ""}<small>${bits}. ${t.text}</small></button>`;
}
function renderTechs() {
  const det = $("techs").closest("details"); if (!det.open) return;
  const sd = s.life.sect && G.sectById(data, s.life.sect.id);
  const head = `<div class="note">Рынок продаёт только 凡功 и 下乘 — втридорога. 中乘 и выше держат секты, кланы и семьи.<br>
    Родовая библиотека: <b>${(s.familyTechs || []).length}</b> свитк. (бесплатно потомкам) · ${sd ? `секта <b>${sd.name}</b>, ${G.sectRankName(s, data)}` : "без секты"}.</div>`;
  setHTML($("techs"), head + data.techniques.types.map(type => {
    // После выбора пути чужие техники скрыты; свои — первыми.
    const list = data.techniques.techniques.filter(t => t.type === type.id && (!s.life.awakened || G.techUsable(data, s, t)))
      .sort((a, b) => (G.techAccess(data, s, b).ok - G.techAccess(data, s, a).ok) || (!!b.path - !!a.path) || GRADE[a.grade].rank - GRADE[b.grade].rank);
    const note = type.id === "neigong" && s.pathId === "body" && s.life.awakened ? `<div class="dim small">Путь тела копит закалку через 外功, не через 内功.</div>` : "";
    return `<h4 style="margin:12px 0 2px">${type.han} · ${type.name}</h4>${note}` + list.map(techLine).join("");
  }).join(""));
}

let lastSceneKey = "";
function render() {
  const l = s.life;
  const phase = l.phase === "birth" ? "cert" : l.phase;
  let spin = phase === "spinRegion" ? "region" : phase === "spinPhysique" ? "physique" : (l.pendingRoot || spinState?.kind === "root") && l.alive ? "root" : null;
  if (!spin && phase === "path" && l.alive) spin = "path";
  setHidden($("hdr"), !!spin || phase === "cert");
  setHidden($("spin"), !spin); setHidden($("cert"), phase !== "cert" || !!spin);
  setHidden($("app"), !!spin || phase === "cert");
  if (spin === "path") { renderPath(); return; }
  if (spin) { renderSpin(spin); return; }
  if (phase === "cert") { renderCert(); return; }
  renderHeader(); renderPass(); renderStats(); renderCult(); renderSect(); renderFocus(); renderFamily(); renderClan(); renderPeers(); renderMap();
  renderEvent(); renderDeath(); renderTree(); renderTechs();
  const key = [l.age, l.alive, l.spouse?.name, l.children.length, s.realmIndex, l.awakened, l.eraId].join("|");
  if (key !== lastSceneKey) { lastSceneKey = key; drawScene($("scene"), data, { ...s, tier: l.awakened ? G.tierOf(data, s) : 0 }); setHTML($("scene-cap"), sceneCaption(l)); }
  const pop = 25000 + (hash(l.name) % 9000) + l.age * 13;
  setHTML($("chron-sub"), `Сейчас в этой симуляции Янь живут ${pop.toLocaleString("ru-RU")} человек · ${Math.round(pop * birthFacts(l).regShare).toLocaleString("ru-RU")} в твоём краю, кроме тебя`);
  setHTML($("chron"), l.chronicle.map((x, i) => [x, i]).reverse().map(([x, i]) => `<li class="k-${x.kind}${x.star ? " star" : ""}" data-ci="${i}" title="Нажми, чтобы отметить ★"><span class="a">${x.age} ${x.age % 10 === 1 && x.age !== 11 ? "год" : [2, 3, 4].includes(x.age % 10) && ![12, 13, 14].includes(x.age % 100) ? "года" : "лет"}</span><span>${x.kind === "note" ? esc(x.msg) : x.msg}</span></li>`).join(""));
}

// ───────── события ─────────
document.body.addEventListener("click", e => {
  const li = e.target.closest("#chron li[data-ci]");
  if (li) { const x = s.life.chronicle[+li.dataset.ci]; if (x) { x.star = !x.star; done(); } return; }
  const pz = e.target.closest("[data-pause]");
  if (pz) { e.preventDefault(); const k = pz.dataset.pause;
    if (k === "off") { s.settings.noPauses = true; L.closePause(data, s, ""); }
    else L.closePause(data, s, k === "write" ? $("pausetxt")?.value : ""); pauseAt = null; s.lastReal = null; return done(); }
  if (e.target.closest("#event") && !e.target.closest("button") && s.life.pending) { s.life.autoHold = !s.life.autoHold; autoAt = null; return done(); }
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.path) { const r = L.choosePath(data, s, d.path); if (r.ok) { s.life.phase = "play"; s.lastReal = null; } else log(r.msg, "info"); return done(); }
  if (d.spin === "go") return startSpin();
  if (d.spin === "next") return nextSpin();
  if (d.cert === "go") { L.acceptBirth(s); s.life.phase = "play"; s.lastReal = null; L.logLine(s, L.birthBlurb(data, s), "birth"); return done(); }
  if (d.cert === "copy") { navigator.clipboard?.writeText($("cert").innerText.slice(0, 1200)); b.textContent = "Скопировано"; return; }
  if (d.speed) { s.settings.speed = d.speed; return done(); }
  if (d.act === "pauses") { s.settings.noPauses = !s.settings.noPauses; if (s.settings.noPauses && s.life.pause) L.closePause(data, s, ""); return done(); }
  if (d.act === "auto") { s.settings.autoPlay = !s.settings.autoPlay; s.settings.auto = s.settings.autoPlay ? "best" : "off"; autoAt = null; log(s.settings.autoPlay ? "Авторежим включён: судьба сама ищет выгоду." : "Авторежим выключен.", "info"); return done(); }
  if (d.act === "newlife") { if (confirm("Оставить эту жизнь и родиться заново? Родовое древо сохранится.")) { L.startLife(data, s, "new"); spinState = null; done(); } return; }
  if (d.act === "reset") { if (confirm("Сбросить всё, включая родовое древо?")) { s = reset(); L.startLife(data, s, "new"); spinState = null; done(); } return; }
  if (d.c === "break") { const r = G.breakthrough(data, s, false); log(r.msg, r.fatal ? "death" : "break"); return done(); }
  if (d.c === "breakp") { const r = G.breakthrough(data, s, true); log(r.msg, r.fatal ? "death" : "break"); return done(); }
  if (d.c === "pill") { log(G.buyPill(data, s) ? "Куплена пилюля." : "Не хватает камней."); return done(); }
  if (d.c === "adv") { const r = C.adventure(data, s, s.clockMs); log(r.msg, r.win ? "adv" : r.fatal ? "death" : "cult"); return done(); }
  if (d.i !== undefined && b.closest("#event")) { const r = L.chooseOption(data, s, +d.i); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.heir !== undefined) { L.startLife(data, s, "heir", Math.random, +d.heir); return done(); }
  if (d.new) { L.startLife(data, s, "new"); spinState = null; return done(); }
  if (d.copy) { navigator.clipboard?.writeText(summaryText(s.life.legacy)); b.textContent = "Скопировано"; return; }
  if (d.focus) { L.setFocus(data, s, d.focus); return done(); }
  if (d.job) { const r = L.setJob(data, s, d.job, d.who); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.child !== undefined) { L.setChildTask(data, s, +d.child, d.task); return done(); }
  if (d.sw) { const r = G.switchPath(data, s, d.sw); log(r.msg, r.ok ? "awaken" : "info"); return done(); }
  if (d.t) { const r = G.learnTechnique(data, s, d.t); log(r.msg, r.ok ? "cult" : "info"); return done(); }
  if (d.clan) { const r = d.clan === "donate" ? CL.donate(data, s) : d.clan === "scroll" ? CL.buyScroll(data, s) : CL.take(data, s); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.succ !== undefined) { const r = S.appointSuccessor(data, s, +d.succ); if (!r.ok) log(r.msg, "info"); return done(); }
  if (d.sect === "pill") { log(S.sectPill(data, s) ? "Секта выдала пилюлю за вклад." : "Не хватает 贡献.", "sect"); return done(); }
  if (d.sect === "leave") { if (confirm("Уйти из секты? Вернуться в неё будет нельзя, выученное останется.")) { S.leaveSect(data, s, "leave"); done(); } return; }
});
document.body.addEventListener("change", e => {
  const sel = e.target.closest("select.jobsel"); if (!sel) return;
  const r = L.setJob(data, s, sel.value, sel.dataset.who); if (!r.ok) log(r.msg, "info"); done();
});
$("techs").closest("details").addEventListener("toggle", () => { $("techs")._h = null; render(); });

// Чужая вкладка держит игру — эта стоит на паузе и показывает плашку.
let foreign = !tabLock();
function lockBanner() {
  let b = $("tablock");
  if (!foreign) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "tablock"; document.body.prepend(b); }
  b.innerHTML = `Игра открыта в другой вкладке — здесь она на паузе, чтобы вкладки не затирали друг другу сохранение. <button class="pink" id="tab-take">Играть здесь</button>`;
  $("tab-take").onclick = () => { tabLock(true); foreign = false; s = load(); s.lastReal = null; spinState = null; lockBanner(); render(); };
}
lockBanner();
setInterval(() => {
  if (foreign) return;
  if (!tabLock()) { foreign = true; lockBanner(); return; }
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
  if (l.phase === "path") {
    s.lastReal = null;
    if (s.settings.autoPlay) {
      pathAutoAt ??= Date.now() + 2000;
      if (Date.now() >= pathAutoAt) { L.choosePath(data, s, L.bestPath(data, s)); l.phase = "play"; pathAutoAt = null; done(); }
    }
    return;
  }
  L.lifeTick(data, s);
  A.autoTick(data, s);
  if (l.pending && !l.autoHold && (s.settings.autoPlay || s.settings.auto !== "off")) {
    if (autoAt == null) autoAt = Date.now() + (speedSpec().factor >= 8 || speedSpec().untilEvent ? 1500 : 2600);
    else if (Date.now() >= autoAt) { L.autoChoose(data, s, s.settings.autoPlay ? "best" : s.settings.auto); autoAt = null; save(s); }
  } else autoAt = null;
  // Пауза-размышление: в авторежиме сама закрывается, если игрок не начал писать.
  if (l.pause && s.settings.autoPlay) {
    const ta = $("pausetxt"), busy = ta && (document.activeElement === ta || ta.value.trim());
    if (busy) pauseAt = null; else if (pauseAt == null) pauseAt = Date.now() + 4000; else if (Date.now() >= pauseAt) { L.closePause(data, s, ""); pauseAt = null; save(s); }
  } else if (!l.pause) pauseAt = null;
  render();
}, 250);
setInterval(() => save(s), 5000);
render();
