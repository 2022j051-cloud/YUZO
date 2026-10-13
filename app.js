const DB_KEY = "retro-shelf-v1";
const DICTIONARY_KEY = "retro-shelf-dictionaries-v1";
const IDB_NAME = "retro-shelf-db";
const IDB_STORE = "collection";
const COVER_TEMPLATES_KEY = "retro-shelf-cover-templates-v1";
const DISPLAY_SETTINGS_KEY = "retro-shelf-display-settings-v1";
const COLLECTION_VIEW_KEY = "retro-shelf-collection-view-v1";
const DEFAULT_DISPLAY_SETTINGS = { fields: ["title", "platform", "publisher", "editions", "clearStatus"], dimCleared: true, coverBorder: true, coverRounded: true, theme: "system" };
let displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, fields: [...DEFAULT_DISPLAY_SETTINGS.fields] };
function defaultCoverTemplates() { return []; }
let coverTemplates = [];
const $ = (id) => document.getElementById(id);
let games = [];
let dictionaries = normalizeDictionaries(null);
let currentCover = "";
let activeDetailId = null;
let activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
let activeDictionaryCategoryId = "hardware";
let pendingDictionaryDelete = null;
let toastTimer;

function makeId(prefix = "id") { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB is not available")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readStored(key, fallbackValue) {
  try {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (result !== undefined) return result;
  } catch (_) { /* Try the small-data fallback below. */ }
  try {
    const local = localStorage.getItem(key);
    return local === null ? fallbackValue : JSON.parse(local);
  } catch (_) { return fallbackValue; }
}
async function writeStored(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (_) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
}
async function loadGames() {
  const stored = await readStored(DB_KEY, []);
  return Array.isArray(stored) ? stored : [];
}
async function persist() {
  const ok = await writeStored(DB_KEY, games);
  if (!ok) { showToast("保存できませんでした。端末の空き容量を確認し、バックアップを取ってください。"); return false; }
  render();
  return true;
}
async function persistDictionaries() {
  const ok = await writeStored(DICTIONARY_KEY, dictionaries);
  if (!ok) showToast("辞書を保存できませんでした。バックアップを取ってから再度お試しください。");
  return ok;
}
function unique(values) { return [...new Set(values)]; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showToast(message) {
  const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function entry(name, aliases = []) { return { id: makeId("entry"), name, aliases }; }
function defaultCategories() {
  return [
    { id: "hardware", name: "ハード", binding: "platform", multiple: false, required: true, builtIn: true, entries: [
      entry("ファミリーコンピュータ", ["ファミコン", "FC", "Famicom"]),
      entry("スーパーファミコン", ["スーファミ", "SFC", "Super Famicom"]),
      entry("ゲームボーイ", ["GB", "Game Boy"]),
      entry("ゲームボーイアドバンス", ["GBA", "Game Boy Advance"]),
      entry("Nintendo 64", ["N64", "ニンテンドー64"]),
      entry("ニンテンドーDS", ["DS", "Nintendo DS"]),
      entry("メガドライブ", ["Mega Drive", "MD"]),
      entry("セガサターン", ["SS", "Sega Saturn"]),
      entry("ドリームキャスト", ["DC", "Dreamcast"]),
      entry("PlayStation", ["PS", "プレステ", "プレイステーション"]),
      entry("PlayStation 2", ["PS2", "プレステ2", "プレイステーション2"]),
      entry("PlayStation 3", ["PS3"]), entry("PlayStation 4", ["PS4"]), entry("PlayStation 5", ["PS5"]),
      entry("Nintendo Switch", ["Switch", "ニンテンドースイッチ"]), entry("Nintendo Switch 2", ["Switch 2", "SW2", "ニンテンドースイッチ2"]),
      entry("Xbox", []), entry("Xbox 360", []), entry("Xbox One", []), entry("Xbox Series X|S", ["Xbox Series X", "Xbox Series S"]),
      entry("PCエンジン", ["PCE", "PC Engine"])
    ] },
    { id: "maker", name: "メーカー", binding: "publisher", multiple: false, required: false, builtIn: true, entries: [] },
    { id: "series", name: "シリーズ", binding: "series", multiple: false, required: false, builtIn: true, entries: [] },
    { id: "genre", name: "ジャンル", binding: "genres", multiple: true, required: false, builtIn: true, entries: [] },
    { id: "tag", name: "タグ", binding: "tags", multiple: true, required: false, builtIn: true, entries: [] },
    { id: "edition", name: "エディション", binding: "editions", multiple: true, required: false, builtIn: true, entries: [
      entry("通常版"), entry("ソフトのみ"), entry("BEST版"), entry("廉価版")
    ] }
  ];
}
function normalizeEntry(raw) {
  return { id: String(raw?.id || makeId("entry")), name: String(raw?.name || "").trim(), aliases: unique((Array.isArray(raw?.aliases) ? raw.aliases : []).map(x => String(x).trim()).filter(Boolean)), coverUrlTemplate: String(raw?.coverUrlTemplate || "").trim() };
}
function normalizeDictionaries(raw) {
  const defaults = defaultCategories();
  const source = Array.isArray(raw?.categories) ? raw.categories : [];
  const consumed = new Set();
  const categories = defaults.map(def => {
    const foundIndex = source.findIndex(c => c && (c.id === def.id || normalizeName(c.name) === normalizeName(def.name)));
    if (foundIndex < 0) return def;
    consumed.add(foundIndex);
    const found = source[foundIndex];
    return { ...def, id: def.id, name: def.name, binding: def.binding, multiple: def.multiple, required: def.required,
      builtIn: true, entries: Array.isArray(found.entries) ? found.entries.map(normalizeEntry).filter(e => e.name) : def.entries };
  });
  source.forEach((rawCategory, index) => {
    if (consumed.has(index) || !rawCategory || !String(rawCategory.name || "").trim()) return;
    const name = String(rawCategory.name).trim();
    if (categories.some(c => normalizeName(c.name) === normalizeName(name))) return;
    categories.push({ id: String(rawCategory.id || makeId("category")), name, binding: null, multiple: false, required: false, builtIn: false,
      entries: (Array.isArray(rawCategory.entries) ? rawCategory.entries : []).map(normalizeEntry).filter(e => e.name) });
  });
  return { version: 1, categories };
}
function getCategory(id) { return dictionaries.categories.find(c => c.id === id); }
function getCategoryByBinding(binding) { return dictionaries.categories.find(c => c.binding === binding); }
function resolveEntry(category, value) {
  const key = normalizeName(value);
  if (!category || !key) return null;
  return category.entries.find(e => normalizeName(e.name) === key || e.aliases.some(a => normalizeName(a) === key)) || null;
}
function addEntry(category, name, aliases = []) {
  const item = { id: makeId("entry"), name: String(name).trim(), aliases: unique(aliases.map(x => String(x).trim()).filter(x => x && normalizeName(x) !== normalizeName(name))) };
  category.entries.push(item); return item;
}
function canonicalizeValue(categoryId, value, createMissing = true) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const category = getCategory(categoryId);
  if (!category) return text;
  const found = resolveEntry(category, text);
  if (found) return found.name;
  if (createMissing) return addEntry(category, text).name;
  return text;
}
function splitList(value) { return String(value ?? "").split(/[,，、|;；\n\r]+/).map(x => x.trim()).filter(Boolean); }
function canonicalizeGame(game, createMissing = true) {
  game.platform = canonicalizeValue("hardware", game.platform, createMissing);
  game.publisher = canonicalizeValue("maker", game.publisher, createMissing);
  game.series = canonicalizeValue("series", game.series, createMissing);
  game.genres = unique((Array.isArray(game.genres) ? game.genres : splitList(game.genres)).map(x => canonicalizeValue("genre", x, createMissing)).filter(Boolean));
  game.tags = unique((Array.isArray(game.tags) ? game.tags : splitList(game.tags)).map(x => canonicalizeValue("tag", x, createMissing)).filter(Boolean));
  game.editions = unique((Array.isArray(game.editions) ? game.editions : splitList(game.editions)).map(x => canonicalizeValue("edition", x, createMissing)).filter(Boolean));
  const editionCategory = getCategory("edition");
  const newCodes = {};
  Object.entries(game.codes || {}).forEach(([codeEdition, value]) => {
    const formal = canonicalizeValue("edition", codeEdition, createMissing);
    if (formal) newCodes[formal] = value;
  });
  game.codes = newCodes;
  return game;
}
function mergeLegacySeriesAliases(aliasMap) {
  if (!aliasMap || typeof aliasMap !== "object") return;
  const category = getCategory("series");
  Object.entries(aliasMap).forEach(([alias, formal]) => {
    const name = String(formal || "").trim(); const alt = String(alias || "").trim();
    if (!name || !alt || normalizeName(name) === normalizeName(alt)) return;
    let target = resolveEntry(category, name);
    if (!target) target = addEntry(category, name);
    const current = resolveEntry(category, alt);
    if (!current) target.aliases.push(alt);
    else if (current.id === target.id && !target.aliases.some(a => normalizeName(a) === normalizeName(alt))) target.aliases.push(alt);
  });
}
function entryMatchesValue(entryToMatch, value) {
  const key = normalizeName(value);
  return !!key && [entryToMatch.name, ...entryToMatch.aliases].some(x => normalizeName(x) === key);
}
function entryUseCount(category, targetEntry) {
  if (!category?.binding) return 0;
  return games.filter(game => {
    const raw = game[category.binding];
    if (Array.isArray(raw)) return raw.some(value => entryMatchesValue(targetEntry, value));
    if (raw && entryMatchesValue(targetEntry, raw)) return true;
    if (category.binding === "editions" && Object.keys(game.codes || {}).some(k => entryMatchesValue(targetEntry, k))) return true;
    return false;
  }).length;
}
function replaceEntryReferences(category, targetEntry, replacement) {
  if (!category?.binding) return;
  games = games.map(game => {
    const copy = { ...game };
    const field = category.binding;
    if (Array.isArray(copy[field])) {
      copy[field] = replacement === null ? copy[field].filter(v => !entryMatchesValue(targetEntry, v)) : unique(copy[field].map(v => entryMatchesValue(targetEntry, v) ? replacement : v));
    } else if (copy[field] && entryMatchesValue(targetEntry, copy[field])) copy[field] = replacement === null ? "" : replacement;
    if (field === "editions") {
      const updatedCodes = {};
      Object.entries(copy.codes || {}).forEach(([key, val]) => {
        if (entryMatchesValue(targetEntry, key)) { if (replacement !== null) updatedCodes[replacement] = val; }
        else updatedCodes[key] = val;
      });
      copy.codes = updatedCodes;
    }
    copy.updatedAt = new Date().toISOString();
    return copy;
  });
}
function checkCollision(category, name, aliases, ignoreId = "") {
  const proposed = unique([name, ...aliases].map(normalizeName).filter(Boolean));
  for (const other of category.entries) {
    if (other.id === ignoreId) continue;
    const otherKeys = new Set([other.name, ...other.aliases].map(normalizeName).filter(Boolean));
    const collision = proposed.find(key => otherKeys.has(key));
    if (collision) return other.name;
  }
  return null;
}
function parseAliases(text) { return unique(String(text || "").split(/[、,，|\n\r]+/).map(s => s.trim()).filter(Boolean)); }

function editionsSelected() { return [...$("editionOptions").querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value); }
function renderEditionOptions(selectedValues = []) {
  const category = getCategory("edition") || { entries: [] };
  const entries = Array.isArray(category.entries) ? category.entries : [];
  const selected = new Set(selectedValues.map(v => canonicalizeValue("edition", v, false)));
  $("editionOptions").innerHTML = entries.map(item => `<label class="chip"><input type="checkbox" value="${escapeHtml(item.name)}" ${selected.has(item.name) ? "checked" : ""}>${escapeHtml(item.name)}</label>`).join("");
}
function renderCodeFields(existing = {}) {
  const selected = editionsSelected(); const box = $("editionCodes");
  if (!selected.length) { box.innerHTML = '<small class="muted">エディションを選択すると入力欄が表示されます。</small>'; return; }
  box.innerHTML = selected.map(ed => `<label class="code-row"><span>${escapeHtml(ed)}</span><input data-code-edition="${escapeHtml(ed)}" value="${escapeHtml(existing[ed] || "")}" placeholder="品番（任意）"></label>`).join("");
}
$("editionOptions").addEventListener("change", () => {
  const old = {}; $("editionCodes").querySelectorAll("[data-code-edition]").forEach(input => old[input.dataset.codeEdition] = input.value);
  renderCodeFields(old);
});
$("addEditionBtn").addEventListener("click", async () => {
  const value = $("customEdition").value.trim(); if (!value) return;
  const category = getCategory("edition"); let item = resolveEntry(category, value);
  if (!item) { item = addEntry(category, value); if (!await persistDictionaries()) { category.entries = category.entries.filter(x => x.id !== item.id); return; } }
  const old = {}; $("editionCodes").querySelectorAll("[data-code-edition]").forEach(input => old[input.dataset.codeEdition] = input.value);
  renderEditionOptions(unique([...editionsSelected(), item.name])); $("customEdition").value = ""; renderCodeFields(old); updateDatalists();
});
$("customEdition").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("addEditionBtn").click(); } });

