// BROwOS — web-OS browser shell where windows are presented as tabs.
// Core logic (tab/window manager, omnibox, history, persistence) in Rust → WASM.

mod apps;

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{Document, Element, EventTarget, HtmlElement, HtmlIFrameElement, HtmlInputElement, Window};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, catch)]
    fn confirm(msg: &str) -> Result<bool, JsValue>;
}
fn js_confirm(msg: &str) -> bool { confirm(msg).unwrap_or(true) }

#[derive(Serialize, Deserialize, Clone)]
pub struct Tab {
    pub id: u32,
    pub url: String, // external URL | app://name | search:<q>
    pub title: String,
    pub icon: String,
    pub loading: bool,
    pub pinned: bool,
    pub dirty: bool,
    pub hist: Vec<String>,
    pub pos: usize,
}

#[derive(Serialize, Deserialize)]
pub struct State {
    pub tabs: Vec<Tab>,
    pub active: Option<u32>,
    pub next_id: u32,
    pub bookmarks: Vec<(String, String, String)>, // (url,title,icon)
    pub history: Vec<(String, String)>,           // global (url,title)
    pub home: String,
    pub accent: String,
    pub wall: u32,
}

impl Default for State {
    fn default() -> Self {
        State {
            tabs: vec![],
            active: None,
            next_id: 1,
            bookmarks: vec![
                ("app://home".into(), "Start Page".into(), "🌐".into()),
                ("https://example.org".into(), "Example".into(), "🌐".into()),
                ("https://developer.mozilla.org".into(), "MDN".into(), "📚".into()),
            ],
            history: vec![],
            home: "app://home".into(),
            accent: "#4f8cff".into(),
            wall: 0,
        }
    }
}

pub type Shared = Rc<RefCell<State>>;

#[derive(Deserialize)]
struct Msg {
    #[serde(default)] r#type: String,
    #[serde(default)] url: String,
    #[serde(default)] q: String,
    #[serde(default)] text: String,
    #[serde(default)] dirty: bool,
    #[serde(default)] accent: String,
    #[serde(default)] home: String,
    #[serde(default)] wall: String,
}

// ---------- small DOM helpers ----------
fn el(doc: &Document, id: &str) -> HtmlElement {
    doc.get_element_by_id(id).map(|e| e.unchecked_into()).expect("missing element")
}
fn set_text(d: &Document, id: &str, t: &str) { el(d, id).set_text_content(Some(t)); }
fn set_html(d: &Document, id: &str, h: &str) { el(d, id).set_inner_html(h); }
fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;") }

fn add_click(e: &HtmlElement, f: impl FnMut(web_sys::MouseEvent) + 'static) {
    let c = Closure::wrap(Box::new(f) as Box<dyn FnMut(web_sys::MouseEvent)>);
    e.add_event_listener_with_callback("click", c.as_ref().unchecked_ref()).unwrap();
    c.forget();
}
fn add_keydown(e: &EventTarget, capture: bool, f: impl FnMut(web_sys::KeyboardEvent) + 'static) {
    let c = Closure::wrap(Box::new(f) as Box<dyn FnMut(web_sys::KeyboardEvent)>);
    e.add_event_listener_with_callback_and_bool("keydown", c.as_ref().unchecked_ref(), capture).ok();
    c.forget();
}
fn closest(e: &Element, sel: &str) -> Option<Element> {
    let h = e.dyn_ref::<HtmlElement>()?;
    h.closest(sel).ok().flatten().map(|o| o.unchecked_into())
}
fn toggle_class(d: &Document, id: &str, cls: &str, on: bool) {
    let e = el(d, id);
    if on { e.class_list().add_1(cls).ok(); } else { e.class_list().remove_1(cls).ok(); }
}
fn hide(d: &Document, id: &str) { toggle_class(d, id, "hidden", true); }
fn show(d: &Document, id: &str) { toggle_class(d, id, "hidden", false); }

