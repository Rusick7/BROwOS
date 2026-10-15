# AeroOS — a web-OS style browser where windows are tabs

A single-page "operating system" in the browser. The **browser itself is one OS
window on a virtual desktop**, and every additional *window* the user opens is
presented as a **tab** in the tab strip — exactly like a standard web browser,
but turned inside-out: here, "window management" *is* tab management.

## Run it

The browser shell is written in **Rust and compiled to WebAssembly** (`pkg/`).
Open `index.html` via a local web server (WASM needs HTTP, not file://):

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

### Rebuilding the WASM shell

```bash
cd wasm-shell
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target no-modules --out-dir ../pkg \
    target/wasm32-unknown-unknown/release/wasm_shell.wasm
node ../patch_glue.js          # small compatibility patch for the generated glue
node ../test_wasm.js           # end-to-end jsdom smoke test
cargo test                     # unit tests (omnibox, titles, app rendering)
```

## Files

| File              | Purpose                                                        |
|-------------------|----------------------------------------------------------------|
| `index.html`      | Desktop + browser chrome markup; boots the Rust/WASM shell     |
| `style.css`       | OS/desktop styling, dark browser chrome                        |
| `wasm-shell/`     | **Rust source**: `src/lib.rs` (tab-window manager, per-tab history, omnibox, bookmarks, hotkeys, iframe bridge) and `src/apps.rs` (built-in apps: Start, Notes, Calculator, Terminal, Settings, About, Search & error pages) |
| `pkg/`            | Compiled WASM bundle + JS glue (`wasm-bindgen --target no-modules`) |
| `patch_glue.js`   | Post-build patch making the glue accept a precompiled Module   |
| `test_wasm.js`    | jsdom integration test driving the real WASM binary            |
| `main.js`, `apps.js` | Original pure-JS implementation, kept as reference          |

## Features

* **Virtual desktop** with app icons — clicking an icon "launches" an app as a new tab-window.
* **Tab = window**: each tab owns its own URL, title, favicon, loading spinner, dirty flag, pinned state, and independent back/forward history stack.
* **Window controls for the browser itself**: minimize (to dock), maximize/restore, drag-by-titlebar, close.
* **Omnibox** smart input: `example.org` → https, `kittens` → simulated search page, `app://notes` → built-in app.
* Real external sites load in the frame; sites that refuse framing get a friendly "window failed to load" page.
* Tab context menu (duplicate / pin / move / close others), middle-click close, drag-to-reorder.
* Bookmarks bar, global History popup (Ctrl+H), menu (⋮), wallpaper switcher, accent-color setting.
* Shortcuts: Ctrl/Cmd+T/W/L/R/H, Ctrl+Tab, Ctrl+1…8, Alt+←/→, F11.
* Apps communicate with the shell via `postMessage` (open new window/tab, set status text, mark tab dirty, change settings).