function updateDatalists() {
  const links = [["hardware", "platformOptions"], ["maker", "publisherOptions"], ["series", "seriesOptions"], ["genre", "genreOptions"], ["tag", "tagOptions"]];
  links.forEach(([categoryId, listId]) => {
    const list = $(listId); const category = getCategory(categoryId);
    if (list && category) list.innerHTML = category.entries.map(item => `<option value="${escapeHtml(item.name)}">`).join("");
  });
}
function normalizeSearchText(value) {
  let text = String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja");
  // カタカナをひらがなへ統一し、全角・半角や空白・記号の違いを吸収する。
  text = [...text].map(ch => { const cp = ch.codePointAt(0); return cp >= 0x30A1 && cp <= 0x30F6 ? String.fromCodePoint(cp - 0x60) : ch; }).join("");
  return text.replace(/[\s\p{P}\p{S}]+/gu, "");
}
function searchVariants(categoryId, value) {
  const variants = [String(value ?? "")];
  const category = getCategory(categoryId);
  const found = category && resolveEntry(category, String(value ?? ""));
  if (found) variants.push(found.name, ...(found.aliases || []));
  return variants;
}
async function saveCollectionView() {
  // Persist the sort preference only; transient search and filter selections reset on reload.
  return writeStored(COLLECTION_VIEW_KEY, { sort: $("sortSelect")?.value || "title-asc" });
}
function gameMatchesSearch(game, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  const values = [
    ...searchVariants("hardware", game.platform), ...searchVariants("maker", game.publisher),
    ...(game.editions || []).flatMap(value => searchVariants("edition", value)),
    ...Object.values(game.codes || {}), game.title, game.series, ...(game.genres || []), ...(game.tags || []), game.notes,
    game.releaseDate, game.releaseDate ? game.releaseDate.replace(/-/g, "/") : "",
    game.clearStatus === "cleared" ? "クリア済み クリア済 クリア" : "未クリア 未プレイ",
    game.preorder ? "予約済み 予約済 予約 preorder preordered" : "予約していない 未予約"
  ];
  const expanded = [...values];
  [ ["series", game.series], ...(game.genres || []).map(v => ["genre", v]), ...(game.tags || []).map(v => ["tag", v]) ].forEach(([categoryId, value]) => expanded.push(...searchVariants(categoryId, value)));
  return expanded.some(value => normalizeSearchText(value).includes(needle));
}
function isGameReleased(game) {
  if (!game.releaseDate) return false;
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  return game.releaseDate <= todayLocal;
}
function gameMatchesFilters(game, ignorePlatform = false) {
  const f = activeFilters;
  const released = isGameReleased(game);
  // By default the collection represents owned/released titles only. Upcoming or undated titles appear only when a preorder filter is explicitly selected.
  if (!released && !f.preorder.length) return false;
  if (!ignorePlatform && f.platform.length && !f.platform.includes(game.platform || "ハード未設定")) return false;
  if (f.publisher.length && !f.publisher.includes(game.publisher || "メーカー未設定")) return false;
  if (f.edition.length && !(game.editions || []).some(x => f.edition.includes(x))) return false;
  if (f.title.length && !f.title.includes(game.title)) return false;
  if (f.code.length && !Object.values(game.codes || {}).some(value => f.code.includes(value))) return false;
  if (f.series.length && !f.series.includes(game.series)) return false;
  if (f.genre.length && !(game.genres || []).some(x => f.genre.includes(x))) return false;
  if (f.releaseDate.length) {
    const from = f.releaseDate[0] || "";
    const to = f.releaseDate[1] || "";
    if (!game.releaseDate || (from && game.releaseDate < from) || (to && game.releaseDate > to)) return false;
  }
  // 未発売・発売日未設定タイトルを「未クリア」に含めない。
  if (f.clearStatus.length && (!released || !f.clearStatus.includes(game.clearStatus === "cleared" ? "cleared" : "unplayed"))) return false;
  // 「未予約」は未発売タイトルだけを対象にする。発売済みタイトルは含めない。
  if (f.preorder.length && (released || !f.preorder.includes(game.preorder ? "yes" : "no"))) return false;
  return true;
}
function getVisibleGames() {
  const query = ($("searchInput")?.value || "").trim();
  const sort = $("sortSelect")?.value || "title-asc";
  const visible = games.filter(game => gameMatchesSearch(game, query) && gameMatchesFilters(game));
  const titleCmp = (a,b) => (a.title || "").localeCompare(b.title || "", "ja", { numeric: true, sensitivity: "base" });
  const platformOrder = new Map((getCategory("hardware")?.entries || []).map((entry, index) => [normalizeName(entry.name), index]));
  const seriesOrder = new Map((getCategory("series")?.entries || []).map((entry, index) => [normalizeName(entry.name), index]));
  visible.sort((a,b) => {
    if (sort === "title-desc") return titleCmp(b,a);
    if (sort === "platform") return (platformOrder.get(normalizeName(a.platform)) ?? 999999) - (platformOrder.get(normalizeName(b.platform)) ?? 999999) || titleCmp(a,b);
    if (sort === "series") return (seriesOrder.get(normalizeName(a.series)) ?? 999999) - (seriesOrder.get(normalizeName(b.series)) ?? 999999) || titleCmp(a,b);
    if (sort === "recent") return String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || titleCmp(a,b);
    if (sort === "updated") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || titleCmp(a,b);
    if (sort === "release-asc") return (a.releaseDate || "9999-99-99").localeCompare(b.releaseDate || "9999-99-99") || titleCmp(a,b);
    if (sort === "release-desc") return (b.releaseDate || "0000-00-00").localeCompare(a.releaseDate || "0000-00-00") || titleCmp(a,b);
    return titleCmp(a,b);
  });
  return visible;
}
function render() {
  const grid = $("gameGrid");
  const visibleGames = getVisibleGames();
  $("gameCount").textContent = games.filter(isGameReleased).length;
  $("gameCountLabel").textContent = "所持タイトル数";
  const hardwareCounts = new Map();
  const queryForHardware = ($("searchInput")?.value || "").trim();
  // Hardware chips stay available for multi-select; counts honor search and other filters but not the platform filter itself.
  games.filter(game => gameMatchesSearch(game, queryForHardware) && gameMatchesFilters(game, true)).forEach(game => {
    const platform = game.platform || "ハード未設定";
    hardwareCounts.set(platform, (hardwareCounts.get(platform) || 0) + 1);
  });
  const platformOrderForCounts = new Map((getCategory("hardware")?.entries || []).map((entry, index) => [normalizeName(entry.name), index]));
  $("hardwareCounts").innerHTML = [...hardwareCounts.entries()].sort((a,b) => (platformOrderForCounts.get(normalizeName(a[0])) ?? 999999) - (platformOrderForCounts.get(normalizeName(b[0])) ?? 999999) || a[0].localeCompare(b[0], "ja")).map(([name,count]) => {
    const active = activeFilters.platform.includes(name) ? " is-active" : "";
    return `<button type="button" class="hardware-count${active}" data-platform-filter="${escapeHtml(name)}" aria-pressed="${active ? "true" : "false"}"><span>${escapeHtml(name)}</span><strong>${count}</strong></button>`;
  }).join("") || '<span class="muted">該当ハードなし</span>';
  $("hardwareCounts").querySelectorAll("[data-platform-filter]").forEach(button => button.addEventListener("click", () => {
    const platform = button.dataset.platformFilter;
    activeFilters.platform = activeFilters.platform.includes(platform) ? activeFilters.platform.filter(value => value !== platform) : [...activeFilters.platform, platform];
    render(); saveCollectionView();
  }));
  updateDatalists();
  $("visibleCount").textContent = `ヒット数 ${visibleGames.length}件`;
  const activeFilterCount = Object.entries(activeFilters).reduce((sum, [key, values]) => sum + (key === "releaseDate" ? values.filter(Boolean).length : values.length), 0);
  $("filterBadge").textContent = activeFilterCount ? String(activeFilterCount) : "";
  $("filterBadge").hidden = activeFilterCount === 0;
  if (!games.length) {
    $("emptyHint").hidden = false;
    $("emptyHint").textContent = "箱絵を登録して並べよう";
    grid.innerHTML = '<div class="empty-state"><b>コレクションはまだ空です</b>最初のゲームを登録して、箱絵を並べてみましょう。<br><br><button class="primary" onclick="openNewGame()">＋ 最初のゲームを登録</button></div>'; return;
  }
  if (!visibleGames.length) {
    $("emptyHint").hidden = false;
    $("emptyHint").textContent = "検索・絞り込み条件に一致するタイトルがありません。";
    grid.innerHTML = '<div class="empty-state"><b>該当するタイトルがありません</b>検索語や絞り込み条件を変更してください。</div>'; return;
  }
  $("emptyHint").hidden = true;
  const fields = new Set(displaySettings.fields || DEFAULT_DISPLAY_SETTINGS.fields);
  grid.innerHTML = visibleGames.map(game => {
    const dim = displaySettings.dimCleared && game.clearStatus === "cleared" ? " is-cleared" : "";
    const meta = [];
    if (fields.has("publisher") && game.publisher) meta.push(game.publisher);
    if (fields.has("clearStatus")) meta.push(game.clearStatus === "cleared" ? "クリア済み" : "未クリア");
    const tags = [];
    if (fields.has("editions")) tags.push(...(game.editions || []).slice(0,2));
    if (fields.has("series") && game.series) tags.push(game.series);
    if (fields.has("genres")) tags.push(...(game.genres || []).slice(0,2));
    if (fields.has("tags")) tags.push(...(game.tags || []).slice(0,2));
    if (fields.has("codes")) tags.push(...Object.values(game.codes || {}).filter(Boolean).slice(0,1));
    const showTitle = fields.has("title"), showPlatform = fields.has("platform");
    const coverClasses = `cover${displaySettings.coverBorder !== false ? " cover-bordered" : ""}${displaySettings.coverRounded !== false ? " cover-rounded" : ""}`;
    return `<article class="game-card${dim}" data-open="${escapeHtml(game.id)}" tabindex="0" role="button" aria-label="${escapeHtml(game.title)}の詳細"><div class="${coverClasses}">${game.cover ? `<img src="${game.cover}" alt="${escapeHtml(game.title)}の表ジャケット" loading="lazy">` : '<div class="no-cover">画像なし</div>'}</div>${showTitle ? `<div class="game-title">${escapeHtml(game.title)}</div>` : ""}${showPlatform || meta.length ? `<div class="game-meta">${showPlatform ? escapeHtml(game.platform) : ""}${meta.length ? (showPlatform ? " · " : "") + escapeHtml(meta.join(" · ")) : ""}</div>` : ""}${tags.length ? `<div>${tags.map(tag => `<span class="mini-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</article>`;
  }).join("");
  grid.querySelectorAll("[data-open]").forEach(el => {
    const go = () => openDetail(el.dataset.open);
    el.addEventListener("click", go);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}
function renderFilterGroups() {
  if (activeFilters.clearStatus.length) activeFilters.preorder = [];
  if (activeFilters.preorder.length) activeFilters.clearStatus = [];
  activeFilters.clearStatus = activeFilters.clearStatus.slice(0, 1);
  activeFilters.preorder = activeFilters.preorder.slice(0, 1);
  const uniqueValues = values => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b, "ja"));
  const groups = [
    ["platform", "ハード", uniqueValues(games.map(g => g.platform || "ハード未設定"))],
    ["publisher", "メーカー", uniqueValues(games.map(g => g.publisher || "メーカー未設定"))],
    ["edition", "エディション", uniqueValues(games.flatMap(g => g.editions || []))],
    ["series", "シリーズ", uniqueValues(games.map(g => g.series))],
    ["genre", "ジャンル", uniqueValues(games.flatMap(g => g.genres || []))],
    ["clearStatus", "クリア状況", [["unplayed", "未クリア"], ["cleared", "クリア済み"]]],
    ["preorder", "予約状況", [["yes", "予約済み"], ["no", "未予約"]]]
  ];
  const dateRange = `<section class="filter-group date-range-group" data-filter-group="releaseDate"><h3>発売日</h3><div class="date-range-fields"><label>開始日<input id="filterReleaseFrom" type="date" value="${escapeHtml(activeFilters.releaseDate[0] || "")}"></label><span aria-hidden="true">〜</span><label>終了日<input id="filterReleaseTo" type="date" value="${escapeHtml(activeFilters.releaseDate[1] || "")}"></label></div><p class="small muted">片方だけでも指定できます。</p></section>`;
  const groupMarkup = groups.map(([key, label, values]) => `<section class="filter-group" data-filter-group="${key}"><h3>${escapeHtml(label)}</h3><div class="filter-options">${values.map(item => { const value = Array.isArray(item) ? item[0] : item; const text = Array.isArray(item) ? item[1] : item; const checked = activeFilters[key].includes(value) ? " checked" : ""; return `<label class="filter-option"><input type="checkbox" data-filter-category="${key}" value="${escapeHtml(value)}"${checked}><span>${escapeHtml(text)}</span></label>`; }).join("") || '<span class="muted small">選択肢がありません</span>'}</div></section>`).join("");
  $("filterGroups").innerHTML = groupMarkup.replace('<section class="filter-group" data-filter-group="clearStatus">', dateRange + '<section class="filter-group" data-filter-group="clearStatus">');
  const syncStatusFilterChoices = () => {
    const clearSelected = [...$("filterGroups").querySelectorAll('[data-filter-category="clearStatus"]')].some(input => input.checked);
    const preorderSelected = [...$("filterGroups").querySelectorAll('[data-filter-category="preorder"]')].some(input => input.checked);
    $("filterGroups").querySelectorAll('[data-filter-category="clearStatus"]').forEach(input => { input.disabled = preorderSelected && !input.checked; });
    $("filterGroups").querySelectorAll('[data-filter-category="preorder"]').forEach(input => { input.disabled = clearSelected && !input.checked; });
  };
  $("filterGroups").querySelectorAll('[data-filter-category="clearStatus"], [data-filter-category="preorder"]').forEach(input => input.addEventListener("change", () => {
    const category = input.dataset.filterCategory;
    if (input.checked) {
      $("filterGroups").querySelectorAll(`[data-filter-category="${category}"]`).forEach(other => { if (other !== input) other.checked = false; });
      const otherCategory = category === "clearStatus" ? "preorder" : "clearStatus";
      $("filterGroups").querySelectorAll(`[data-filter-category="${otherCategory}"]`).forEach(other => { other.checked = false; });
    }
    syncStatusFilterChoices();
  }));
  syncStatusFilterChoices();
}
$("searchInput").addEventListener("input", () => { render(); saveCollectionView(); });
$("sortSelect").addEventListener("change", () => { render(); saveCollectionView(); });
$("filterBtn").addEventListener("click", () => { renderFilterGroups(); $("filterDialog").showModal(); });
$("closeFilter").addEventListener("click", () => $("filterDialog").close());
$("applyFilters").addEventListener("click", () => {
  const next = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
  $("filterGroups").querySelectorAll("input[data-filter-category]:checked").forEach(input => next[input.dataset.filterCategory].push(input.value));
  const dateFrom = $("filterReleaseFrom")?.value || "";
  const dateTo = $("filterReleaseTo")?.value || "";
  if (dateFrom && dateTo && dateFrom > dateTo) { alert("発売日の開始日は終了日以前の日付にしてください。"); return; }
  next.releaseDate = (dateFrom || dateTo) ? [dateFrom, dateTo] : [];
  if (next.clearStatus.length) next.preorder = [];
  if (next.preorder.length) next.clearStatus = [];
  next.clearStatus = next.clearStatus.slice(0, 1); next.preorder = next.preorder.slice(0, 1);
  activeFilters = next; $("filterDialog").close(); render(); saveCollectionView();
});
$("clearFilters").addEventListener("click", () => {
  activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
  $("filterGroups").querySelectorAll("input[data-filter-category]").forEach(input => { input.checked = false; });
  if ($("filterReleaseFrom")) $("filterReleaseFrom").value = "";
  if ($("filterReleaseTo")) $("filterReleaseTo").value = "";
  render(); saveCollectionView();
});

function openNewGame() { resetForm(); $("formTitle").textContent = "ゲームを登録"; $("gameDialog").showModal(); }
function updateReleaseStatusFields() {
  const releaseDate = $("releaseDate").value;
  const today = new Date();
  const todayLocal = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const released = Boolean(releaseDate && releaseDate <= todayLocal);
  $("clearStatusField").hidden = !released;
  $("preorderStatusField").hidden = released;
  if (released) $("preorderStatus").checked = false;
  else { $("clearStatus").value = "unplayed"; }
  $("preorderStatusField").classList.toggle("status-control-active", !released);
  $("clearStatusField").classList.toggle("status-control-active", released);
}
$("releaseDate").addEventListener("change", updateReleaseStatusFields);

function resetForm() {
  $("gameForm").reset(); $("gameId").value = ""; currentCover = ""; $("coverPreview").hidden = true; $("coverPreview").src = ""; $("coverPlaceholder").hidden = false; $("formError").textContent = "";
  renderEditionOptions([]); renderCodeFields(); $("coverUrl").value = ""; $("clearStatus").value = "unplayed"; $("releaseDate").value = ""; $("preorderStatus").checked = false; updateReleaseStatusFields();
}
$("addBtn").addEventListener("click", openNewGame);
$("closeGame").addEventListener("click", () => $("gameDialog").close());
$("cancelGame").addEventListener("click", () => $("gameDialog").close());
$("coverInput").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("画像ファイルを選択してください"); return; }
  try { currentCover = await resizeImage(file, 900, 0.82); $("coverPreview").src = currentCover; $("coverPreview").hidden = false; $("coverPlaceholder").hidden = true; }
  catch (_) { showToast("画像を読み込めませんでした"); }
});
function resizeImage(file, maxEdge = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject;
    reader.onload = () => {
      const image = new Image(); image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function openTitleImageSearch() {
  const title = $("title").value.trim(), platform = $("platform").value.trim();
  const query = [title, platform, "ゲーム パッケージ 表紙"].filter(Boolean).join(" ");
  if (!title || !platform) { showToast("タイトルとハードを入力してください"); return; }
  window.open("https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(query), "_blank", "noopener");
}
$("searchCoverBtn").addEventListener("click", openTitleImageSearch);
function getCoverTemplateForPlatform(platform) {
  const category = getCategory("hardware");
  const entry = resolveEntry(category, platform);
  return entry?.coverUrlTemplate || "";
}
function makeCoverUrl(template, code, title, platform) {
  return template.replace(/\$\{serial\}/g, encodeURIComponent(code)).replace(/\$\{code\}/g, encodeURIComponent(code)).replace(/\$\{title\}/g, encodeURIComponent(title)).replace(/\$\{platform\}/g, encodeURIComponent(platform));
}
function probeImage(url) {
  return new Promise(resolve => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = url; });
}
function applyCoverUrl(url) {
  currentCover = url; $("coverUrl").value = url; $("coverPreview").src = url; $("coverPreview").hidden = false; $("coverPlaceholder").hidden = true;
}
$("useCoverUrl").addEventListener("click", async () => {
  const url = $("coverUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) { showToast("http:// または https:// から始まる画像URLを入力してください"); return; }
  if (await probeImage(url)) { applyCoverUrl(url); showToast("画像URLを適用しました"); }
  else showToast("画像を表示できません。画像ファイルのURLか確認してください");
});
$("lookupCodeCoverBtn").addEventListener("click", async () => {
  const title = $("title").value.trim(), platform = $("platform").value.trim();
  const codes = [...$("editionCodes").querySelectorAll("[data-code-edition]")].map(input => input.value.trim()).filter(Boolean);
  const templateForPlatform = getCoverTemplateForPlatform(platform);
  // Open a window synchronously so the title-search fallback is not blocked after image checks finish.
  const fallbackTab = window.open("about:blank", "_blank");
  const fallback = () => {
    const query = [title, platform, "ゲーム パッケージ 表紙"].filter(Boolean).join(" ");
    if (fallbackTab && !fallbackTab.closed) fallbackTab.location.href = "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(query);
    else openTitleImageSearch();
    showToast("品番画像が見つからないため、タイトル＋ハードで画像検索を開きました");
  };
  if (!title || !platform) { if (fallbackTab) fallbackTab.close(); showToast("先にタイトルとハードを入力してください"); return; }
  if (!codes.length || !templateForPlatform) { fallback(); return; }
  for (const code of codes) {
    const url = makeCoverUrl(templateForPlatform, code, title, platform);
    if (await probeImage(url)) {
      applyCoverUrl(url); if (fallbackTab && !fallbackTab.closed) fallbackTab.close();
      showToast(`品番「${code}」からジャケットを取得しました`); return;
    }
  }
  fallback();
});

function detailFilterTerm(category, value, displayValue = value) {
  const text = String(value ?? "").trim();
  if (!text) return escapeHtml(displayValue ?? "");
  return `<button type="button" class="detail-filter-term" data-detail-filter="${escapeHtml(category)}" data-filter-value="${escapeHtml(text)}" aria-label="${escapeHtml(displayValue ?? text)}で絞り込み">${escapeHtml(displayValue ?? text)}</button>`;
}
function detailFilterTerms(category, values, separator = "、", display = value => value) {
  return values.filter(value => String(value ?? "").trim()).map(value => detailFilterTerm(category, value, display(value))).join(escapeHtml(separator));
}
function detailTagTerm(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<button type="button" class="detail-tag-search" data-detail-search="${escapeHtml(text)}" aria-label="タグ「${escapeHtml(text)}」で検索">#${escapeHtml(text.replace(/^#+/, ""))}</button>`;
}
function openDetail(id) {
  const game = games.find(item => item.id === id); if (!game) return; activeDetailId = id;
  const detailCoverClasses = `detail-cover${displaySettings.coverBorder !== false ? " cover-bordered" : ""}${displaySettings.coverRounded !== false ? " cover-rounded" : ""}`;
  const image = game.cover ? `<img class="${detailCoverClasses}" src="${game.cover}" alt="${escapeHtml(game.title)}の表ジャケット">` : `<div class="${detailCoverClasses} empty">画像なし</div>`;
  const rows = [];
  if (game.publisher) rows.push(["メーカー", detailFilterTerm("publisher", game.publisher)]);
  if ((game.editions || []).length) rows.push(["エディション", detailFilterTerms("edition", game.editions)]);
  const codeEntries = Object.entries(game.codes || {}).filter(([, value]) => value);
  const codes = codeEntries.map(([key, value]) => {
    const label = (game.editions || []).length <= 1 ? "" : `${escapeHtml(key)}: `;
    return `${label}${detailFilterTerm("code", value)}`;
  }).join(" / ");
  if (codes) rows.push(["品番", codes]);
  if (game.series) rows.push(["シリーズ", detailFilterTerm("series", game.series)]);
  if ((game.genres || []).length) rows.push(["ジャンル", detailFilterTerms("genre", game.genres)]);
  if (game.releaseDate) rows.push(["発売日", detailFilterTerm("releaseDate", game.releaseDate)]);
  if ((game.tags || []).length) rows.push(["タグ", game.tags.map(detailTagTerm).join(" ")]);
  if (game.notes) rows.push(["メモ", escapeHtml(game.notes)]);
  const released = isGameReleased(game);
  const statusText = released ? (game.clearStatus === "cleared" ? "クリア済み" : "未クリア") : (game.preorder ? "予約済み" : "未予約");
  const statusCategory = released ? "clearStatus" : "preorder";
  const statusValue = released ? (game.clearStatus === "cleared" ? "cleared" : "unplayed") : (game.preorder ? "yes" : "no");
  $("detailContent").innerHTML = `${image}<h3 class="detail-title">${detailFilterTerm("title", game.title)}</h3><div class="detail-platform-row"><button type="button" class="detail-platform detail-filter-term" data-detail-filter="platform" data-filter-value="${escapeHtml(game.platform)}" aria-label="${escapeHtml(game.platform)}で絞り込み">${escapeHtml(game.platform)}</button><button type="button" class="detail-status detail-filter-term" data-detail-filter="${statusCategory}" data-filter-value="${statusValue}" aria-label="${escapeHtml(statusText)}で絞り込み">${escapeHtml(statusText)}</button></div><dl class="detail-list">${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${value || ""}</dd>`).join("")}</dl>`;
  $("detailDialog").showModal();
}
$("detailContent").addEventListener("click", event => {
  const tagTarget = event.target.closest("[data-detail-search]");
  if (tagTarget) {
    $("searchInput").value = tagTarget.dataset.detailSearch || "";
    activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
    $("detailDialog").close(); render(); $("searchInput").focus(); return;
  }
  const filterTarget = event.target.closest("[data-detail-filter]");
  if (!filterTarget) return;
  const category = filterTarget.dataset.detailFilter;
  const value = filterTarget.dataset.filterValue || "";
  activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
  if (Object.prototype.hasOwnProperty.call(activeFilters, category)) activeFilters[category] = category === "releaseDate" ? [value, value] : [value];
  $("searchInput").value = "";
  $("detailDialog").close(); render();
});
$("closeDetail").addEventListener("click", () => $("detailDialog").close());
$("editGame").addEventListener("click", () => { const game = games.find(item => item.id === activeDetailId); if (!game) return; $("detailDialog").close(); fillForm(game); $("formTitle").textContent = "ゲームを編集"; $("gameDialog").showModal(); });
function fillForm(game) {
  resetForm(); $("gameId").value = game.id; $("title").value = game.title || ""; $("platform").value = game.platform || ""; $("publisher").value = game.publisher || ""; $("series").value = game.series || "";
  $("genres").value = (game.genres || []).join(", "); $("tags").value = (game.tags || []).join(", "); $("notes").value = game.notes || ""; $("clearStatus").value = game.clearStatus === "cleared" ? "cleared" : "unplayed"; $("releaseDate").value = game.releaseDate || ""; $("preorderStatus").checked = game.preorder === true;
  currentCover = game.cover || ""; $("coverUrl").value = /^https?:\/\//i.test(currentCover) ? currentCover : "";
  if (currentCover) { $("coverPreview").src = currentCover; $("coverPreview").hidden = false; $("coverPlaceholder").hidden = true; }
  (game.editions || []).forEach(ed => canonicalizeValue("edition", ed, true));
  renderEditionOptions(game.editions || []); renderCodeFields(game.codes || {});
  $("editionCodes").querySelectorAll("[data-code-edition]").forEach(input => input.value = (game.codes || {})[input.dataset.codeEdition] || "");
  updateReleaseStatusFields();
}
$("deleteGame").addEventListener("click", async () => {
  const game = games.find(item => item.id === activeDetailId); if (!game) return;
  if (confirm(`「${game.title}」を削除しますか？`)) { games = games.filter(item => item.id !== activeDetailId); await persist(); $("detailDialog").close(); showToast("削除しました"); }
});
$("gameForm").addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("title").value.trim(), platform = $("platform").value.trim();
  if (!title || !platform) { $("formError").textContent = "タイトルとハードを入力してください。"; return; }
  const codes = {}; $("editionCodes").querySelectorAll("[data-code-edition]").forEach(input => { if (input.value.trim()) codes[input.dataset.codeEdition] = input.value.trim(); });
  const id = $("gameId").value || makeId("game"); const old = games.find(game => game.id === id);
  let item = { id, title, platform, publisher: $("publisher").value.trim(), editions: editionsSelected(), codes, series: $("series").value.trim(), genres: splitList($("genres").value), tags: splitList($("tags").value), notes: $("notes").value.trim(), releaseDate: $("releaseDate").value || "", preorder: $("preorderStatus").checked, clearStatus: $("clearStatus").value === "cleared" ? "cleared" : "unplayed", cover: currentCover, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  item = canonicalizeGame(item, true);
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  if (item.releaseDate && item.releaseDate <= todayLocal) item.preorder = false;
  else item.clearStatus = "unplayed";
  const nextGames = old ? games.map(game => game.id === id ? item : game) : [...games, item];
  const dictSaved = await persistDictionaries();
  if (!dictSaved) { $("formError").textContent = "辞書の保存に失敗しました。保存領域を確認してください。"; return; }
  games = nextGames;
  if (await persist()) { $("gameDialog").close(); $("coverInput").value = ""; showToast(old ? "変更を保存しました" : "ゲームを登録しました。入力した新しい名称は辞書にも追加しました"); }
});

// Master dictionary manager
function currentDictionaryCategory() { return getCategory(activeDictionaryCategoryId) || dictionaries.categories[0]; }
function renderDictionaryCategories() {
  const select = $("dictCategorySelect");
  select.innerHTML = dictionaries.categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}${category.builtIn ? "" : "（自由追加）"}</option>`).join("");
  if (!getCategory(activeDictionaryCategoryId)) activeDictionaryCategoryId = dictionaries.categories[0]?.id || "hardware";
  select.value = activeDictionaryCategoryId;
  const category = currentDictionaryCategory();
  $("renameDictionaryCategory").hidden = !category || category.builtIn;
  $("deleteDictionaryCategory").hidden = !category || category.builtIn;
  renderDictionaryEntries();
}
function renderDictionaryEntries() {
  const category = currentDictionaryCategory(); const list = $("dictEntryList");
  if (!category) { list.innerHTML = '<p class="muted">辞書の種類を選択してください。</p>'; return; }
  if (!category.entries.length) { list.innerHTML = '<div class="dict-empty">項目はまだありません。右上の「項目を追加」から登録できます。</div>'; return; }
  list.innerHTML = category.entries.map(item => {
    const uses = entryUseCount(category, item);
    return `<article class="dict-entry"><div class="dict-entry-text"><strong>${escapeHtml(item.name)}</strong><span class="dict-aliases">別名：${item.aliases.length ? escapeHtml(item.aliases.join("、")) : "なし"}</span><span class="dict-usage">${category.binding ? `ゲームで使用中：${uses}件` : "独立した辞書項目"}</span>${category.id === "hardware" && item.coverUrlTemplate ? '<span class="dict-usage">ジャケットURL設定済み</span>' : ''}</div><div class="dict-entry-actions"><button type="button" class="quiet" data-move-entry="${escapeHtml(item.id)}" data-direction="-1" aria-label="${escapeHtml(item.name)}を上へ" ${category.entries[0]?.id === item.id ? "disabled" : ""}>↑</button><button type="button" class="quiet" data-move-entry="${escapeHtml(item.id)}" data-direction="1" aria-label="${escapeHtml(item.name)}を下へ" ${category.entries.at(-1)?.id === item.id ? "disabled" : ""}>↓</button><button type="button" class="quiet" data-edit-entry="${escapeHtml(item.id)}">編集</button><button type="button" class="quiet" data-delete-entry="${escapeHtml(item.id)}">削除</button></div></article>`;
  }).join("");
  list.querySelectorAll("[data-edit-entry]").forEach(button => button.addEventListener("click", () => {
    const item = category.entries.find(e => e.id === button.dataset.editEntry); if (item) showDictionaryEntryEditor(item);
  }));
  list.querySelectorAll("[data-delete-entry]").forEach(button => button.addEventListener("click", () => {
    const item = category.entries.find(e => e.id === button.dataset.deleteEntry); if (item) openDictionaryDelete(category, item);
  }));
  list.querySelectorAll("[data-move-entry]").forEach(button => button.addEventListener("click", async () => {
    const index = category.entries.findIndex(e => e.id === button.dataset.moveEntry);
    const target = index + Number(button.dataset.direction);
    if (index < 0 || target < 0 || target >= category.entries.length) return;
    [category.entries[index], category.entries[target]] = [category.entries[target], category.entries[index]];
    if (await persistDictionaries()) { renderDictionaryEntries(); updateDatalists(); render(); showToast("表示順を保存しました"); }
  }));
}
function showDictionaryEntryEditor(item = null) {
  $("dictEntryEditor").hidden = false; $("dictEntryId").value = item?.id || ""; $("dictEditorHeading").textContent = item ? "辞書項目を編集" : "辞書項目を追加";
  $("dictEntryName").value = item?.name || ""; $("dictEntryAliases").value = (item?.aliases || []).join("、"); $("dictEntryError").textContent = "";
  const isHardware = currentDictionaryCategory()?.id === "hardware";
  $("hardwareCoverUrlField").hidden = !isHardware;
  $("dictEntryCoverUrl").value = isHardware ? (item?.coverUrlTemplate || "") : "";
  $("dictEntryName").focus();
}
function hideDictionaryEntryEditor() { $("dictEntryEditor").hidden = true; $("dictEntryId").value = ""; $("dictEntryName").value = ""; $("dictEntryAliases").value = ""; $("dictEntryCoverUrl").value = ""; $("hardwareCoverUrlField").hidden = true; $("dictEntryError").textContent = ""; }
$("openDictionary").addEventListener("click", () => { renderDictionaryCategories(); $("dictionaryDialog").showModal(); });
$("closeDictionary").addEventListener("click", () => $("dictionaryDialog").close());
$("closeDictionaryBottom").addEventListener("click", () => $("dictionaryDialog").close());
$("dictCategorySelect").addEventListener("change", () => { activeDictionaryCategoryId = $("dictCategorySelect").value; hideDictionaryEntryEditor(); renderDictionaryCategories(); });
$("newDictionaryEntry").addEventListener("click", () => showDictionaryEntryEditor());
$("cancelDictionaryEntry").addEventListener("click", hideDictionaryEntryEditor);
$("saveDictionaryEntry").addEventListener("click", async () => {
  const category = currentDictionaryCategory(); if (!category) return;
  const name = $("dictEntryName").value.trim(); let aliases = parseAliases($("dictEntryAliases").value);
  const id = $("dictEntryId").value; const existing = category.entries.find(item => item.id === id);
  if (!name) { $("dictEntryError").textContent = "正式名称を入力してください。"; return; }
  if (existing && normalizeName(existing.name) !== normalizeName(name) && !aliases.some(a => normalizeName(a) === normalizeName(existing.name))) aliases.unshift(existing.name);
  aliases = unique(aliases.filter(alias => normalizeName(alias) !== normalizeName(name)));
  const collision = checkCollision(category, name, aliases, id);
  if (collision) { $("dictEntryError").textContent = `「${collision}」の正式名称または別名と重複しています。別名を修正してください。`; return; }
  const coverUrlTemplate = category.id === "hardware" ? $("dictEntryCoverUrl").value.trim() : (existing?.coverUrlTemplate || "");
  if (coverUrlTemplate && (!/^https?:\/\//i.test(coverUrlTemplate) || !/\$\{(serial|code|title|platform)\}/.test(coverUrlTemplate))) { $("dictEntryError").textContent = "URLには http(s) と ${serial} などの変数を含めてください。"; return; }
  if (existing) {
    const oldSnapshot = { ...existing, aliases: [...existing.aliases] };
    if (existing.name !== name) replaceEntryReferences(category, oldSnapshot, name);
    existing.name = name; existing.aliases = aliases;
    if (category.id === "hardware") existing.coverUrlTemplate = coverUrlTemplate;
  } else category.entries.push({ id: makeId("entry"), name, aliases, ...(category.id === "hardware" ? { coverUrlTemplate } : {}) });
  if (!await persistDictionaries()) return;
  if (!await persist()) return;
  hideDictionaryEntryEditor(); renderDictionaryCategories(); showToast(existing ? "辞書項目を更新しました" : "辞書項目を追加しました");
});
$("addDictionaryCategory").addEventListener("click", async () => {
  const name = $("newDictionaryCategory").value.trim(); if (!name) { showToast("追加する辞書の種類名を入力してください"); return; }
  if (dictionaries.categories.some(category => normalizeName(category.name) === normalizeName(name))) { showToast("同じ名前の辞書がすでにあります"); return; }
  const category = { id: makeId("category"), name, binding: null, multiple: false, required: false, builtIn: false, entries: [] };
  dictionaries.categories.push(category); activeDictionaryCategoryId = category.id; $("newDictionaryCategory").value = "";
  if (await persistDictionaries()) { renderDictionaryCategories(); showToast(`「${name}」辞書を追加しました`); }
});
$("newDictionaryCategory").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $("addDictionaryCategory").click(); } });
$("renameDictionaryCategory").addEventListener("click", async () => {
  const category = currentDictionaryCategory(); if (!category || category.builtIn) return;
  const name = prompt("新しい辞書の種類名を入力してください", category.name); if (name === null) return;
  const trimmed = name.trim(); if (!trimmed) { showToast("辞書の種類名は空にできません"); return; }
  if (dictionaries.categories.some(other => other.id !== category.id && normalizeName(other.name) === normalizeName(trimmed))) { showToast("同じ名前の辞書がすでにあります"); return; }
  category.name = trimmed;
  if (await persistDictionaries()) { renderDictionaryCategories(); showToast("辞書の種類名を変更しました"); }
});
$("deleteDictionaryCategory").addEventListener("click", async () => {
  const category = currentDictionaryCategory(); if (!category || category.builtIn) return;
  const message = `「${category.name}」辞書を削除しますか？\n登録項目 ${category.entries.length}件も削除されます。この種類はゲーム登録フォームには紐づいていません。`;
  if (!confirm(message)) return;
  dictionaries.categories = dictionaries.categories.filter(other => other.id !== category.id); activeDictionaryCategoryId = "hardware";
  if (await persistDictionaries()) { renderDictionaryCategories(); showToast("辞書の種類を削除しました"); }
});
function openDictionaryDelete(category, item) {
  pendingDictionaryDelete = { categoryId: category.id, entryId: item.id };
  const uses = entryUseCount(category, item);
  $("dictDeleteMessage").textContent = `「${item.name}」を削除します。${category.binding ? `現在、${uses}件のゲームで参照されています。` : ""}どの方法で削除するか選んでください。`;
  $("deleteDictAndReferences").hidden = !category.binding || uses === 0;
  $("dictDeleteDialog").showModal();
}
function closeDictionaryDelete() { pendingDictionaryDelete = null; $("dictDeleteDialog").close(); }
$("cancelDictDelete").addEventListener("click", closeDictionaryDelete);
$("cancelDictDeleteTop").addEventListener("click", closeDictionaryDelete);
$("deleteDictOnly").addEventListener("click", async () => performDictionaryDelete(false));
$("deleteDictAndReferences").addEventListener("click", async () => performDictionaryDelete(true));
async function performDictionaryDelete(removeReferences) {
  if (!pendingDictionaryDelete) return;
  const category = getCategory(pendingDictionaryDelete.categoryId); const item = category?.entries.find(e => e.id === pendingDictionaryDelete.entryId);
  if (!category || !item) { closeDictionaryDelete(); return; }
  const snapshot = { ...item, aliases: [...item.aliases] };
  if (removeReferences) replaceEntryReferences(category, snapshot, null);
  category.entries = category.entries.filter(e => e.id !== item.id);
  if (!await persistDictionaries()) return;
  if (removeReferences && !await persist()) return;
  closeDictionaryDelete(); renderDictionaryCategories(); render(); showToast(removeReferences ? "辞書項目とゲーム側の関連値を削除しました" : "辞書項目を削除しました。ゲーム側の値は残しています");
}