// ---------- state helpers ----------
fn save(s: &Shared, w: &Window) {
    if let Ok(Some(ls)) = w.local_storage() {
        if let Ok(j) = serde_json::to_string(&*s.borrow()) { let _ = ls.set_item("browos.state", &j); }
    }
}
fn resolve(s: &Shared, raw: &str) -> String {
    let ss = raw.trim();
    if ss.is_empty() { return s.borrow().home.clone(); }
    if ss.starts_with("app://") || ss.starts_with("search:") { return ss.into(); }
    let scheme = ss.contains("://");
    let host = !ss.chars().any(char::is_whitespace) && (ss.contains('.') || ss.starts_with("localhost"));
    if scheme { ss.into() } else if host { format!("https://{ss}") } else { format!("search:{ss}") }
}
fn display_url(url: &str) -> String {
    if let Some(q) = url.strip_prefix("search:") { format!("{q} · AeroSearch") }
    else { url.replace("app://", "aero://") }
}
fn title_icon(url: &str) -> (String, String) {
    if let Some(q) = url.strip_prefix("search:") { (format!("{q} — AeroSearch"), "🔍".into()) }
    else if let Some(r) = url.strip_prefix("app://") {
        let n = r.split('/').next().unwrap_or("");
        (apps::title_for(n).into(), apps::icon_for(n).into())
    } else {
        let h = url.split("//").nth(1).unwrap_or(url).split('/').next().unwrap_or(url);
        (h.to_string(), "🌐".into())
    }
}
fn not_found(u: &str) -> String {
    format!("<body style='font-family:sans-serif;padding:40px'><h2>⚠️ Cannot open window</h2><p>{}</p></body>", esc(u))
}

// ---------- rendering ----------
fn start_bar(d: &Document, url: Option<&str>) {
    let lb = el(d, "loadbar");
    lb.class_list().remove_1("done").ok();
    match url { Some(u) => { lb.class_list().add_1("on").ok(); set_text(d, "statusText", &format!("Loading {}", display_url(u))); }
                 None => { lb.class_list().remove_1("on").ok(); lb.class_list().add_1("done").ok(); } }
}
fn render_page(s: &Shared, d: &Document) {
    let url = {
        let st = s.borrow();
        match st.tabs.iter().find(|t| Some(t.id) == st.active) { Some(t) => t.url.clone(), None => return }
    };
    let frame: HtmlIFrameElement = el(d, "pageFrame").dyn_into().unwrap();
    let html_doc = if let Some(q) = url.strip_prefix("search:") {
        apps::search_results(q)
    } else if apps::is_app(&url) {
        apps::render(&apps::app_name(&url)).unwrap_or_else(|| not_found(&url))
    } else {
        frame.set_src(&url);
        String::new()
    };
    if !html_doc.is_empty() { frame.set_srcdoc(&html_doc); }
    set_text(d, "statusText", &format!("Loaded {}", display_url(&url)));
    start_bar(d, None);
    // mark the active tab as loaded now that its content is rendered
    { let mut st = s.borrow_mut();
      let aid = st.active;
      if let Some(t) = st.tabs.iter_mut().find(|t| Some(t.id) == aid) { t.loading = false; } }
}
fn focused_input(d: &Document) -> bool {
    d.active_element().map(|a| a.id() == "urlbar").unwrap_or(false)
}
fn render_all(s: &Shared, d: &Document) {
    let pending_url = {
        let st = s.borrow();
        let cur0 = st.tabs.iter().find(|t| Some(t.id) == st.active);
        if cur0.map(|t| t.loading).unwrap_or(false) { cur0.map(|t| t.url.clone()) } else { None }
    };
    if let Some(u) = pending_url.as_deref() { start_bar(d, Some(u)); }
    {
        let st = s.borrow();
        let mut html = String::new();
        for t in &st.tabs {
            let act = Some(t.id) == st.active;
            html.push_str(&format!(
                "<div class=\"tab{}{}{}\" draggable=\"true\" data-id=\"{}\" title=\"{}\">\
                 <span class=\"fav\">{}</span><span class=\"label\">{}</span>\
                 <span class=\"spinner\"></span>\
                 <button class=\"close\" data-close=\"{}\">✕</button></div>",
                if act { " active" } else { "" },
                if t.pinned { " pinned" } else { "" },
                if t.loading { " loading" } else { "" },
                t.id, esc(&t.url), t.icon, esc(&t.title), t.id));
        }
        el(d, "tabs").set_inner_html(&html);
        set_text(d, "tabCount", &format!("{} window(s)", st.tabs.len()));
        let cur = st.tabs.iter().find(|t| Some(t.id) == st.active);
        set_text(d, "docTitle", cur.map(|t| t.title.as_str()).unwrap_or("BROwOS Browser"));
        {
            let back: HtmlElement = el(d, "navBack");
            let fwd: HtmlElement = el(d, "navFwd");
            if cur.map(|t| t.pos == 0).unwrap_or(true) { back.set_attribute("disabled", "").ok(); } else { back.remove_attribute("disabled").ok(); }
            if cur.map(|t| t.pos + 1 >= t.hist.len()).unwrap_or(true) { fwd.set_attribute("disabled", "").ok(); } else { fwd.remove_attribute("disabled").ok(); }
        }
        set_text(d, "siteIcon", cur.map(|t| t.icon.as_str()).unwrap_or("🌐"));
        if !focused_input(d) {
            let bar: HtmlInputElement = el(d, "urlbar").dyn_into().unwrap();
            bar.set_value(&cur.map(|t| display_url(&t.url)).unwrap_or_default());
        }
        let bm: Vec<(usize, (String, String, String))> = st.bookmarks.iter().cloned().enumerate().collect();
        drop(st);
        let mut h = String::new();
        for (i, (_u, t, ic)) in bm {
            h.push_str(&format!(
                "<button class=\"bm\" data-bm=\"{}\"><span>{}</span>{}<span class=\"x\" data-unbm=\"{}\">✕</span></button>",
                i, ic, esc(&t), i));
        }
        el(d, "bookmarks").set_inner_html(&h);
    }
    render_page(s, d);
}

