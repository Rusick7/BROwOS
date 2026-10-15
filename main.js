/* ============ AeroOS Browser shell ============
 * Core idea: the browser is a single window on a virtual desktop,
 * and every "window" the user opens is presented as a TAB (like in
 * standard web browsers). Each tab owns its own history stack and a
 * sandboxed iframe viewport.
 */
(() => {
"use strict";

const $ = (s) => document.querySelector(s);
const frame   = $("#pageFrame");
const tabsEl  = $("#tabs");
const urlbar  = $("#urlbar");
const loadbar = $("#loadbar");

/* ---------------- state ---------------- */
let tabs = [];          // {id,title,url,fav,dirty,pinned,history:[],hidx}
let activeId = null;
let nextId = 1;
let settings = { home: "app://home", accent: "#4f8cff", darkWall: true };
let historyLog = [];    // global visit log for the History popup
try { Object.assign(settings, JSON.parse(localStorage.getItem("aero.settings") || "{}")); } catch (e) {}
try { historyLog = JSON.parse(sessionStorage.getItem("aero.history") || "[]"); } catch (e) {}

const favFor = (url) => {
  if (url.startsWith("app://")) return { notes:"📝", calc:"🧮", terminal:"💻", settings:"⚙️", about:"ℹ️", home:"🌐" }[url.slice(6)] || "🌐";
  if (url.startsWith("search://")) return "🔎";
  if (url.startsWith("error://")) return "⛔";
  try { return "🔗"; } catch (e) { return "🌐"; }
};

/* ---------------- URL resolution ---------------- */
function resolveInput(raw) {
  raw = raw.trim();
  if (!raw) return null;
  if (/^(app|search|error):\/\//.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  // looks like a domain?
  if (/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(raw) || /^localhost(:\d+)?/.test(raw))
    return "https://" + raw;
  return "search://" + encodeURIComponent(raw);   // otherwise: search
}

/* ---------------- rendering a location into the iframe ---------------- */
function renderLocation(tab, url) {
  if (url === "about:blank") {          // empty new window
    tab.url = url; tab.fav = "🌐";
    frame.removeAttribute("src"); frame.srcdoc = blankDoc();
    if (!tab.titleCustom) tab.title = "New window";
    renderTabs(); syncChrome(); return;
  }
  tab.url = url;
  tab.fav = favFor(url);
  if (url.startsWith("app://")) {
    const name = url.slice(6).split("/")[0] || "home";
    const html = (typeof APPS[name] === "string") ? APPS[name] : (APPS.home);
    frame.removeAttribute("src"); frame.srcdoc = html;
    if (!tab.titleCustom) tab.title = ({home:"AeroOS Start",notes:"Notes",calc:"Calculator",terminal:"Terminal",settings:"Settings",about:"About"}[name] || name);
  } else if (url.startsWith("search://")) {
    const q = decodeURIComponent(url.slice(9));
    frame.removeAttribute("src"); frame.srcdoc = APPS.search(q);
    if (!tab.titleCustom) tab.title = q + " — Search";
  } else if (url.startsWith("error://")) {
    frame.removeAttribute("src"); frame.srcdoc = APPS.error(atob(url.slice(8).split("|")[0] || ""), atob(url.slice(8).split("|")[1] || ""));
    if (!tab.titleCustom) tab.title = "Failed to load";
  } else {
    frame.removeAttribute("srcdoc");
    frame.src = url;
    if (!tab.titleCustom) tab.title = hostOf(url);
    watchExternal(tab, url);
  }
  historyLog.unshift({ url, title: tab.title, t: Date.now() });
  historyLog = historyLog.slice(0, 200);
  try { sessionStorage.setItem("aero.history", JSON.stringify(historyLog)); } catch (e) {}
  renderTabs(); syncChrome();
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/* detect external pages that refuse framing → show our error "window" */
let extTimer = null;
function watchExternal(tab, url) {
  clearTimeout(extTimer);
  const started = Date.now();
  extTimer = setTimeout(() => {
    let ok = false;
    try { ok = !!frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.innerHTML.length > 0; } catch (e) { ok = true; /* cross-origin = loaded fine */ }
    if (!ok && Date.now() - started > 2500) {
      const enc = btoa(unescape(encodeURIComponent(url))) + "|" + btoa(unescape(encodeURIComponent(
        "The site refused to be displayed inside this OS window (X-Frame-Options / CSP frame-ancestors).")));
      navigate(tab, "error://" + enc, false);
    }
  }, 3000);
}
frame.addEventListener("load", () => {
  clearTimeout(extTimer);
  stopLoading();
  try {
    const t = frame.contentDocument && frame.contentDocument.title;
    const tab = tabs.find(x => x.id === activeId);
    if (tab && t && !tab.url.startsWith("app://")) { tab.title = t; renderTabs(); syncChrome(); }
  } catch (e) {}
});

/* ---------------- tab operations (each tab = one window) ---------------- */
function createTab(url, { title, background = false, index = null } = {}) {
  const tab = { id: nextId++, title: title || "New window", url: "", fav: "🌐", dirty: false, pinned: false, history: [], hidx: -1 };
  if (index == null) tabs.push(tab); else tabs.splice(index, 0, tab);
  if (title) tab.titleCustom = true;
  renderTabs();
  activateTab(tab.id);
  navigate(tab, url || "about:blank", false);
  if (background) activatePrev();
  return tab;
}
let prevActive = null;
const activatePrev = () => { const p = prevActive; if (p && tabs.some(t => t.id === p)) activateTab(p, true); };

function activateTab(id, silent) {
  if (activeId === id) return;
  if (!silent) prevActive = activeId;
  const tab = tabs.find(t => t.id === id); if (!tab) return;
  activeId = id;
  renderLocation(tab, tab.url || "about:blank");
  renderTabs(); syncChrome();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
  const wasActive = activeId === id;
  tabs.splice(i, 1);
  if (!tabs.length) { $("#statusText").textContent = "All windows closed — click a desktop icon or ＋ to open one.";
    activeId = null; frame.srcdoc = "<body style='background:#fff'></body>"; renderTabs(); syncChrome(); return; }
  if (wasActive) activateTab(tabs[Math.min(i, tabs.length - 1)].id, true);
  renderTabs(); syncChrome();
}

function navigate(tab, url, pushHistory = true) {
  if (!tab) tab = tabs.find(t => t.id === activeId);
  if (!tab) { createTab(url); return; }
  if (pushHistory) { tab.history = tab.history.slice(0, tab.hidx + 1); tab.history.push(url); tab.hidx = tab.history.length - 1; }
  startLoading();
  renderLocation(tab, url);
}

function reloadTab() { const tab = cur(); if (tab) renderLocation(tab, tab.url); startLoading(); }
function goBack()  { const t = cur(); if (t && t.hidx > 0) { t.hidx--; renderLocation(t, t.history[t.hidx]); } }
function goFwd()   { const t = cur(); if (t && t.hidx < t.history.length - 1) { t.hidx++; renderLocation(t, t.history[t.hidx]); } }
const cur = () => tabs.find(t => t.id === activeId);

function blankDoc(){ return `<!DOCTYPE html><html><head><title>New window</title><style>${APP_STYLE}</style></head>
<body><main style="text-align:center;padding-top:80px"><div style="font-size:40px">🗔</div>
<h2 style="margin:10px 0">New window</h2><p style="color:#68707e;font-size:13px">Type an address above, or launch an app:</p>
<p style="margin-top:14px">${["home","notes","calc","terminal","settings","about"].map(a=>`<button class="ui" onclick="parent.postMessage({type:'openTab',url:'app://${a}'},'*')">${a}</button>`).join(" ")}</p>
</main></body></html>`; }

/* ---------------- tab strip UI ---------------- */
function renderTabs() {
  tabsEl.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "") + (t.pinned ? " pinned" : "") + (t.loading ? " loading" : "");
    el.draggable = true; el.dataset.id = t.id;
    el.innerHTML = `<span class="spinner"></span><span class="fav">${t.fav}</span>
      <span class="label">${escapeHtml(t.title)}${t.dirty ? " •" : ""}</span>
      <button class="close" title="Close window">✕</button>`;
    el.addEventListener("click", (e) => { if (!e.target.closest(".close")) activateTab(t.id); });
    el.querySelector(".close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); showTabMenu(e, t.id); });
    el.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } });
    el.addEventListener("dragstart", (e) => { dragId = t.id; if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragover", (e) => { e.preventDefault(); });
    el.addEventListener("drop", (e) => { e.preventDefault(); moveTab(dragId, t.id); });
    tabsEl.appendChild(el);
  }
  $("#tabCount").textContent = `${tabs.length} window${tabs.length === 1 ? "" : "s"} open`;
}
let dragId = null;
function moveTab(fromId, toId) {
  const fi = tabs.findIndex(t => t.id === fromId), ti = tabs.findIndex(t => t.id === toId);
  if (fi < 0 || ti < 0 || fi === ti) return;
  const [m] = tabs.splice(fi, 1); tabs.splice(ti, 0, m); renderTabs();
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

/* ---------------- chrome sync ---------------- */
function syncChrome() {
  const t = cur();
  urlbar.value = t ? displayUrl(t.url) : "";
  $("#siteIcon").textContent = t ? t.fav : "🌐";
  $("#docTitle").textContent = t ? `${t.title} — AeroOS Browser` : "AeroOS Browser";
  $("#navBack").disabled = !(t && t.hidx > 0);
  $("#navFwd").disabled  = !(t && t.hidx < t.history.length - 1);
  const bm = t && bookmarks.some(b => b.url === t.url);
  $("#btnBookmark").textContent = bm ? "★" : "☆";
  $("#btnBookmark").style.color = bm ? "#ffcc55" : "";
}
const displayUrl = (u) => u === "about:blank" ? "" : u;

function startLoading() { loadbar.className = "on"; const t = cur(); if (t) { t.loading = true; renderTabs(); } }
function stopLoading()   { loadbar.className = "done"; const t = cur(); if (t) { t.loading = false; renderTabs(); setTimeout(()=>loadbar.className="", 500);} }

/* ---------------- bookmarks ---------------- */
let bookmarks = [];
try { bookmarks = JSON.parse(localStorage.getItem("aero.bookmarks") || "[]"); } catch (e) {}
function renderBookmarks() {
  const bar = $("#bookmarks"); bar.innerHTML = "";
  for (const b of bookmarks) {
    const el = document.createElement("button"); el.className = "bm";
    el.innerHTML = `<span>${favFor(b.url)}</span>${escapeHtml(b.name||hostOf(b.url))}<span class="x" title="Remove">✕</span>`;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) { bookmarks = bookmarks.filter(x => x !== b); saveBm(); renderBookmarks(); syncChrome(); return; }
      openInTab(b.url);
    });
    bar.appendChild(el);
  }
}
const saveBm = () => localStorage.setItem("aero.bookmarks", JSON.stringify(bookmarks));
$("#btnBookmark").addEventListener("click", () => {
  const t = cur(); if (!t || !t.url || t.url === "about:blank") return;
  if (bookmarks.some(b => b.url === t.url)) bookmarks = bookmarks.filter(b => b.url !== t.url);
  else bookmarks.push({ url: t.url, name: t.title });
  saveBm(); renderBookmarks(); syncChrome();
});
function openInTab(url, opts = {}) {
  const existing = tabs.find(t => t.url === url && url.startsWith("app://"));
  if (existing && url.startsWith("app://")) { activateTab(existing.id); return existing; }
  return createTab(url, opts);
}