// Display settings for collection cards and detail panels.
function applyTheme(theme = "system") {
  const root = document.documentElement;
  root.dataset.theme = ["light", "dark"].includes(theme) ? theme : "system";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f5f6f8" : theme === "dark" ? "#111315" : ((window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "#111315" : "#f5f6f8");
}

function renderDisplaySettings() {
  applyTheme(displaySettings.theme || "system");
  const fields = new Set(displaySettings.fields || DEFAULT_DISPLAY_SETTINGS.fields);
  $("displayFields")?.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = fields.has(input.value); });
  if ($("dimClearedGames")) $("dimClearedGames").checked = displaySettings.dimCleared !== false;
  if ($("coverBorderSetting")) $("coverBorderSetting").checked = displaySettings.coverBorder !== false;
  if ($("coverRoundedSetting")) $("coverRoundedSetting").checked = displaySettings.coverRounded !== false;
  if ($("themeSetting")) $("themeSetting").value = ["system", "light", "dark"].includes(displaySettings.theme) ? displaySettings.theme : "system";
}
$("saveDisplaySettings").addEventListener("click", async () => {
  displaySettings = { fields: [...$("displayFields").querySelectorAll('input[type="checkbox"]')].filter(input => input.checked).map(input => input.value), dimCleared: $("dimClearedGames").checked, coverBorder: $("coverBorderSetting").checked, coverRounded: $("coverRoundedSetting").checked };
  displaySettings.theme = $("themeSetting")?.value || "system";
  applyTheme(displaySettings.theme);
  const ok = await writeStored(DISPLAY_SETTINGS_KEY, displaySettings);
  render(); $("dataMessage").textContent = ok ? "表示設定を保存しました。" : "表示設定を保存できませんでした。";
  showToast(ok ? "表示設定を保存しました" : "保存に失敗しました");
});

