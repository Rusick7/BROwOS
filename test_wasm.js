const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
global.window = window; global.document = window.document;
let glue = fs.readFileSync('pkg/wasm_shell.js', 'utf8');
glue += '\nwindow.wasm_bindgen = wasm_bindgen;'; // expose module-scope global for the test harness
window.eval(glue);
const wasmBytes = fs.readFileSync('pkg/wasm_shell_bg.wasm');
(async () => {
  const mod = await WebAssembly.compile(wasmBytes);
  await window.wasm_bindgen(mod); // no-modules glue accepts a compiled Module directly
  const m = window.wasm_bindgen; // exports live on this object in no-modules mode
  const shell = new m.Shell();
  shell.boot();
  const d = window.document;
  const tabs = () => [...d.querySelectorAll('#tabs .tab')];
  console.log('TABS after boot:', tabs().length, '| title:', tabs()[0]?.textContent.trim().slice(0,30));
  shell.open_url('app://calc');
  console.log('TABS after open calc:', tabs().length, '| active title:', tabs()[1]?.textContent.trim());
  shell.navigate('rust wasm tutorial');
  console.log('after search tab2:', tabs()[1]?.textContent.trim(), '| srcdoc has AeroSearch:', (d.getElementById('pageFrame').getAttribute('srcdoc')||'').includes('AeroSearch'));
  shell.go_back(); console.log('back ->', tabs()[1]?.textContent.trim());
  shell.go_fwd();  console.log('fwd  ->', tabs()[1]?.textContent.trim());
  tabs()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  console.log('frame is start page:', (d.getElementById('pageFrame').getAttribute('srcdoc')||'').includes('AeroOS'));
  shell.bookmark_current();
  console.log('bookmarks rendered:', d.querySelectorAll('[data-bm]').length);
  tabs()[1].querySelector('[data-close]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  console.log('TABS after close:', tabs().length);
  d.querySelector('[data-app="notes"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  console.log('TABS after desktop Notes:', tabs().length, '| last:', tabs()[tabs().length-1].textContent.trim());
  shell.show_history();
  console.log('history popup visible:', !d.getElementById('histPopup').className.includes('hidden'), '| entries:', d.querySelectorAll('#histPopup [data-url]').length);
  console.log('ALL OK');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