/* ---------------- popups: menu / history / tab context ---------------- */
const menu = $("#menuPopup");
function showPopup(html, x, y) {
  menu.innerHTML = html; menu.classList.remove("hidden");
  menu.style.left = Math.min(x, innerWidth - 270) + "px";
  menu.style.top = Math.max(0, y - 8) + "px";
}
const hidePopup = () => menu.classList.add("hidden");
document.addEventListener("click", (e) => { if (!menu.contains(e.target) && !e.target.closest("#btnMenu")) hidePopup(); });

$("#btnMenu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showPopup(`
    <button data-menu="newtab">New window (tab)&nbsp;<kbd>Ctrl T</kbd></button>
    <button data-menu="history">History&nbsp;<kbd>Ctrl H</kbd></button>
    <button data-menu="wallpaper">Change wallpaper</button>
    <hr><button data-menu="closewin">Close browser window</button>`,
    r.left - 180, r.bottom + 4);
});
menu.addEventListener("click", (e) => {
  const b = e.target.closest("[data-menu]"); if (!b) return;
  const act = b.dataset.menu;
  if (act === "newtab") { createTab(); focusUrl(); }
  else if (act === "history") showHistory();
  else if (act === "wallpaper") cycleWallpaper();
  else if (act === "closewin") minimizeBrowser();
  else if (act.startsWith("hist:")) { navigate(cur(), act.slice(5)); }
  else if (act.startsWith("tabact:")) tabAction(act.slice(7), b.dataset.tab);
  hidePopup();
});
function showHistory() {
  const items = historyLog.slice(0, 12).map(h =>
    `<button class="list-item" data-menu="hist:${escapeHtml(h.url)}">${escapeHtml(h.title)}<small>${escapeHtml(h.url)}</small></button>`).join("");
  const r = $("#toolbar").getBoundingClientRect();
  showPopup(items || "<p style='padding:10px;color:#8b94a8;font-size:12px'>No history yet.</p>", r.left + 20, r.bottom + 4);
}
function showTabMenu(e, id) {
  showPopup(`
    <button data-menu="tabact:reload" data-tab="${id}">Reload window</button>
    <button data-menu="tabact:duplicate" data-tab="${id}">Duplicate window</button>
    <button data-menu="tabact:pin" data-tab="${id}">${tabs.find(t=>t.id===id).pinned ? "Unpin" : "Pin"} window</button>
    <button data-menu="tabact:newpos" data-tab="${id}">Move to end</button>
    <hr>
    <button data-menu="tabact:closeothers" data-tab="${id}">Close other windows</button>
    <button data-menu="tabact:closeall" data-tab="${id}">Close all windows</button>`, e.clientX, e.clientY);
}
function tabAction(act, idStr) {
  const id = +idStr, t = tabs.find(x => x.id === id); if (!t) return;
  if (act === "reload") { activateTab(id); reloadTab(); }
  else if (act === "duplicate") createTab(t.url, { title: t.title });
  else if (act === "pin") { t.pinned = !t.pinned; renderTabs(); }
  else if (act === "newpos") { const i = tabs.indexOf(t); tabs.splice(i,1); tabs.push(t); renderTabs(); }
  else if (act === "closeothers") { [...tabs].forEach(x => { if (x.id !== id) closeTab(x.id); }); activateTab(id); }
  else if (act === "closeall") { while (tabs.length) closeTab(tabs[0].id); }
}

/* ---------------- postMessage bridge from app "windows" ---------------- */
window.addEventListener("message", (e) => {
  const d = e.data || {};
  const t = tabs.find(x => x.id === activeId);
  if (d.type === "openTab") createTab(resolveInput(d.url) || d.url, { title: d.title });
  else if (d.type === "status") $("#statusText").textContent = d.text;
  else if (d.type === "tabDirty") { if (t) { t.dirty = !!d.dirty; renderTabs(); } }
  else if (d.type === "setAccent") { settings.accent = d.color; applySettings(); persist(); }
  else if (d.type === "setWallpaper") { settings.darkWall = !!d.dark; applySettings(); persist(); }
  else if (d.type === "setHome") { settings.home = d.url; persist(); }
  else if (d.type === "resetAll") { localStorage.clear(); sessionStorage.clear(); location.reload(); }
});
const persist = () => localStorage.setItem("aero.settings", JSON.stringify(settings));
function applySettings() {
  document.documentElement.style.setProperty("--accent", settings.accent);
  $("#desktop").style.filter = settings.darkWall ? "" : "brightness(1.5) saturate(.8)";
}

/* ---------------- window-manager controls (min/max/close/drag) ---------------- */
const browser = $("#browser");
let maximized = true, restoreRect = null;
function makeFloat(rect) {
  maximized = false; browser.classList.add("float");
  const r = rect || { left: innerWidth*0.12, top: innerHeight*0.1, width: innerWidth*0.76, height: innerHeight*0.8 };
  Object.assign(browser.style, { left:r.left+"px", top:r.top+"px", width:r.width+"px", height:r.height+"px", inset:"auto" });
}
function maximize() {
  maximized = true; browser.classList.remove("float");
  browser.style.cssText = "";
}
$("#btnMax").addEventListener("click", () => { maximized ? makeFloat(restoreRect) : (restoreRect = rectNow(), maximize()); });
function rectNow(){ const r = browser.getBoundingClientRect(); return {left:r.left, top:r.top, width:r.width, height:r.height}; }
function minimizeBrowser() { browser.classList.add("closed"); $("#dock").classList.remove("hidden"); }
function restoreBrowser() { browser.classList.remove("closed"); $("#dock").classList.add("hidden"); }
$("#btnMin").addEventListener("click", minimizeBrowser);
$("#dockBtn").addEventListener("click", restoreBrowser);
$("#btnClose").addEventListener("click", () => {
  if (tabs.length && !confirm("Close the browser with " + tabs.length + " open window(s)?")) return;
  minimizeBrowser();
});
/* drag the whole OS window when floating */
$("#titlebar").addEventListener("dblclick", () => { maximized ? makeFloat(restoreRect) : maximize(); });
$("#titlebar").addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) return;
  if (maximized) { const w = rectNow(); makeFloat(w); }
  const sx = e.clientX - browser.offsetLeft, sy = e.clientY - browser.offsetTop;
  document.body.classList.add("dragging");
  const mv = (ev) => { browser.style.left = Math.max(-w0(ev), ev.clientX - sx) + "px"; browser.style.top = Math.max(0, ev.clientY - sy) + "px"; };
  const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); document.body.classList.remove("dragging"); };
  document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
});
const w0 = () => 0;

/* ---------------- toolbar events ---------------- */
$("#goBtn").addEventListener("click", doGo);
urlbar.addEventListener("keydown", (e) => { if (e.key === "Enter") doGo(); if (e.key === "Escape") syncChrome(); });
function doGo() {
  const u = resolveInput(urlbar.value);
  if (!u) return;
  const t = cur();
  if (!t) createTab(u); else navigate(t, u);
  frame.focus();
}
$("#navBack").addEventListener("click", goBack);
$("#navFwd").addEventListener("click", goFwd);
$("#navReload").addEventListener("click", reloadTab);
$("#navHome").addEventListener("click", () => navigate(cur(), settings.home));
$("#newTabBtn").addEventListener("click", () => { createTab(); focusUrl(); });
function focusUrl() { urlbar.focus(); urlbar.select(); }

/* desktop icons open apps as new windows/tabs */
document.querySelectorAll(".desktop-icons .icon").forEach(btn =>
  btn.addEventListener("click", () => { restoreBrowser(); openInTab("app://" + btn.dataset.app); }));

/* ---------------- keyboard shortcuts ---------------- */
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); createTab(); focusUrl(); }
  else if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (cur()) closeTab(activeId); }
  else if (mod && e.key.toLowerCase() === "l") { e.preventDefault(); focusUrl(); }
  else if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); reloadTab(); }
  else if (mod && e.key.toLowerCase() === "h") { e.preventDefault(); showHistory(); }
  else if (mod && e.key === "Tab") { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
  else if (mod && /^[1-8]$/.test(e.key)) { e.preventDefault(); const t = tabs[+e.key - 1]; if (t) activateTab(t.id); }
  else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goFwd(); }
  else if (e.key === "F11") { e.preventDefault(); document.documentElement.requestFullscreen ? (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) : 0; }
});
function cycleTab(dir) { if (tabs.length < 2) return; const i = tabs.findIndex(t => t.id === activeId);
  activateTab(tabs[(i + dir + tabs.length) % tabs.length].id); }

/* status text on link hover inside same-origin frames isn't available; keep simple */
$("#statusText").textContent = "Ready";

/* clock */
setInterval(() => { $("#wallClock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 1000);

/* wallpapers cycle */
const WALLS = [
  "radial-gradient(1200px 700px at 70% 20%, #35507a 0%, #1c2740 45%, #10182b 100%)",
  "radial-gradient(1000px 800px at 30% 70%, #6a3f7d 0%, #2b2140 50%, #120e20 100%)",
  "radial-gradient(1200px 700px at 60% 30%, #1f5c4d 0%, #16302e 50%, #0c1817 100%)",
];
let wallIdx = 0;
function cycleWallpaper() { wallIdx = (wallIdx + 1) % WALLS.length; $("#desktop").style.background = WALLS[wallIdx]; }

/* ---------------- boot ---------------- */
applySettings();
renderBookmarks();
createTab(settings.home);
})();