// Settings and CSV / JSON data tools
$("settingsBtn").addEventListener("click", () => $("settingsDialog").showModal());
$("closeSettings").addEventListener("click", () => $("settingsDialog").close());
$("closeSettingsBottom").addEventListener("click", () => $("settingsDialog").close());
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function askExportFilename(defaultBase, extension) {
  const entered = prompt(`出力するファイル名を入力してください（${extension} は自動で付きます）。`, defaultBase);
  if (entered === null) return null;
  let base = entered.trim().replace(/\.(csv|yuzo|rshelf|json)$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  if (!base) base = defaultBase;
  return `${base}${extension}`;
}
function csvCell(value) { let text = String(value ?? ""); if (/^[=+\-@]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; }
function csvText(rows) { return "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }
$("exportCsv").addEventListener("click", () => {
  const headers = ["title", "platform", "publisher", "editions", "codes", "series", "genres", "tags", "notes", "clearStatus", "releaseDate", "preorder", "coverIncluded", "id"];
  const rows = [headers, ...games.map(game => [game.title, game.platform, game.publisher, (game.editions || []).join("|"), JSON.stringify(game.codes || {}), game.series, (game.genres || []).join("|"), (game.tags || []).join("|"), game.notes, game.clearStatus || "unplayed", game.releaseDate || "", game.preorder ? "yes" : "no", game.cover ? "yes" : "no", game.id])];
  const filename = askExportFilename("yuuzo-games", ".csv"); if (!filename) return;
  download(filename, csvText(rows), "text/csv;charset=utf-8"); $("dataMessage").textContent = `ゲームCSVを書き出しました（${filename}）。画像本体は含まれません。`;
});
$("exportDictionaryCsv").addEventListener("click", () => {
  const rows = [["category", "categoryId", "entryId", "name", "aliases", "coverUrlTemplate"]];
  dictionaries.categories.forEach(category => {
    if (!category.entries.length) rows.push([category.name, category.id, "", "", "", ""]);
    category.entries.forEach(item => rows.push([category.name, category.id, item.id, item.name, item.aliases.join("|"), item.coverUrlTemplate || ""]));
  });
  const filename = askExportFilename("yuuzo-dictionaries", ".csv"); if (!filename) return;
  download(filename, csvText(rows), "text/csv;charset=utf-8"); $("dataMessage").textContent = `辞書CSVを書き出しました（${filename}）。カテゴリ名・正式名称・別名を編集して再読み込みできます。`;
});
function parseCsv(text) {
  text = text.replace(/^\ufeff/, ""); const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
$("importCsv").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const rows = parseCsv(await file.text()); if (rows.length < 2) throw new Error("empty");
    const headers = rows.shift().map(x => x.trim()); const idx = key => headers.indexOf(key); let added = 0;
    for (const row of rows) {
      const title = row[idx("title")]?.trim(), platform = row[idx("platform")]?.trim(); if (!title || !platform) continue;
      let codes = {}; try { codes = JSON.parse(row[idx("codes")] || "{}"); } catch (_) { /* Keep empty codes for malformed CSV cells. */ }
      const item = canonicalizeGame({ id: makeId("game"), title, platform, publisher: row[idx("publisher")] || "", editions: (row[idx("editions")] || "").split("|").filter(Boolean), codes, series: row[idx("series")] || "", genres: (row[idx("genres")] || "").split("|").filter(Boolean), tags: (row[idx("tags")] || "").split("|").filter(Boolean), notes: row[idx("notes")] || "", clearStatus: row[idx("clearStatus")] === "cleared" ? "cleared" : "unplayed", releaseDate: row[idx("releaseDate")] || "", preorder: ["yes", "true", "1"].includes(String(row[idx("preorder")] || "").toLowerCase()), cover: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, true);
      games.push(item); added++;
    }
    await persistDictionaries(); await persist(); $("dataMessage").textContent = `${added}件を追加しました。CSVからは画像を復元できません。`; showToast(`${added}件を読み込みました`);
  } catch (_) { $("dataMessage").textContent = "ゲームCSVを読み込めませんでした。列名と形式を確認してください。"; }
  event.target.value = "";
});
function findOrCreateCategoryByName(name) {
  let category = dictionaries.categories.find(c => normalizeName(c.name) === normalizeName(name));
  if (!category) { category = { id: makeId("category"), name: String(name).trim(), binding: null, multiple: false, required: false, builtIn: false, entries: [] }; dictionaries.categories.push(category); }
  return category;
}
$("importDictionaryCsv").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const rows = parseCsv(await file.text()); if (rows.length < 2) throw new Error("empty");
    const headers = rows.shift().map(x => x.trim()); const idx = key => headers.indexOf(key);
    if (idx("category") < 0 || idx("name") < 0 || idx("aliases") < 0) throw new Error("columns");
    let added = 0, merged = 0, skipped = 0;
    for (const row of rows) {
      const categoryName = (row[idx("category")] || "").trim(); if (!categoryName) continue;
      const category = findOrCreateCategoryByName(categoryName);
      const name = (row[idx("name")] || "").trim(); if (!name) continue;
      const aliases = unique((row[idx("aliases")] || "").split("|").map(x => x.trim()).filter(Boolean));
      let existing = category.entries.find(item => normalizeName(item.name) === normalizeName(name));
      if (existing) {
        const proposed = unique([...existing.aliases, ...aliases]); const collision = checkCollision(category, existing.name, proposed, existing.id);
        if (collision) { skipped++; continue; }
        existing.aliases = proposed;
        if (category.id === "hardware" && idx("coverUrlTemplate") >= 0 && row[idx("coverUrlTemplate")]) existing.coverUrlTemplate = row[idx("coverUrlTemplate")].trim();
        merged++;
      } else {
        const collision = checkCollision(category, name, aliases);
        if (collision) { skipped++; continue; }
        const addedEntry = addEntry(category, name, aliases);
        if (category.id === "hardware" && idx("coverUrlTemplate") >= 0) addedEntry.coverUrlTemplate = (row[idx("coverUrlTemplate")] || "").trim();
        added++;
      }
    }
    await persistDictionaries(); await persist(); renderDictionaryCategories();
    $("dataMessage").textContent = `辞書CSVを読み込みました。新規 ${added}件、既存に統合 ${merged}件、重複のためスキップ ${skipped}件。`;
    showToast(`辞書項目を${added + merged}件反映しました`);
  } catch (_) { $("dataMessage").textContent = "辞書CSVを読み込めませんでした。category、name、aliases列を確認してください。"; }
  event.target.value = "";
});
function mergeDictionaryData(incoming) {
  if (!incoming || !Array.isArray(incoming.categories)) return;
  incoming.categories.forEach(incomingCategory => {
    const name = String(incomingCategory.name || "").trim(); if (!name) return;
    let category = dictionaries.categories.find(c => c.id === incomingCategory.id);
    if (!category) category = findOrCreateCategoryByName(name);
    (Array.isArray(incomingCategory.entries) ? incomingCategory.entries : []).forEach(rawEntry => {
      const item = normalizeEntry(rawEntry); if (!item.name) return;
      const existing = category.entries.find(e => normalizeName(e.name) === normalizeName(item.name));
      if (existing) {
        const proposed = unique([...existing.aliases, ...item.aliases]);
        if (!checkCollision(category, existing.name, proposed, existing.id)) existing.aliases = proposed;
        if (category.id === "hardware" && item.coverUrlTemplate) existing.coverUrlTemplate = item.coverUrlTemplate;
        return;
      }
      const collision = checkCollision(category, item.name, item.aliases);
      if (!collision) { const added = addEntry(category, item.name, item.aliases); if (category.id === "hardware") added.coverUrlTemplate = item.coverUrlTemplate; }
    });
  });
}
$("backupJson").addEventListener("click", async () => {
  // Export a complete snapshot of every persisted app data/settings key.
  const collectionView = { sort: $("sortSelect")?.value || "title-asc" };
  const legacyCoverTemplates = await readStored(COVER_TEMPLATES_KEY, coverTemplates);
  const snapshot = {
    format: "retro-shelf-complete-backup-v6",
    exportedAt: new Date().toISOString(),
    games, dictionaries, displaySettings,
    collectionView,
    coverTemplates: Array.isArray(legacyCoverTemplates) ? legacyCoverTemplates : coverTemplates
  };
  const filename = askExportFilename("yuuzo-backup", ".yuzo"); if (!filename) return;
  download(filename, JSON.stringify(snapshot, null, 2), "application/json");
  $("dataMessage").textContent = `ゲーム情報・ジャケット画像・全マスタ辞書・URLテンプレート・表示設定を含む完全バックアップを書き出しました（${filename}）。検索語と絞り込み状態は含みません。`;
});
$("restoreJson").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.games) || (!data.dictionaries && !data.displaySettings)) throw new Error("invalid backup");
    const isComplete = ["retro-shelf-complete-backup-v5", "retro-shelf-complete-backup-v6"].includes(data.format);
    const message = isComplete
      ? `完全バックアップです。ゲーム${data.games.length}件、辞書、表示設定などを含め、現在のデータをバックアップ内容で置き換えます。検索語と絞り込み状態は復元せず、空の状態から開始します。現在のデータは事前にバックアップしましたか？`
      : `ゲーム${data.games.length}件を現在のコレクションに追加し、含まれている辞書/表示設定を取り込みます。重複するゲームができる可能性があります。続行しますか？`;
    if (!confirm(message)) { event.target.value = ""; return; }

    if (isComplete) {
      // Complete backup restore: replace all app state so export/import is a true round trip.
      games = data.games.map(game => canonicalizeGame({ ...game, id: game.id || makeId("game") }, true));
      dictionaries = normalizeDictionaries(data.dictionaries);
      if (data.displaySettings && Array.isArray(data.displaySettings.fields)) {
        displaySettings = {
          fields: data.displaySettings.fields.filter(x => ["title","platform","publisher","editions","codes","series","genres","tags","clearStatus","notes"].includes(x)),
          dimCleared: data.displaySettings.dimCleared !== false,
          coverBorder: data.displaySettings.coverBorder !== false,
          coverRounded: data.displaySettings.coverRounded !== false,
          theme: ["system","light","dark"].includes(data.displaySettings.theme) ? data.displaySettings.theme : "system"
        };
      }
      const view = data.collectionView && typeof data.collectionView === "object" ? data.collectionView : {};
      activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
      $("searchInput").value = "";
      $("sortSelect").value = ["title-asc", "title-desc", "platform", "series", "release-asc", "release-desc", "recent", "updated"].includes(view.sort) ? view.sort : "title-asc";
      coverTemplates = Array.isArray(data.coverTemplates) ? data.coverTemplates.map(item => ({ platform: String(item.platform || ""), url: String(item.url || "") })).filter(item => item.platform && item.url) : [];
      await writeStored(DB_KEY, games);
      await writeStored(DICTIONARY_KEY, dictionaries);
      await writeStored(DISPLAY_SETTINGS_KEY, displaySettings);
      await writeStored(COLLECTION_VIEW_KEY, { sort: $("sortSelect").value });
      await writeStored(COVER_TEMPLATES_KEY, coverTemplates);
      renderDisplaySettings(); renderDictionaryCategories(); renderFilterGroups(); render();
      $("dataMessage").textContent = `完全バックアップからゲーム${games.length}件、辞書、画像、各種設定を復元しました。`;
    } else {
      mergeDictionaryData(data.dictionaries);
      if (data.displaySettings && Array.isArray(data.displaySettings.fields)) displaySettings = { fields: data.displaySettings.fields.filter(x => ["title","platform","publisher","editions","codes","series","genres","tags","clearStatus","notes"].includes(x)), dimCleared: data.displaySettings.dimCleared !== false, coverBorder: data.displaySettings.coverBorder !== false, coverRounded: data.displaySettings.coverRounded !== false, theme: ["system","light","dark"].includes(data.displaySettings.theme) ? data.displaySettings.theme : "system" };
      await writeStored(DISPLAY_SETTINGS_KEY, displaySettings); renderDisplaySettings();
      const incoming = data.games.map(game => canonicalizeGame({ ...game, id: makeId("game") }, true));
      games.push(...incoming);
      await persistDictionaries(); await persist(); renderDictionaryCategories();
      $("dataMessage").textContent = `${incoming.length}件のゲームと辞書データを追加しました。`;
    }
    showToast("バックアップを復元しました");
  } catch (_) { $("dataMessage").textContent = "バックアップを読み込めませんでした。ファイル形式または内容を確認してください。"; }
  event.target.value = "";
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
(async function initialize() {
  games = await loadGames();
  const storedView = await readStored(COLLECTION_VIEW_KEY, null);
  // Search and filter choices are temporary and always reset at launch; keep sort only.
  $("searchInput").value = "";
  activeFilters = { title: [], platform: [], publisher: [], edition: [], code: [], series: [], genre: [], releaseDate: [], clearStatus: [], preorder: [] };
  if (storedView && typeof storedView === "object" && ["title-asc", "title-desc", "platform", "series", "release-asc", "release-desc", "recent", "updated"].includes(storedView.sort)) $("sortSelect").value = storedView.sort;
  await writeStored(COLLECTION_VIEW_KEY, { sort: $("sortSelect").value || "title-asc" });
  const storedDictionaries = await readStored(DICTIONARY_KEY, null);
  dictionaries = normalizeDictionaries(storedDictionaries);
  const storedTemplates = await readStored(COVER_TEMPLATES_KEY, null);
  coverTemplates = Array.isArray(storedTemplates) ? storedTemplates.map(item => ({ platform: String(item.platform || ""), url: String(item.url || "") })).filter(item => item.platform && item.url) : [];
  const hardwareCategory = getCategory("hardware");
  // Clear legacy global templates. Users configure cover URL templates per hardware themselves.
  if (storedTemplates === null || coverTemplates.length) {
    await writeStored(COVER_TEMPLATES_KEY, []);
  }
  const storedDisplay = await readStored(DISPLAY_SETTINGS_KEY, null);
  if (storedDisplay && Array.isArray(storedDisplay.fields)) displaySettings = { fields: storedDisplay.fields.filter(x => ["title","platform","publisher","editions","codes","series","genres","tags","clearStatus","notes"].includes(x)), dimCleared: storedDisplay.dimCleared !== false, coverBorder: storedDisplay.coverBorder !== false, coverRounded: storedDisplay.coverRounded !== false, theme: ["system","light","dark"].includes(storedDisplay.theme) ? storedDisplay.theme : "system" };
  renderDisplaySettings();
  try { mergeLegacySeriesAliases(JSON.parse(localStorage.getItem("retro-shelf-series-aliases") || "{}")); } catch (_) { /* No legacy series alias data. */ }
  games.forEach(game => canonicalizeGame(game, true));
  const dictionariesSaved = await persistDictionaries();
  if (dictionariesSaved) { try { localStorage.removeItem("retro-shelf-series-aliases"); } catch (_) { /* Optional legacy migration cleanup. */ } }
  await persist();
})();
