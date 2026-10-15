# AeroOS — a web-OS style browser where windows are tabs

A single-page "operating system" in the browser. The **browser itself is one OS
window on a virtual desktop**, and every additional *window* the user opens is
presented as a **tab** in the tab strip — exactly like a standard web browser,
but turned inside-out: here, "window management" *is* tab management.

## Run it

No build step, no dependencies — plain HTML/CSS/JS:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

(or just open `index.html` directly)

## Files

| File          | Purpose                                                        |
|---------------|----------------------------------------------------------------|
| `index.html`  | Desktop + browser chrome (titlebar, tab strip, toolbar, status bar) |
| `style.css`   | OS/desktop styling, dark browser chrome                        |
| `apps.js`     | Built-in apps (Start, Notes, Calculator, Terminal, Settings, About, Search & error pages) rendered into tabs via `srcdoc` |
| `main.js`     | Browser shell: tab/window manager, per-tab history stack, omnibox, bookmarks, popups, keyboard shortcuts, window controls |

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
