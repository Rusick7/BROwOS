const fs = require('fs');
let g = fs.readFileSync('pkg/wasm_shell.js', 'utf8');
// remove any previously inserted fast-path lines (in wrong function)
g = g.split('\n').filter(l => !l.includes("const inst = await WebAssembly.instantiate(module_or_path, imports)")).join('\n');
// ensure pattern A applied
if (!g.includes("!(module_or_path && typeof module_or_path.compile === 'function')")) {
  const a = "if (typeof module_or_path !== 'undefined') {";
  const b = "if (typeof module_or_path !== 'undefined' && !(module_or_path && typeof module_or_path.compile === 'function')) {";
  if (!g.includes(a)) { console.error('pattern A missing'); process.exit(1); }
  g = g.replace(a, b);
}
// insert Module fast-path ONLY inside async __wbg_init: anchor on the unique fetch line that follows init_memory in __wbg_init
const anchor = "            module_or_path = fetch(module_or_path);\n        }\n\n        __wbg_init_memory(imports);";
if (!g.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
const repl = anchor + "\n\n        if (module_or_path && typeof module_or_path.compile === 'function') { const inst = await WebAssembly.instantiate(module_or_path, imports); return __wbg_finalize_init(inst.instance, inst.module); }";
g = g.replace(anchor, repl);
fs.writeFileSync('pkg/wasm_shell.js', g);
console.log('glue patched OK');
