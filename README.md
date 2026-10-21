# md-light

Ein schlanker Markdown-Editor im Stil von Typora: Schreiben und Lesen passieren
im selben Fenster. Du tippst Markdown, und es wird sofort formatiert –
`### Titel` wird beim Leerzeichen direkt zur H3, `**fett**` wird **fett**,
`- ` startet eine Liste. Gespeichert wird immer als reines Markdown.

Native macOS-App auf Basis von [Tauri](https://tauri.app) (≈10 MB statt
Electron) mit dem [Milkdown](https://milkdown.dev)/ProseMirror-Editor.

![md-light](assets/icon.png)

## Was beim Tippen passiert

| Du tippst                   | Ergebnis                         |
| --------------------------- | -------------------------------- |
| `# ` … `###### `            | Überschrift H1–H6                |
| `**text**` / `*text*`       | **fett** / *kursiv*              |
| `` `code` `` / `~~text~~`   | Inline-Code / ~~durchgestrichen~~ |
| `- ` / `* ` / `1. `         | Aufzählung / nummerierte Liste   |
| `- [ ] `                    | Checkbox (anklickbar)            |
| `> `                        | Zitat                            |
| ```` ``` ```` + Enter       | Codeblock                        |
| `---`                       | Trennlinie                       |
| `\| Name \| Alter \|` + Enter | Tabelle mit diesen Spalten       |
| `![alt](bild.png)`          | Bild (relativ zur Datei)         |

Typora-Details: Steht der Cursor in einer Überschrift, zeigt der linke Rand
die `###`-Marker. Backspace am Anfang einer Überschrift macht sie wieder zu
normalem Text. ⌘-Klick öffnet Links.

## Tastenkürzel

| Kürzel        | Aktion                                  |
| ------------- | --------------------------------------- |
| ⌘N / ⌘O       | Neues Fenster / Datei öffnen            |
| ⌘S / ⇧⌘S      | Speichern / Speichern unter             |
| ⌘/            | Source-Modus (rohes Markdown) umschalten |
| ⌘1 … ⌘6, ⌘0   | Überschrift 1–6, normaler Absatz        |
| ⌘B / ⌘I / ⌘E  | Fett / Kursiv / Inline-Code             |
| ⇧⌘X           | Durchgestrichen                         |
| ⌥⌘Q / ⌥⌘O / ⌥⌘U | Zitat / nummerierte / Aufzählungsliste |
| ⌥⌘C / ⌥⌘T     | Codeblock / Tabelle                     |
| ⌘= / ⌘- / ⇧⌘0 | Zoom                                    |

Außerdem: `.md`-Dateien per Doppelklick im Finder, „Öffnen mit“, aufs
Dock-Icon oder ins Fenster ziehen. Ungespeicherte Änderungen werden beim
Schließen und Beenden abgefragt. Hell/Dunkel folgt dem System.

## Entwickeln

Voraussetzungen: Node 20+, Rust (`rustup`) und die Xcode Command Line Tools.

```bash
npm install
npm run app:dev     # native App mit Hot Reload
npm run app:build   # baut md-light.app + .dmg nach src-tauri/target/release/bundle/
npm run dev         # nur das Frontend im Browser (http://localhost:1420)
```

Fertige Builds ohne lokales Rust: einen Tag wie `v0.1.0` pushen – die
GitHub-Action in `.github/workflows/release.yml` baut eine Universal-App
(Apple Silicon + Intel) und hängt die `.dmg` an ein Release-Draft.

> Die App ist nicht signiert. Beim ersten Start: Rechtsklick → „Öffnen“.

## Aufbau

```
src/
  main.ts       Dokument-Zustand, Öffnen/Speichern, Menübefehle, Statusleiste
  editor.ts     Milkdown-Setup + Typora-Extras (###-Hinweis, Pipe-Tabellen, Checkboxen)
  source.ts     Source-Modus (Textarea mit Listen-Fortsetzung, Tab, Formatierung)
  platform.ts   Tauri-Anbindung bzw. Browser-Fallback
  style.css     Theme (hell/dunkel)
src-tauri/
  src/lib.rs    Fenster, natives Menü, Datei-I/O, Finder-Integration, Beenden-Dialog
```
