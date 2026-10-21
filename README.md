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
| `$E=mc^2$`                  | LaTeX-Formel inline (KaTeX)      |
| `$$` + Enter                | LaTeX-Formelblock                |
| `==text==`                  | ==Hervorhebung==                 |
| `[text](https://…)`         | Link                             |
| ```` ```js ```` + Enter     | Codeblock mit Syntax-Highlighting |
| ```` ```mermaid ````        | Diagramm (Mermaid) mit Live-Vorschau |
| `> [!NOTE]` / `[!TIP]` / `[!WARNING]` … | Callout-Box (GitHub-Stil) |
| `[TOC]`                     | Inhaltsverzeichnis (klickbar)    |
| `---` am Dateianfang        | YAML-Front-Matter                |
| `Text[^1]` / `[^1]: …`      | Fußnote                          |
| `/`                         | Befehlsmenü wie in Notion        |

Typora-Details: Steht der Cursor in einer Überschrift, zeigt der linke Rand
die `###`-Marker. Formeln zeigen ihren LaTeX-Quelltext, sobald der Cursor
darin steht, und sonst die gerenderte Formel. Backspace am Anfang einer
Überschrift macht sie wieder zu normalem Text. ⌘-Klick öffnet Links, ⌘K
bearbeitet sie. Gespeichert wird immer Markdown, das Typora, Obsidian und
GitHub verstehen.

## Titelleiste und Seitenleiste

- **Dateiname oben in der Mitte** (wie bei Pages/TextEdit): Klick öffnet ein
  Popover mit *Name* und *Ort*. Damit benennst du die Datei um oder verschiebst
  sie in einen anderen Ordner. Ein neues Dokument wird darüber direkt
  gespeichert. „— Edited“ zeigt ungespeicherte Änderungen.
- **Rechts oben:** „207 Words ⌃⌄“ (umschaltbar auf Zeichen, Absätze,
  Lesezeit), Source-Modus, Gliederung und Seitenleiste.
- **Seitenleiste (⇧⌘L):** alle Ordner, in denen du Dateien geöffnet oder
  gespeichert hast, aufklappbar mit Unterordnern und Markdown-Dateien. **+**
  am Ordner legt dort sofort eine neue Datei an, **×** entfernt den Ordner aus
  der Liste, „+ Add Folder…“ fügt einen hinzu. Ein Klick auf eine Datei öffnet
  sie im selben Fenster. Breite per Ziehen am Rand einstellbar.
- **Gliederung (⇧⌘1):** alle Überschriften des Dokuments zum Springen.

Im Browser lässt sich das mit `npm run dev` und `http://localhost:1420/?demo`
ausprobieren (Beispielordner im Speicher).

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
| ⌥⌘B / ⌃M      | Formelblock / Inline-Formel             |
| ⇧⌘H / ⌘K      | Hervorheben / Link                      |
| ⇧⌘I           | Bild einfügen…                          |
| ⌘,            | Einstellungen                           |
| ⇧⌘L / ⇧⌘1     | Seitenleiste / Gliederung               |
| ⌘= / ⌘- / ⇧⌘0 | Zoom                                    |

## Einstellungen (⌘,)

- **Bilder – „When Insert…“** wie bei Typora: Eingefügte Bilder,
  Screenshots oder ins Fenster gezogene Bilder werden
  - nicht angefasst,
  - in den Ordner der Datei (`./`),
  - nach `./${filename}.assets` oder
  - in einen eigenen Ordner kopiert (Standard: `./_assets`; `./…`, `../…`
    oder absolut, `${filename}` = Dateiname).

  Dazu: „Apply above rules to local images“, „… to online images“ (lädt
  Web-Bilder herunter) und „Use relative path if possible“. Ein
  `typora-copy-images-to:` in der Front Matter hat Vorrang. Ist die Datei noch
  nicht gespeichert, fragt md-light zuerst nach dem Speicherort.
- **Darstellung:** Theme (System/Hell/Dunkel), Schriftgröße, Zeilenbreite
- **Editor:** Rechtschreibprüfung, Auto-Save

Die Einstellungen gelten für alle Fenster sofort.

Außerdem: `.md`-Dateien per Doppelklick im Finder, „Öffnen mit“, aufs
Dock-Icon oder ins Fenster ziehen. Ungespeicherte Änderungen werden beim
Schließen und Beenden abgefragt. Hell/Dunkel folgt dem System.

## Quick Look (Leertaste im Finder)

`npm run app:install` baut zusätzlich eine Quick-Look-Erweiterung in die App:
Markdown-Dateien erscheinen mit der Leertaste **formatiert** statt als
Rohtext. Das gilt für Überschriften, Listen, Checkboxen, Tabellen,
LaTeX-Formeln, Code mit Syntax-Highlighting, Callouts, `==Highlight==`, `[TOC]`
und Bilder relativ zur Datei.

Falls die Vorschau nicht erscheint: In den *Systemeinstellungen → Allgemein →
Anmeldeobjekte & Erweiterungen → Quick Look* „md-light Preview“ aktivieren und
im Terminal `qlmanage -r` ausführen. Der Code liegt in `quicklook/`.

## Entwickeln

Voraussetzungen: Node 20+, Rust (`rustup`) und die Xcode Command Line Tools.

```bash
npm install
npm run app:dev     # native App mit Hot Reload
npm run app:build   # baut md-light.app + .dmg nach src-tauri/target/release/bundle/
npm run app:install # (macOS) baut App + Quick-Look-Vorschau, installiert nach /Applications
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
  extensions/
    math.ts     LaTeX ($…$, $$…$$) mit KaTeX
    markdown.ts ==Highlight==, Front Matter, Callouts, [TOC], Link-Eingabe
    code.ts     Syntax-Highlighting, Sprachfeld, Mermaid-/Mathe-Vorschau
    popups.ts   „/“-Menü und Link-Editor
  images.ts     Regeln, wohin eingefügte Bilder kopiert werden
  settings.ts   Einstellungen (+ settings-ui.ts für den Dialog)
  titlebar.ts   Titelleiste: Name/Ort-Popover, Wortzahl, Buttons
  sidebar.ts    Seitenleiste: Ordner, neue Datei, Gliederung
  workspace.ts  Ordner auflisten, Dateien anlegen/umbenennen, letzte Ordner
  source.ts     Source-Modus (Textarea mit Listen-Fortsetzung, Tab, Formatierung)
  platform.ts   Tauri-Anbindung bzw. Browser-Fallback
  style.css     Theme (hell/dunkel)
src-tauri/
  src/lib.rs    Fenster, Menü, Datei-I/O, Bilder kopieren/laden, Einstellungen, Finder
```