// ---------- actions ----------
fn open_cb(s: &Shared, d: &Document, w: &Window, url: &str) {
    let (title, icon) = title_icon(url);
    {
        let mut st = s.borrow_mut();
        let id = st.next_id; st.next_id += 1;
        st.tabs.push(Tab { id, url: url.into(), title, icon, loading: true, pinned: false, dirty: false, hist: vec![url.into()], pos: 0 });
        st.active = Some(id);
        st.history.push((url.into(), String::new()));
        if st.history.len() > 200 { let n = st.history.len() - 200; st.history.drain(..n); }
    }
    save(s, w); render_all(s, d);
}
fn switch_cb(s: &Shared, d: &Document, id: u32) {
    // switching to a tab re-renders its content, so mark it loaded (spinner off)
    if s.borrow().tabs.iter().any(|t| t.id == id) {
        let mut st = s.borrow_mut();
        if let Some(t) = st.tabs.iter_mut().find(|t| t.id == id) { t.loading = false; }
        st.active = Some(id);
    }
    render_all(s, d);
}
fn close_cb(s: &Shared, d: &Document, w: &Window, id: u32) {
    let dirty = s.borrow().tabs.iter().any(|t| t.id == id && t.dirty);
    if dirty && !js_confirm("This window has unsaved changes. Close anyway?") { return; }
    {
        let mut st = s.borrow_mut();
        if let Some(i) = st.tabs.iter().position(|t| t.id == id) {
            st.tabs.remove(i);
            if st.active == Some(id) {
                st.active = st.tabs.get(i.min(st.tabs.len().saturating_sub(1))).map(|t| t.id);
            }
        }
    }
    if s.borrow().tabs.is_empty() {
        let f: HtmlIFrameElement = el(d, "pageFrame").dyn_into().unwrap();
        f.set_srcdoc("<body style='background:#fff'></body>");
    }
    save(s, w); render_all(s, d);
}
fn navigate_cb(s: &Shared, d: &Document, w: &Window, raw: &str) {
    let url = resolve(s, raw);
    {
        let mut st = s.borrow_mut();
        let aid = match st.active { Some(a) => a, None => { drop(st); open_cb(s, d, w, &url); return } };
        if let Some(t) = st.tabs.iter_mut().find(|t| t.id == aid) {
            if t.pos + 1 < t.hist.len() { t.hist.truncate(t.pos + 1); }
            t.hist.push(url.clone()); t.pos = t.hist.len() - 1;
            t.url = url.clone(); t.loading = true;
            let (ti, ic) = title_icon(&url); t.title = ti; t.icon = ic;
            st.history.push((url.clone(), String::new()));
            if st.history.len() > 200 { let n = st.history.len() - 200; st.history.drain(..n); }
        }
    }
    save(s, w); render_all(s, d);
}
fn back_cb(s: &Shared, d: &Document, w: &Window) {
    let aid = s.borrow().active;
    if let Some(aid) = aid {
        let mut st = s.borrow_mut();
        if let Some(t) = st.tabs.iter_mut().find(|t| t.id == aid) {
            if t.pos > 0 { t.pos -= 1; t.url = t.hist[t.pos].clone(); t.loading = true;
                let (ti, ic) = title_icon(&t.url); t.title = ti; t.icon = ic; }
        }
    }
    save(s, w); render_all(s, d);
}
fn fwd_cb(s: &Shared, d: &Document, w: &Window) {
    let aid = s.borrow().active;
    if let Some(aid) = aid {
        let mut st = s.borrow_mut();
        if let Some(t) = st.tabs.iter_mut().find(|t| t.id == aid) {
            if t.pos + 1 < t.hist.len() { t.pos += 1; t.url = t.hist[t.pos].clone(); t.loading = true;
                let (ti, ic) = title_icon(&t.url); t.title = ti; t.icon = ic; }
        }
    }
    save(s, w); render_all(s, d);
}
fn home_cb(s: &Shared, d: &Document, w: &Window) { let h = s.borrow().home.clone(); navigate_cb(s, d, w, &h); }
fn bookmark_cb(s: &Shared, d: &Document, w: &Window) {
    let ent = { let st = s.borrow();
        st.tabs.iter().find(|t| Some(t.id) == st.active).map(|t| (t.url.clone(), t.title.clone(), t.icon.clone())) };
    if let Some(e) = ent {
        let mut st = s.borrow_mut();
        if !st.bookmarks.iter().any(|b| b.0 == e.0) { st.bookmarks.push(e); }
        set_text(d, "statusText", "Bookmarked");
    }
    save(s, w); render_all(s, d);
}
fn unbookmark_cb(s: &Shared, d: &Document, w: &Window, i: usize) {
    { let mut st = s.borrow_mut();
      if i < st.bookmarks.len() { st.bookmarks.remove(i); } }
    save(s, w); render_all(s, d);
}
fn close_all_cb(s: &Shared, d: &Document, w: &Window) {
    { let mut st = s.borrow_mut(); st.tabs.clear(); st.active = None; }
    let f: HtmlIFrameElement = el(d, "pageFrame").dyn_into().unwrap();
    f.set_srcdoc("<body style='background:#fff'></body>");
    save(s, w); render_all(s, d);
}
fn select_nth(s: &Shared, d: &Document, n: usize) {
    let ids: Vec<u32> = { let st = s.borrow(); st.tabs.iter().map(|t| t.id).collect() };
    if let Some(&id) = ids.get(n) { switch_cb(s, d, id); }
}
fn cycle_tab(s: &Shared, d: &Document, dir: i32) {
    let (ids, cur) = { let st = s.borrow(); (st.tabs.iter().map(|t| t.id).collect::<Vec<_>>(), st.active) };
    if ids.is_empty() { return; }
    let pos = cur.and_then(|a| ids.iter().position(|&i| i == a)).unwrap_or(0);
    let n = ids.len() as i32;
    let np = (((pos as i32 + dir) % n + n) % n) as usize;
    switch_cb(s, d, ids[np]);
}
fn show_hist(s: &Shared, d: &Document) {
    let st = s.borrow();
    let mut rows = String::new();
    for (u, t) in st.history.iter().rev().take(40) {
        rows.push_str(&format!("<button class=\"list-item\" data-url=\"{}\"><span>{}</span><small>{}</small></button>",
            esc(u), esc(if t.is_empty() { u } else { t }), esc(u)));
    }
    if rows.is_empty() { rows = "<div style=\"padding:8px;color:#8b94a8\">No history yet</div>".into(); }
    drop(st);
    set_html(d, "histPopup", &format!("<div style=\"max-height:300px;overflow:auto\">{rows}</div>"));
    show(d, "histPopup");
}
fn set_dirty(s: &Shared, v: bool) {
    let id = s.borrow().active;
    if let Some(id) = id {
        if let Some(t) = s.borrow_mut().tabs.iter_mut().find(|t| t.id == id) { t.dirty = v; }
    }
}
fn apply_settings(s: &Shared, d: &Document, w: &Window, accent: &str, home: &str, wall: &str) {
    {
        let mut st = s.borrow_mut();
        if !accent.is_empty() { st.accent = accent.into(); }
        if !home.is_empty() { st.home = home.into(); }
        st.wall = wall.parse().unwrap_or(0);
    }
    paint_os(s, d);
    save(s, w);
    set_text(d, "statusText", "Settings applied");
}
fn paint_os(s: &Shared, d: &Document) {
    let (accent, wall) = { let st = s.borrow(); (st.accent.clone(), st.wall) };
    let css = match wall {
        1 => "radial-gradient(1200px 700px at 70% 20%, #7a4535 0%, #40221c 45%, #2b1018 100%)",
        2 => "radial-gradient(1200px 700px at 70% 20%, #2f6a4d 0%, #14352a 45%, #08160f 100%)",
        _ => "radial-gradient(1200px 700px at 70% 20%, #35507a 0%, #1c2740 45%, #10182b 100%)",
    };
    let root: HtmlElement = d.document_element().unwrap().unchecked_into();
    root.style().set_property("--accent", &accent).ok();
    el(d, "desktop").style().set_property("background", css).ok();
}

