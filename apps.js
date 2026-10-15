/* ============ Built-in "apps" served as pages inside tabs ============ */
/* Each app is a full HTML document rendered in the tab's iframe via srcdoc.   */
/* Pages communicate with the browser shell through window.parent.postMessage. */

const APP_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Segoe UI", system-ui, sans-serif; }
  body { background: #f4f6fa; color: #22272f; }
  header.appbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #dde3ec;
    padding: 14px 22px; display: flex; align-items: center; gap: 12px; z-index: 2; }
  header.appbar h1 { font-size: 17px; font-weight: 600; }
  main { padding: 22px; max-width: 860px; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #dde3ec; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  button.ui { border: 1px solid #c9d3e2; background: #fff; border-radius: 7px; padding: 7px 13px; cursor: pointer; font-size: 13px; }
  button.ui:hover { background: #eef3fb; }
  button.ui.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; }
  input.ui, textarea.ui { border: 1px solid #c9d3e2; border-radius: 7px; padding: 8px 10px; font-size: 13px; outline: none; }
  input.ui:focus, textarea.ui:focus { border-color: #4f8cff; box-shadow: 0 0 0 2px rgba(79,140,255,.2); }
  a.link { color: #2f6fe0; cursor: pointer; text-decoration: underline; }
`;

function doc(title, icon, body, extraStyle = "", script = "") {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>${APP_STYLE}${extraStyle}</style></head>
  <body><header class="appbar"><span style="font-size:20px">${icon}</span><h1>${title}</h1></header>
  <main>${body}</main><script>${script}<\/script></body></html>`;
}

/* helper injected into every app so links can ask the shell to open new tabs/windows */
const BRIDGE = `
  function openWindow(url, title){ parent.postMessage({type:'openTab', url, title}, '*'); }
  function setStatus(t){ parent.postMessage({type:'status', text:t}, '*'); }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-href]');
    if (a) { e.preventDefault();
      if (a.target === '_blank') openWindow(a.dataset.href, null);
      else location.href = a.dataset.href; }
  });
`;

const APPS = {};

/* ---------------------------- Start page ---------------------------- */
APPS.home = doc("AeroOS Start", "🌐", `
  <div class="card" style="text-align:center;padding:30px">
    <div style="font-size:44px">🌐</div>
    <h2 style="margin:8px 0 4px">Welcome to AeroOS</h2>
    <p style="color:#68707e;font-size:13.5px;margin-bottom:16px">
      A web-OS style browser — every window you open lives as a <b>tab</b> in the strip above.</p>
    <input class="ui" id="q" placeholder="Search the web…" style="width:min(420px,80%);padding:11px 16px;border-radius:22px">
    <button class="ui primary" id="go" style="padding:11px 18px;border-radius:22px">Search</button>
  </div>
  <div class="card">
    <h3 style="font-size:14px;margin-bottom:10px">Quick launch</h3>
    <div id="tiles" style="display:flex;flex-wrap:wrap;gap:10px"></div>
  </div>
  <div class="card">
    <h3 style="font-size:14px;margin-bottom:10px">Browse the real web (in-tab navigation)</h3>
    <p style="font-size:13px;line-height:2">
      <a class="link" data-href="https://example.org" target="_blank">example.org</a> ·
      <a class="link" data-href="https://wikipedia.org" target="_blank">Wikipedia</a> ·
      <a class="link" data-href="https://developer.mozilla.org" target="_blank">MDN Web Docs</a> ·
      <a class="link" data-href="https://news.ycombinator.com" target="_blank">Hacker News</a>
      <br><span style="color:#8a93a3;font-size:11.5px">Note: some sites refuse framing (X-Frame-Options) and will show blank — that's normal for sandboxed frames.</span>
    </p>
  </div>
`, "", BRIDGE + `
  const tiles = document.getElementById('tiles');
  const apps = [['notes','📝','Notes'],['calc','🧮','Calculator'],['terminal','💻','Terminal'],['settings','⚙️','Settings'],['about','ℹ️','About']];
  for (const [id, ic, name] of apps) {
    const b = document.createElement('button'); b.className='ui'; b.style.fontSize='13px';
    b.textContent = ic+'  '+name;
    b.onclick = () => openWindow('app://'+id, name);
    tiles.appendChild(b);
  }
  const search = () => { const v = document.getElementById('q').value.trim();
    if (v) location.href = 'search://' + encodeURIComponent(v); };
  document.getElementById('go').onclick = search;
  document.getElementById('q').addEventListener('keydown', e => { if(e.key==='Enter') search(); });
`);

/* ---------------------------- Notes app ---------------------------- */
APPS.notes = doc("Notes", "📝", `
  <div class="card">
    <textarea class="ui" id="txt" rows="14" style="width:100%;resize:vertical" placeholder="Type your notes… (saved automatically)"></textarea>
    <div style="display:flex;justify-content:space-between;margin-top:10px">
      <span id="hint" style="color:#8a93a3;font-size:12px;align-self:center">Autosaves locally</span>
      <span><button class="ui" id="clear">Clear</button> <button class="ui primary" id="save">Save now</button></span>
    </div>
  </div>
`, "", BRIDGE + `
  const t = document.getElementById('txt');
  try { t.value = localStorage.getItem('aero.notes') || ''; } catch(e){}
  let dirty = false;
  const save = () => { try{ localStorage.setItem('aero.notes', t.value);}catch(e){}
    dirty=false; setStatus('Notes saved'); };
  t.addEventListener('input', () => { dirty = true;
    parent.postMessage({type:'tabDirty', dirty:true}, '*');
    clearTimeout(t._to); t._to = setTimeout(save, 800); });
  document.getElementById('save').onclick = save;
  document.getElementById('clear').onclick = () => { t.value=''; save(); };
`);

/* ---------------------------- Calculator ---------------------------- */
APPS.calc = doc("Calculator", "🧮", `
  <div class="card" style="max-width:320px;margin:0 auto">
    <input class="ui" id="disp" readonly style="width:100%;font-size:22px;text-align:right;margin-bottom:10px" value="0">
    <div id="keys" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>
  </div>
`, `#keys button{padding:16px 0;font-size:16px;border-radius:8px;border:1px solid #c9d3e2;background:#fff;cursor:pointer}
   #keys button.op{background:#eef3fb} #keys button.eq{background:#4f8cff;color:#fff;border-color:#4f8cff}
   #keys button:hover{filter:brightness(.96)}`, BRIDGE + `
  const disp=document.getElementById('disp'), keys=document.getElementById('keys');
  let expr='';
  const render=()=>disp.value=expr||'0';
  ['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+'].forEach(k=>{
    const b=document.createElement('button'); b.textContent=k;
    if('÷×−+'.includes(k)) b.className='op'; if(k==='=') {b.className='eq'; b.style.gridColumn='3';}
    b.onclick=()=>{
      if(k==='='){ try{ expr=String(Function('return ('+expr.replace(/÷|×|−/g,c=>({'÷':'/','×':'*','−':'-'}[c]))+')')()); }catch(e){ expr='Error'; } render(); return; }
      if(expr==='Error') expr='';
      expr+=k; render();
    };
    keys.appendChild(b);
  });
`);

/* ---------------------------- Terminal ---------------------------- */
APPS.terminal = doc("Terminal", "💻", `
  <div class="card" style="background:#14161c;border-color:#000">
    <div id="out" style="font-family:Consolas,monospace;font-size:13px;color:#b9f2c6;white-space:pre-wrap;min-height:220px;max-height:340px;overflow:auto"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <span style="color:#7ee787;font-family:monospace">aero@browser:~$</span>
      <input id="cmd" autocomplete="off" style="flex:1;background:transparent;border:none;outline:none;color:#e6edf3;font-family:monospace;font-size:13px">
    </div>
  </div>
`, "", BRIDGE + `
  const out=document.getElementById('out'), cmd=document.getElementById('cmd');
  const FS=['readme.txt','notes','secret.png','todo.md'];
  const print=s=>{ out.textContent+=s+'\\n'; out.scrollTop=out.scrollHeight; };
  print('AeroOS Terminal v1.0 — type "help".');
  const NL = String.fromCharCode(10);
  const cmds={
    help:()=>'Commands: help, ls, echo <msg>, date, open <app>, whoami, clear, neofetch',
    ls:()=>FS.join('   '),
    date:()=>new Date().toString(),
    whoami:()=>'aero (guest session inside a browser tab)',
    echo:a=>a.join(' '),
    clear:()=>{out.textContent='';return null},
    open:a=>{ const id=a[0]||''; openWindow('app://'+id,id); return 'Opening '+id+' in a new tab…'; },
    neofetch:()=>'        🪟  AeroOS Browser'+NL+
      '  ─────────────────────'+NL+
      '  OS: Web-OS Shell 1.0'+NL+
      '  Windows: shown as tabs'+NL+
      '  Engine: '+navigator.userAgent.split(') ')[0].split(' (')[0]+NL+
      '  Memory: '+(navigator.deviceMemory||'?')+' GB'+NL+
      '  Screen: '+window.screen.width+'x'+window.screen.height+NL+
      '  Frame: sandboxed iframe #'+Math.floor(Math.random()*900+100)
  };
  cmd.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    const raw=cmd.value.trim(); cmd.value='';
    if(!raw)return;
    print('aero@browser:~$ '+raw);
    const [c,...a]=raw.split(' ');
    const f=cmds[c.toLowerCase()];
    if(!f){print('Unknown command: '+c+" — try 'help'");return;}
    try{ const r=f(a); if(r!=null) print(r); }catch(err){ print('error: '+err.message); }
  });
  setTimeout(()=>cmd.focus(),100);
`);

/* ---------------------------- Settings ---------------------------- */
APPS.settings = doc("Settings", "⚙️", `
  <div class="card">
    <h3 style="font-size:14px;margin-bottom:12px">Appearance</h3>
    <label style="font-size:13px;display:block;margin-bottom:10px">Browser accent color
      <input type="color" id="accent" value="#4f8cff" style="vertical-align:middle;margin-left:8px"></label>
    <label style="font-size:13px"><input type="checkbox" id="darkStart" checked> Dark desktop wallpaper</label>
  </div>
  <div class="card">
    <h3 style="font-size:14px;margin-bottom:12px">Startup</h3>
    <label style="font-size:13px">Home page
      <select id="homeSel" class="ui" style="margin-left:8px">
        <option value="app://home">AeroOS Start</option>
        <option value="app://notes">Notes</option>
        <option value="app://terminal">Terminal</option>
      </select></label>
  </div>
  <div class="card">
    <h3 style="font-size:14px;margin-bottom:12px">Danger zone</h3>
    <button class="ui" id="resetAll">Reset all settings &amp; close all windows</button>
  </div>
`, "", BRIDGE + `
  document.getElementById('accent').oninput = e =>
    parent.postMessage({type:'setAccent', color:e.target.value}, '*');
  document.getElementById('darkStart').onchange = e =>
    parent.postMessage({type:'setWallpaper', dark:e.target.checked}, '*');
  document.getElementById('homeSel').onchange = e =>
    parent.postMessage({type:'setHome', url:e.target.value}, '*');
  document.getElementById('resetAll').onclick = () =>
    parent.postMessage({type:'resetAll'}, '*');
`);

/* ---------------------------- About ---------------------------- */
APPS.about = doc("About AeroOS", "ℹ️", `
  <div class="card">
    <h3 style="margin-bottom:10px">The idea</h3>
    <p style="font-size:13.5px;line-height:1.7">This browser imitates a <b>web operating system</b>:
    it runs on a virtual desktop, has a single application window, and — like modern browsers do
    with tabs — presents each additional <b>window</b> as a <b>tab</b> in the tab strip. Open a link
    with <code>target=_blank</code> or from the launcher and a new "window" appears as a tab.</p>
  </div>
  <div class="card">
    <h3 style="margin-bottom:10px">Keyboard shortcuts</h3>
    <table style="font-size:13px;line-height:2;width:100%">
      <tr><td>New window/tab</td><td align="right"><kbd>Ctrl/Cmd + T</kbd></td></tr>
      <tr><td>Close current window/tab</td><td align="right"><kbd>Ctrl/Cmd + W</kbd></td></tr>
      <tr><td>Switch windows</td><td align="right"><kbd>Ctrl + Tab</kbd> / <kbd>Ctrl 1…8</kbd></td></tr>
      <tr><td>Focus address bar</td><td align="right"><kbd>Ctrl/Cmd + L</kbd></td></tr>
      <tr><td>Navigate back / forward</td><td align="right"><kbd>Alt + ←/→</kbd></td></tr>
      <tr><td>Reload</td><td align="right"><kbd>Ctrl/Cmd + R</kbd></td></tr>
    </table>
  </div>
  <div class="card">
    <h3 style="margin-bottom:10px">Window management per tab</h3>
    <p style="font-size:13.5px;line-height:1.7">Right-click any tab to <b>duplicate</b>, <b>pin</b>,
    move it to a <b>new position</b>, or <b>close other windows</b>. Tabs can be dragged to reorder.
    Unsaved changes in an app (try Notes!) mark the tab as modified.</p>
  </div>
`, "", BRIDGE + ``);

/* Search results "page" (simulated SERP since we can't scrape) */
APPS.search = (query) => doc(`Search: ${query}`, "🔎", `
  <div class="card">
    <p style="color:#68707e;font-size:12.5px;margin-bottom:12px">Results for “<b>${query.replace(/</g,'&lt;')}</b>” (simulated — pick a destination to open it in a new window/tab):</p>
    <div id="res"></div>
  </div>
`, "", BRIDGE + `
  const q = decodeURIComponent(${JSON.stringify(query)});
  const targets = [
    ['https://wikipedia.org/wiki/'+encodeURIComponent(q), 'Wikipedia', 'wikipedia.org — the free encyclopedia'],
    ['https://duckduckgo.com/?q='+encodeURIComponent(q), 'DuckDuckGo: '+q, 'Search the live web for this query'],
    ['https://www.google.com/search?q='+encodeURIComponent(q), 'Google: '+q, 'Search the live web for this query'],
    ['https://developer.mozilla.org/en-US/search?q='+encodeURIComponent(q), 'MDN docs', 'Developer documentation results'],
  ];
  const res=document.getElementById('res');
  targets.forEach(([url,t,d],i)=>{
    const div=document.createElement('div'); div.style.cssText='padding:12px 0;border-bottom:1px solid #e6ebf3';
    div.innerHTML='<div style="font-size:12px;color:#3f8446">'+new URL(url).host+'</div>'+
      '<a class="link" style="font-size:15px">'+t+'</a><div style="font-size:12.5px;color:#68707e">'+d+'</div>';
    div.querySelector('a').onclick=()=>openWindow(url,t);
    if(i===0) div.querySelector('a').onclick=()=>{location.href=url};
    res.appendChild(div);
  });
`);

/* Error page for blocked external sites */
APPS.error = (url, reason) => doc("Window failed to load", "⛔", `
  <div class="card" style="text-align:center;padding:36px">
    <div style="font-size:40px">⛔</div>
    <h2 style="margin:10px 0">This window could not be displayed</h2>
    <p style="color:#68707e;font-size:13px;max-width:520px;margin:0 auto 14px">${reason}</p>
    <p style="font-family:monospace;font-size:12px;color:#98a1b2;margin-bottom:18px">${String(url).replace(/</g,'&lt;')}</p>
    <button class="ui primary" onclick="window.open('${String(url).replace(/'/g,'%27')}','_blank')">Open in a real browser window instead</button>
    <button class="ui" onclick="history.back()">Go back</button>
  </div>
`, "", BRIDGE);
