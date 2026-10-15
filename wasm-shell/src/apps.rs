// BROwOS — built-in applications, rendered as "windows" (tabs).
// Written in Rust; compiled to WebAssembly.

pub fn app_url(name: &str) -> String { format!("app://{}", name) }
pub fn is_app(url: &str) -> bool { url.starts_with("app://") }
pub fn app_name(url: &str) -> String { url["app://".len()..].split('/').next().unwrap_or("").to_string() }

fn esc_html(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }

pub fn title_for(name: &str) -> &'static str {
    match name {
        "home" => "AeroOS Start", "notes" => "Notes", "calc" => "Calculator",
        "terminal" => "Terminal", "settings" => "Settings", "about" => "About AeroOS",
        _ => "AeroOS",
    }
}
pub fn icon_for(name: &str) -> &'static str {
    match name {
        "home" => "🌐", "notes" => "📝", "calc" => "🧮",
        "terminal" => "💻", "settings" => "⚙️", "about" => "ℹ️", _ => "🔷",
    }
}

pub fn render(name: &str) -> Option<String> {
    let body = match name {
        "home" => home(), "notes" => notes(), "calc" => calc(),
        "terminal" => terminal(), "settings" => settings(), "about" => about(),
        _ => return None,
    };
    Some(page(name, &body))
}