// ---------- exported shell ----------
#[wasm_bindgen]
pub struct Shell { s: Shared, d: Document, w: Window }

#[wasm_bindgen]
impl Shell {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Shell {
        let w = web_sys::window().unwrap();
        let d = w.document().unwrap();
        let st: State = w.local_storage().ok().flatten()
            .and_then(|ls| ls.get_item("browos.state").ok().flatten())
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();
        let s = Rc::new(RefCell::new(st));
        let sh = Shell { s, d, w };
        sh.bind_all();
        sh
    }

    pub fn boot(&self) {
        paint_os(&self.s, &self.d);
        if self.s.borrow().tabs.is_empty() {
            let h = self.s.borrow().home.clone();
            open_cb(&self.s, &self.d, &self.w, &h);
        } else { render_all(&self.s, &self.d); }
    }

    pub fn navigate(&self, raw: &str) { navigate_cb(&self.s, &self.d, &self.w, raw); }
    pub fn open_url(&self, url: &str) { open_cb(&self.s, &self.d, &self.w, url); }
    pub fn go_back(&self) { back_cb(&self.s, &self.d, &self.w); }
    pub fn go_fwd(&self) { fwd_cb(&self.s, &self.d, &self.w); }
    pub fn reload(&self) { render_page(&self.s, &self.d); }
    pub fn go_home(&self) { home_cb(&self.s, &self.d, &self.w); }
    pub fn close_active(&self) { if let Some(id) = self.s.borrow().active { close_cb(&self.s, &self.d, &self.w, id); } }
    pub fn close_all(&self) { close_all_cb(&self.s, &self.d, &self.w); }
    pub fn bookmark_current(&self) { bookmark_cb(&self.s, &self.d, &self.w); }
    pub fn show_history(&self) { show_hist(&self.s, &self.d); }
    pub fn minimize(&self) { toggle_class(&self.d, "browser", "minimized", true); show(&self.d, "dock"); }
    pub fn restore(&self) { toggle_class(&self.d, "browser", "minimized", false); hide(&self.d, "dock"); }

