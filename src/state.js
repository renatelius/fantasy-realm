// Состояние игры: только данные, без логики и без DOM.
export const SAVE_VERSION = 10;

export function emptySlots() {
  return { neigong: "breath_of_mist", body: null, martial: null, qinggong: null, yishu: null, anqi: null };
}

export function newState() {
  return {
    version: SAVE_VERSION,
    pathId: "qi", realmIndex: 0, layer: 1, qi: 0, spiritStones: 0, pills: 0,
    paths: {}, pathSwitchAge: null, pathSlowUntil: null, // остальные начатые пути: { id: {realmIndex, layer, qi, gateAge, slots} } (game.js → switchPath)
    techniqueId: "breath_of_mist",
    techniqueSlots: emptySlots(),
    ownedTechniques: ["breath_of_mist"],
    familyTechs: [], // родовая библиотека: всё, что знали предки, — бесплатно потомкам
    adventureReadyAt: 0, wins: 0, losses: 0,
    life: null, lineage: [],
    clans: {}, // роды между поколениями: «фамилия@край» → { rep, treasury, rules, rivals, tablets } (clan.js)
    settings: { speed: "normal", auto: "off", autoPlay: false },
    clockMs: 0,
    lastTick: 0,
    lastReal: null,
  };
}