fn page(name: &str, inner: &str) -> String {
    format!(r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>{}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:"Segoe UI",system-ui,sans-serif;background:#f4f6fb;color:#223;min-height:100vh}}
main{{max-width:760px;margin:0 auto;padding:28px 22px}}
h1{{font-weight:600;font-size:26px;margin-bottom:14px}} h2{{font-size:15px;margin:18px 0 8px;color:#456}}
.card{{background:#fff;border:1px solid #dde3ef;border-radius:12px;padding:16px;box-shadow:0 4px 14px rgba(40,60,120,.06)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px}}
.app-tile{{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #dde3ef;border-radius:10px;background:#fff;cursor:pointer;font-size:14px}}
.app-tile:hover{{border-color:#4f8cff;background:#f0f6ff}}
button{{font:inherit;cursor:pointer}}
input,textarea{{font:inherit}}
code,pre{{font-family:ui-monospace,Consolas,monospace}}
</style></head><body><main>{}</main><script>{}</script></body></html>"#,
    title_for(name), inner, BRIDGE_JS)
}

// JS injected into every app document: relays clicks + messages to the shell via postMessage.
pub const BRIDGE_JS: &str = r#"
(function(){
  var send=function(m){try{parent.postMessage(Object.assign({__aero:1},m),'*')}catch(e){}};
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-open],[data-search]'); if(!t)return;
    e.preventDefault();
    if(t.dataset.open) send({type:'open',url:'app://'+t.dataset.open});
    if(t.dataset.search!==undefined) send({type:'search',q:t.dataset.search});
  });
  window.aeroStatus=function(s){send({type:'status',text:s})};
  window.aeroDirty=function(d){send({type:'dirty',dirty:!!d})};
})();
"#;

fn tile(icon: &str, label: &str, app: &str) -> String {
    format!(r#"<button class="app-tile" data-open="{app}"><span style="font-size:20px">{icon}</span>{label}</button>"#)
}

fn home() -> String {
    format!(r#"
<div style="text-align:center;padding:34px 0 10px">
  <div style="font-size:52px">🔷</div><h1>AeroOS</h1>
  <div style="color:#678">Every window is a tab. Every tab is a window.</div>
</div>
<div class="card" style="margin-top:18px">
  <b>Quick actions</b>
  <div class="grid">{}{}{}{}</div>
</div>
<div class="card" style="margin-top:14px">
  <b>Try the omnibox</b>
  <p style="color:#567;font-size:13.5px;margin-top:6px">
   Type <code>example.org</code> → opens https://example.org · free text → search ·
   <code>app://notes</code> → opens an app “window”. Use ← / → per-tab history, pin tabs, drag to reorder.</p>
  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="app-tile" data-search="rust wasm">Search: rust wasm</button>
    <button class="app-tile" data-search="webos">Search: webos</button>
  </div>
</div>"#,
        tile("📝","Notes","notes"), tile("🧮","Calculator","calc"),
        tile("💻","Terminal","terminal"), tile("⚙️","Settings","settings"))
}

fn notes() -> String {
    format!(r#"
<h1>📝 Notes</h1>
<div class="card"><textarea id="ta" rows="16" style="width:100%;border:1px solid #cfd8ea;border-radius:8px;padding:10px;resize:vertical"
placeholder="Autosaved to browser storage…"></textarea>
<div style="margin-top:8px;color:#678;font-size:12.5px">Saved locally · closing the tab asks for confirmation while unsaved changes exist</div></div>
<script>
var ta=document.getElementById('ta'),key='aero.notes';
ta.value=localStorage.getItem(key)||'';
var dirty=false;
ta.addEventListener('input',function(){{
  localStorage.setItem(key,ta.value);
  if(!dirty){{dirty=true;aeroDirty(true);}}
  clearTimeout(ta._t);
  ta._t=setTimeout(function(){{dirty=false;aeroDirty(false);}},600);
}});
</script>"#)
}

fn calc() -> String {
    let keys = ["7","8","9","÷","4","5","6","×","1","2","3","−","0",".","=","+"];
    let mut grid = String::new();
    for k in keys {
        grid.push_str(&format!(r#"<button style="padding:14px;font-size:17px;border:1px solid #cfd8ea;border-radius:8px;background:#fff" onclick="press('{k}')">{k}</button>"#));
    }
    format!(r#"
<h1>🧮 Calculator</h1>
<div class="card">
  <input id="disp" readonly style="width:100%;font-size:24px;text-align:right;padding:10px;border:1px solid #cfd8ea;border-radius:8px;margin-bottom:12px">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">{grid}
    <button style="grid-column:span 2;padding:14px;border:1px solid #cfd8ea;border-radius:8px;background:#fee" onclick="clr()">C</button>
    <button style="grid-column:span 2;padding:14px;border:1px solid #cfd8ea;border-radius:8px" onclick="back()">⌫</button>
  </div>
</div>
<script>
var d=document.getElementById('disp');
function press(k){{if(k==='='){{evalD();return}} d.value+=k}}
function clr(){{d.value=''}} function back(){{d.value=d.value.slice(0,-1)}}
function evalD(){{try{{var s=d.value.replace(/÷/g,'/').replace(/×/g,'*').replace(/−/g,'-');
  if(!/^[-+*/().\\d\\s]+$/.test(s))throw 0;d.value=String(Function('"use strict";return('+s+')')())}}catch(e){{d.value='Error'}}}}
</script>"#)
}

fn terminal() -> String {
    r##"
<h1>💻 Terminal</h1>
<div class="card" style="background:#10151f;color:#cfe3ff;font-family:ui-monospace,Consolas,monospace">
<pre id="out" style="min-height:220px;font-size:13px;white-space:pre-wrap">AeroOS terminal (Rust/WASM shell) — type `help`.</pre>
<div style="display:flex;gap:6px"><span>$</span><input id="cmd" autofocus style="flex:1;background:transparent;border:none;outline:none;color:#cfe3ff;font:inherit"></div>
</div>
<script>
var out=document.getElementById('out'),cmd=document.getElementById('cmd');
cmd.addEventListener('keydown',function(e){
  if(e.key!=='Enter')return; var line=cmd.value.trim(); cmd.value='';
  run(line);
});
function echo(s){out.textContent+='\n'+s;out.parentElement.scrollTop=1e9}
function run(line){
  echo('$ '+line);
  var p=line.split(/\s+/),c=p[0],a=p.slice(1).join(' ');
  switch(c){
    case '':break;
    case 'help':echo('commands: help ls open <app> status date clear neofetch');break;
    case 'ls':echo('apps.js  index.html  main.js  style.css  README.md');break;
    case 'open':
      var apps=['home','notes','calc','terminal','settings','about'];
      if(apps.indexOf(a)>=0){parent.postMessage({__aero:1,type:'open',url:'app://'+a},'*');echo('opening '+a+'… (new tab-window)')}
      else echo('unknown app: '+a);break;
    case 'status':aeroStatus(a||'status set from terminal');echo('status bar updated');break;
    case 'date':echo(new Date().toString());break;
    case 'clear':out.textContent='';break;
    case 'neofetch':echo('   🔷 AeroOS\n   kernel: rust→wasm32\n   shell: BROwOS tabs-as-windows');break;
    default:echo('command not found: '+c);
  }
}
</script>"##.to_string()
}

fn settings() -> String {
    r###"
<h1>⚙️ Settings</h1>
<div class="card">
  <h2>Accent color</h2>
  <input type="color" id="acc" value="#4f8cff" style="width:64px;height:36px;border:none;background:none">
  <h2>Home page</h2>
  <input id="home" style="width:100%;padding:8px;border:1px solid #cfd8ea;border-radius:8px" placeholder="app://home or https://…">
  <h2>Wallpaper</h2>
  <select id="wall" style="padding:8px;border-radius:8px;border:1px solid #cfd8ea">
    <option value="0">Deep Space</option><option value="1">Sunset</option><option value="2">Forest</option>
  </select>
  <div style="margin-top:16px"><button onclick="save()" style="padding:9px 18px;border-radius:8px;border:none;background:#4f8cff;color:#fff">Apply</button></div>
</div>
<script>
var g=function(k){try{var o={};var s=localStorage.getItem('aero.settings');if(s)o=JSON.parse(s);return o[k]}catch(e){return undefined}};
document.getElementById('acc').value=g('accent')||'#4f8cff';
document.getElementById('home').value=g('home')||'app://home';
document.getElementById('wall').value=g('wall')||'0';
function save(){parent.postMessage({__aero:1,type:'settings',
  accent:document.getElementById('acc').value,
  home:document.getElementById('home').value,
  wall:document.getElementById('wall').value},"*");aeroStatus('Settings applied')}
</script>"###.to_string()
}

fn about() -> String {
    r##"
<h1>ℹ️ About AeroOS</h1>
<div class="card">
<p><b>AeroOS</b> is a web-OS style browser where <b>windows are presented as tabs</b>.</p>
<ul style="margin:12px 0 0 20px;line-height:1.9;font-size:14px">
<li>Shell logic compiled from <b>Rust → WebAssembly</b> (wasm-bindgen)</li>
<li>Per-tab history stacks, pinned tabs, bookmarks bar, global history</li>
<li>Browser window: minimize to dock, drag by title bar, maximize/restore</li>
<li>Keyboard: Ctrl+T / W / L / R / H, Ctrl+Tab, Ctrl+1…8, Alt+←/→, F11</li>
</ul></div>"##.to_string()
}

pub fn search_results(q: &str) -> String {
    let qe = esc_html(q);
    let items = ["Docs", "Wiki", "Tutorial", "GitHub", "News"];
    let mut lis = String::new();
    for (i, it) in items.iter().enumerate() {
        lis.push_str(&format!(
            "<div class=\"card\" style=\"margin-top:10px\"><a style=\"color:#1a56db;font-size:16px\" href=\"#\">{it}: {qe}</a>\
             <div style=\"color:#567;font-size:13px;margin-top:4px\">Result #{i} — simulated page for “{qe}”. \
             This OS renders search results inside a tab-window.</div></div>", it = it, qe = qe, i = i));
    }
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{qe} — AeroSearch</title>\
         <style>*{{box-sizing:border-box;margin:0;padding:0}}body{{font-family:\"Segoe UI\",system-ui;background:#f4f6fb;padding:26px}}\
         .card{{background:#fff;border:1px solid #dde3ef;border-radius:10px;padding:14px;max-width:640px}}</style></head>\
         <body><h2 style=\"font-weight:600;margin-bottom:6px\">AeroSearch</h2>\
         <div style=\"color:#678\">Results for <b>{qe}</b></div>{lis}</body></html>",
        qe = qe, lis = lis)
}