    fn bind_all(&self) {
        let (s, d, w) = (self.s.clone(), self.d.clone(), self.w.clone());

        // click delegation inside browser chrome
        let root: HtmlElement = el(&d, "browser");
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&root, move |ev: web_sys::MouseEvent| {
              let tgt: Element = ev.target().unwrap().dyn_into().unwrap();
              if let Some(x) = closest(&tgt, "[data-unbm]") {
                  ev.stop_propagation();
                  unbookmark_cb(&s, &d, &w, x.get_attribute("data-unbm").unwrap_or("0".into()).parse().unwrap_or(0));
              } else if let Some(c) = closest(&tgt, "[data-close]") {
                  close_cb(&s, &d, &w, c.get_attribute("data-close").unwrap_or("0".into()).parse().unwrap_or(0));
              } else if let Some(b) = closest(&tgt, "[data-bm]") {
                  let i: usize = b.get_attribute("data-bm").unwrap_or("9999".into()).parse().unwrap_or(9999);
                  let url = s.borrow().bookmarks.get(i).map(|x| x.0.clone());
                  match url { Some(u) => navigate_cb(&s, &d, &w, &u), None => {} }
              } else if let Some(h) = closest(&tgt, "[data-url]") {
                  let u = h.get_attribute("data-url").unwrap_or_default();
                  navigate_cb(&s, &d, &w, &u); hide(&d, "histPopup"); hide(&d, "menuPopup");
              } else if let Some(t) = closest(&tgt, ".tab") {
                  if let Some(id) = t.get_attribute("data-id") { switch_cb(&s, &d, id.parse().unwrap_or(0)); }
              }
          }); }

        // middle-click closes tab-window
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let c = Closure::wrap(Box::new(move |ev: web_sys::MouseEvent| {
              if ev.button() != 1 { return; }
              let tgt: Element = ev.target().unwrap().dyn_into().unwrap();
              if let Some(t) = closest(&tgt, ".tab") {
                  ev.prevent_default();
                  if let Some(id) = t.get_attribute("data-id") { close_cb(&s, &d, &w, id.parse().unwrap_or(0)); }
              }
          }) as Box<dyn FnMut(web_sys::MouseEvent)>);
          root.add_event_listener_with_callback("auxclick", c.as_ref().unchecked_ref()).unwrap(); c.forget(); }

        // desktop icons → open tab-windows
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let di: HtmlElement = el(&d, "desktop");
          add_click(&di, move |ev: web_sys::MouseEvent| {
              let tgt: Element = ev.target().unwrap().dyn_into().unwrap();
              if let Some(ic) = closest(&tgt, "[data-app]") {
                  let a = ic.get_attribute("data-app").unwrap_or_default();
                  open_cb(&s, &d, &w, &apps::app_url(&a));
              }
          }); }

        // toolbar buttons
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "goBtn"), move |_: web_sys::MouseEvent| {
              let inp: HtmlInputElement = el(&d, "urlbar").dyn_into().unwrap();
              navigate_cb(&s, &d, &w, &inp.value()); }); }
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "navBack"), move |_: web_sys::MouseEvent| back_cb(&s, &d, &w)); }
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "navFwd"), move |_: web_sys::MouseEvent| fwd_cb(&s, &d, &w)); }
        { let (s, d) = (s.clone(), d.clone());
          add_click(&el(&d, "navReload"), move |_: web_sys::MouseEvent| render_page(&s, &d)); }
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "navHome"), move |_: web_sys::MouseEvent| home_cb(&s, &d, &w)); }
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "newTabBtn"), move |_: web_sys::MouseEvent| {
              let h = s.borrow().home.clone(); open_cb(&s, &d, &w, &h); }); }
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          add_click(&el(&d, "btnBookmark"), move |_: web_sys::MouseEvent| bookmark_cb(&s, &d, &w)); }
        { let (d) = (d.clone());
          add_click(&el(&d, "btnMenu"), move |_: web_sys::MouseEvent| {
              let e = el(&d, "menuPopup");
              if e.class_list().contains("hidden") { show(&d, "menuPopup"); } else { hide(&d, "menuPopup"); }
          }); }
        { let (d) = (d.clone());
          add_click(&el(&d, "dockBtn"), move |_: web_sys::MouseEvent| { toggle_class(&d, "browser", "minimized", false); hide(&d, "dock"); }); }
        { let (d) = (d.clone());
          add_click(&el(&d, "btnMin"), move |_: web_sys::MouseEvent| {
              toggle_class(&d, "browser", "minimized", true); show(&d, "dock");
              set_text(&d, "statusText", "Browser minimized — click the dock to restore"); }); }
        { let (d) = (d.clone());
          add_click(&el(&d, "btnMax"), move |_: web_sys::MouseEvent| {
              let b = el(&d, "browser");
              if b.class_list().contains("float") { b.class_list().remove_1("float").ok(); }
              else { b.class_list().add_1("float").ok();
                     b.style().set_property("inset", "auto").ok();
                     b.style().set_property("top", "60px").ok(); b.style().set_property("left", "8vw").ok();
                     b.style().set_property("width", "84vw").ok(); b.style().set_property("height", "82vh").ok(); }
          }); }

        // menu popup items
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let mp: HtmlElement = el(&d, "menuPopup");
          add_click(&mp, move |ev: web_sys::MouseEvent| {
              let tgt: Element = ev.target().unwrap().dyn_into().unwrap();
              if let Some(mi) = closest(&tgt, "[data-menu]") {
                  match mi.get_attribute("data-menu").unwrap_or_default().as_str() {
                      "newtab" => { let h = s.borrow().home.clone(); open_cb(&s, &d, &w, &h); }
                      "history" => show_hist(&s, &d),
                      "downloads" => set_text(&d, "statusText", "Downloads: nothing yet"),
                      "fullscreen" => { let _ = js_sys::eval("document.documentElement.requestFullscreen()"); }
                      "closewin" => close_all_cb(&s, &d, &w),
                      _ => {}
                  }
              }
              hide(&d, "menuPopup");
          }); }

        // urlbar Enter
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let ub: HtmlElement = el(&d, "urlbar");
          let c = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
              if ev.key() == "Enter" {
                  let inp: HtmlInputElement = el(&d, "urlbar").dyn_into().unwrap();
                  navigate_cb(&s, &d, &w, &inp.value());
                  let _ = inp.blur();
              }
          }) as Box<dyn FnMut(web_sys::KeyboardEvent)>);
          ub.add_event_listener_with_callback("keydown", c.as_ref().unchecked_ref()).unwrap(); c.forget(); }

        // iframe → shell message bridge
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let et: EventTarget = w.clone().unchecked_into();
          let c = Closure::wrap(Box::new(move |ev: web_sys::MessageEvent| {
              let m: Msg = match serde_wasm_bindgen::from_value(ev.data()) { Ok(m) => m, Err(_) => return };
              if m.r#type.is_empty() { return; }
              match m.r#type.as_str() {
                  "open" => open_cb(&s, &d, &w, &m.url),
                  "search" => navigate_cb(&s, &d, &w, &format!("search:{}", m.q)),
                  "status" => set_text(&d, "statusText", &m.text),
                  "dirty" => set_dirty(&s, m.dirty),
                  "settings" => apply_settings(&s, &d, &w, &m.accent, &m.home, &m.wall),
                  _ => {}
              }
          }) as Box<dyn FnMut(web_sys::MessageEvent)>);
          et.add_event_listener_with_callback("message", c.as_ref().unchecked_ref()).unwrap(); c.forget(); }

        // global keyboard shortcuts (capture phase)
        { let (s, d, w) = (s.clone(), d.clone(), w.clone());
          let et: EventTarget = w.clone().unchecked_into();
          add_keydown(&et, true, move |ev: web_sys::KeyboardEvent| {
              let k = ev.key();
              if ev.alt_key() && k == "ArrowLeft" { back_cb(&s, &d, &w); ev.prevent_default(); return; }
              if ev.alt_key() && k == "ArrowRight" { fwd_cb(&s, &d, &w); ev.prevent_default(); return; }
              if k == "F11" {
                  let _ = js_sys::eval("if(document.fullscreenElement){document.exitFullscreen()}else{document.documentElement.requestFullscreen()}");
                  ev.prevent_default(); return;
              }
              let ctrl = ev.ctrl_key() || ev.meta_key();
              if !ctrl { return; }
              match k.as_str() {
                  "t" => { ev.prevent_default(); let h = s.borrow().home.clone(); open_cb(&s, &d, &w, &h); }
                  "w" => { ev.prevent_default(); let id = s.borrow().active; if let Some(id) = id { close_cb(&s, &d, &w, id); } }
                  "l" => { ev.prevent_default(); let _ = el(&d, "urlbar").focus(); }
                  "r" => { ev.prevent_default(); render_page(&s, &d); }
                  "h" => { ev.prevent_default(); show_hist(&s, &d); }
                  "Tab" => { ev.prevent_default(); cycle_tab(&s, &d, if ev.shift_key() { -1 } else { 1 }); }
                  x if x.len() == 1 && x.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) => {
                      ev.prevent_default();
                      let n: usize = x.chars().next().unwrap() as usize - '0' as usize;
                      if n > 0 { select_nth(&s, &d, n - 1); }
                  }
                  _ => {}
              }
          }); }
    }
}

// ---------- pure logic tests (cargo test on host) ----------
#[cfg(test)]
mod tests {
    use super::*;
    fn sh(init: State) -> Shared { Rc::new(RefCell::new(init)) }
    #[test] fn omnibox_smart() {
        let s = sh(State::default());
        assert_eq!(resolve(&s, "example.org"), "https://example.org");
        assert_eq!(resolve(&s, "hello world rust"), "search:hello world rust");
        assert_eq!(resolve(&s, "app://notes"), "app://notes");
        assert_eq!(resolve(&s, ""), "app://home");
    }
    #[test] fn titles_icons() {
        assert_eq!(title_icon("app://calc").0, "Calculator");
        assert_eq!(title_icon("search:rust").1, "🔍");
        assert_eq!(title_icon("https://example.org/x").0, "example.org");
    }
    #[test] fn apps_render() {
        assert!(apps::render("terminal").unwrap().contains("help"));
        assert!(apps::render("nope").is_none());
        assert!(apps::search_results("a<b").contains("&lt;"));
    }
}
