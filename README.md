<div align="center">

<img src="assets/icon.png" width="128" alt="md-light icon">

# md-light

**Ein schlanker Markdown-Editor für macOS, in dem Schreiben und Lesen eins sind.**

Du tippst Markdown, und es wird sofort formatiert: `### Titel` wird zur Überschrift,
`**fett**` wird **fett**, `$E=mc^2$` wird zur Formel. Gespeichert wird immer
reines Markdown, das Typora, Obsidian und GitHub verstehen.

![macOS 12+](https://img.shields.io/badge/macOS-12%2B-000000?logo=apple&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## Inhalt

- [Installation](#installation)
- [Schreiben](#schreiben)
- [Tastenkürzel](#tastenkürzel)
- [Oberfläche](#oberfläche)
- [Dateien öffnen und speichern](#dateien-öffnen-und-speichern)
- [Bilder](#bilder)
- [Einstellungen](#einstellungen)
- [Quick Look: Vorschau mit der Leertaste](#quick-look-vorschau-mit-der-leertaste)
- [Fehlerbehebung](#fehlerbehebung)
- [Technik und Projektaufbau](#technik-und-projektaufbau)
- [Lizenz](#lizenz)

---

## Installation

md-light wird aus dem Quellcode als echte Mac-App gebaut und in den
Programme-Ordner installiert. Danach startest du sie wie jede andere App über
Spotlight, Launchpad oder das Dock.

### 1. Voraussetzungen (einmalig)

| Was | Wozu | Installation |
| --- | --- | --- |
| macOS 12 Monterey oder neuer | Zielsystem | – |
| Xcode Command Line Tools | Compiler, Quick-Look-Erweiterung | `xcode-select --install` |
| Node.js 20 oder neuer | Build der Oberfläche | `brew install node` oder [nodejs.org](https://nodejs.org) |
| Rust | Build der App | siehe unten |

Rust installieren:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 2. App bauen und installieren

```bash
git clone https://github.com/kkphil/md-ligth.git
cd md-ligth
npm install
npm run app:install
```

`npm run app:install` erledigt alles in einem Schritt:

1. Es baut md-light als optimierte Mac-App (Release-Build für deinen Mac, Apple Silicon oder Intel).
2. Es baut die Quick-Look-Erweiterung und bettet sie in die App ein.
3. Es installiert die App nach `/Applications/md-light.app`.
4. Es meldet App und Erweiterung bei macOS an und startet md-light.

Der erste Build dauert einige Minuten, spätere Builds gehen deutlich schneller.

### 3. md-light als Standard für Markdown-Dateien

1. Im Finder auf eine beliebige `.md`-Datei rechtsklicken → **Informationen**.
2. Unter **Öffnen mit** md-light auswählen.
3. **Alle ändern…** klicken und bestätigen.

Ab dann öffnet ein Doppelklick auf jede Markdown-Datei md-light.

### Aktualisieren

```bash
cd md-ligth
git pull
npm install
npm run app:install
```

Die installierte App wird ersetzt. Einstellungen und die Ordnerliste der
Seitenleiste bleiben erhalten.

### Deinstallieren

```bash
rm -rf /Applications/md-light.app
rm -rf ~/Library/Application\ Support/dev.mdlight.app   # Einstellungen, optional
```

---

## Schreiben

md-light formatiert, während du tippst, ähnlich wie Typora und Notion.

| Du tippst | Ergebnis |
| --- | --- |
| `# ` bis `###### ` | Überschrift H1–H6 |
| `**text**` / `*text*` | **fett** / *kursiv* |
| `` `code` `` / `~~text~~` | Inline-Code / ~~durchgestrichen~~ |
| `==text==` | Hervorhebung |
| `[text](https://…)` | Link |
| `- ` / `* ` / `1. ` | Aufzählung / nummerierte Liste |
| `- [ ] ` | Checkbox (per Klick abhakbar) |
| `> ` | Zitat |
| `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | Callout-Box im GitHub-Stil |
| ```` ``` ```` + Enter, ```` ```js ```` + Enter | Codeblock, mit Sprache inklusive Syntax-Highlighting |
| ```` ```mermaid ```` | Diagramm mit Live-Vorschau |
| `$E=mc^2$` | LaTeX-Formel im Text |
| `$$` + Enter | LaTeX-Formelblock |
| `\| Name \| Alter \|` + Enter | Tabelle mit diesen Spalten |
| `---` | Trennlinie |
| `![alt](bild.png)` | Bild |
| `[TOC]` | Klickbares Inhaltsverzeichnis |
| `---` am Dateianfang | YAML-Front-Matter |
| `Text[^1]` und `[^1]: …` | Fußnote |
| `/` | Befehlsmenü wie in Notion |

**Das `/`-Menü:** Tippe `/` am Zeilenanfang und wähle aus Überschriften,
Listen, To-dos, Zitat, Callout, Codeblock, Formel, Tabelle, Bild, Trennlinie,
Inhaltsverzeichnis, Diagramm und Front Matter. Die Suche versteht englische
und deutsche Begriffe, etwa `/tabelle` oder `/formel`.

**Details wie in Typora:**

- Steht der Cursor in einer Überschrift, zeigt der linke Rand die `###`-Marker.
- Formeln zeigen ihren LaTeX-Quelltext mit Live-Vorschau, solange der Cursor
  darin steht, und sonst die fertige Formel.
- Backspace am Anfang einer Überschrift macht sie wieder zu normalem Text.
- ⌘-Klick öffnet einen Link, ⌘K bearbeitet ihn.
- **⌘/** schaltet jederzeit in den Markdown-Quelltext und zurück.

---

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| ⌘N / ⌘O | Neues Fenster / Datei öffnen |
| ⌘S / ⇧⌘S | Speichern / Speichern unter |
| ⌘W / ⌘Q | Fenster schließen / md-light beenden |
| ⌘/ | Quelltext-Modus umschalten |
| ⌘1 … ⌘6, ⌘0 | Überschrift 1–6, normaler Absatz |
| ⌘B / ⌘I / ⌘E | Fett / Kursiv / Inline-Code |
| ⇧⌘X / ⇧⌘H | Durchgestrichen / Hervorheben |
| ⌘K | Link |
| ⌥⌘Q / ⌥⌘O / ⌥⌘U / ⌥⌘X | Zitat / nummerierte Liste / Aufzählung / Aufgabenliste |
| ⌥⌘C / ⌥⌘T | Codeblock / Tabelle |
| ⌥⌘B / ⌃M | Formelblock / Inline-Formel |
| ⇧⌘I | Bild einfügen… |
| ⇧⌘L / ⇧⌘1 | Seitenleiste / Gliederung |
| ⌘= / ⌘- / ⇧⌘0 | Vergrößern / Verkleinern / Originalgröße |
| ⌘, | Einstellungen |

---

## Oberfläche

### Titelleiste

- **Dateiname in der Mitte**, wie bei Pages oder TextEdit. Ein Klick öffnet ein
  Popover mit **Name** und **Ort**. Damit benennst du die Datei um oder
  verschiebst sie in einen anderen Ordner. Ein neues Dokument speicherst du
  darüber direkt, ohne Dialog. „— Edited“ zeigt ungespeicherte Änderungen.
- **Rechts oben:**
  - „207 Words ⌃⌄“: umschaltbar auf Zeichen, Zeichen ohne Leerzeichen, Absätze oder Lesezeit
  - `</>`: Quelltext-Modus
  - Gliederung und Seitenleiste ein- und ausblenden

### Seitenleiste (⇧⌘L)

- Zeigt automatisch **alle Ordner, in denen du Dateien geöffnet oder
  gespeichert hast**. Sie lassen sich aufklappen und zeigen Unterordner und
  Markdown-Dateien.
- **+** am Ordner legt dort sofort eine neue Datei an: Name tippen, Enter.
- **×** entfernt einen Ordner aus der Liste. Auf der Festplatte wird nichts gelöscht.
- **+ Add Folder…** fügt einen beliebigen Ordner hinzu.
- Ein Klick auf eine Datei öffnet sie im selben Fenster.
- Die Breite lässt sich am Rand ziehen. md-light merkt sich Zustand und aufgeklappte Ordner.

### Gliederung (⇧⌘1)

Alle Überschriften des Dokuments. Ein Klick springt an die Stelle.

---

## Dateien öffnen und speichern

- **Öffnen:** per Doppelklick im Finder, „Öffnen mit“, ⌘O, Ziehen auf das
  Dock-Icon oder ins Fenster, oder über die Seitenleiste.
- **Mehrere Dokumente:** Jedes Dokument hat ein eigenes Fenster (⌘N).
- **Ungespeicherte Änderungen** werden beim Schließen, beim Beenden und beim
  Wechsel zu einer anderen Datei abgefragt.
- **Auto-Save** lässt sich in den Einstellungen einschalten.
- Wie andere Mac-Apps läuft md-light weiter, wenn das letzte Fenster
  geschlossen ist. Ein Klick aufs Dock-Icon öffnet ein neues Fenster, **⌘Q**
  beendet die App.

---

## Bilder

Bilder kannst du auf drei Wegen einfügen: Screenshots aus der Zwischenablage
(⌘V), Dateien ins Fenster ziehen oder **⇧⌘I**. Wohin sie kopiert werden,
legst du in den Einstellungen unter **When Insert…** fest, wie in Typora:

| Option | Ergebnis |
| --- | --- |
| No special operation | Bild bleibt, wo es ist |
| Copy image to current folder | in den Ordner der Markdown-Datei (`./`) |
| Copy image to `./${filename}.assets` | in einen Ordner pro Dokument |
| **Copy image to custom folder** (Standard: `./_assets`) | eigener Ordner: relativ mit `./` oder `../`, oder absolut. `${filename}` steht für den Dateinamen. |

Zusätzlich:

- **Apply above rules to local images:** auch Bilder kopieren, die schon auf dem Mac liegen.
- **Apply above rules to online images:** Bilder aus eingefügten Webinhalten herunterladen.
- **Use relative path if possible:** Pfade relativ zur Markdown-Datei speichern.
- Ein Eintrag `typora-copy-images-to: ./pfad` in der Front Matter hat Vorrang vor der Einstellung.
- Ist ein neues Dokument noch nicht gespeichert, fragt md-light zuerst nach dem Speicherort, weil der Bildordner relativ zur Datei liegt.

---

## Einstellungen

**md-light → Settings…** oder **⌘,**. Änderungen gelten sofort in allen Fenstern.

| Bereich | Optionen |
| --- | --- |
| Darstellung | Theme (System, Hell, Dunkel), Schriftgröße, Zeilenbreite |
| Editor | Rechtschreibprüfung, Auto-Save |
| Bilder | Regeln für eingefügte Bilder (siehe [Bilder](#bilder)) |

---

## Quick Look: Vorschau mit der Leertaste

md-light bringt eine Quick-Look-Erweiterung mit. Wenn du im Finder eine
Markdown-Datei markierst und die **Leertaste** drückst, erscheint sie
formatiert statt als Rohtext:

- Überschriften, Listen, Checkboxen, Tabellen und Fußnoten
- LaTeX-Formeln und Code mit Syntax-Highlighting
- Callouts, Hervorhebungen und Inhaltsverzeichnis
- Bilder relativ zur Datei, zum Beispiel aus `./_assets`
- Hell- und Dunkelmodus passend zum System

Die Erweiterung wird von `npm run app:install` automatisch gebaut und angemeldet.

---

## Fehlerbehebung

<details>
<summary><b><code>cargo metadata</code> … No such file or directory</b></summary>

Rust ist nicht installiert oder im Terminal noch nicht geladen. Installiere es
wie unter [Voraussetzungen](#1-voraussetzungen-einmalig) beschrieben, oder führe
`source "$HOME/.cargo/env"` aus bzw. öffne ein neues Terminalfenster.
</details>

<details>
<summary><b>Der Build bricht mit einem Fehler zu <code>cc</code>, <code>linker</code> oder <code>xcrun</code> ab</b></summary>

Die Xcode Command Line Tools fehlen: `xcode-select --install`, danach
`npm run app:install` erneut ausführen.
</details>

<details>
<summary><b>Die Leertaste zeigt weiterhin Rohtext</b></summary>

1. Öffne **Systemeinstellungen → Allgemein → Anmeldeobjekte & Erweiterungen**,
   klicke bei **Quick Look** auf ⓘ und aktiviere **md-light Preview**.
2. Setze Quick Look im Terminal zurück: `qlmanage -r && qlmanage -r cache`
3. Starte den Finder neu: ⌥ + Rechtsklick auf das Finder-Icon im Dock → **Neu starten**.

Gibt `npm run app:install` eine Warnung zur Quick-Look-Erweiterung aus, wurde
md-light trotzdem installiert. Die Meldung darüber nennt die Ursache.
</details>

<details>
<summary><b>Doppelklick auf eine <code>.md</code>-Datei öffnet eine andere App</b></summary>

Lege md-light als Standard fest, siehe
[Standard für Markdown-Dateien](#3-md-light-als-standard-für-markdown-dateien).
</details>

---

## Technik und Projektaufbau

md-light ist eine native Mac-App auf Basis von [Tauri 2](https://tauri.app).
Statt eines mitgelieferten Chromium wie bei Electron nutzt sie das
WebKit des Systems und bleibt dadurch klein. Der Editor basiert auf
[Milkdown](https://milkdown.dev) und ProseMirror, Formeln rendert
[KaTeX](https://katex.org), Diagramme [Mermaid](https://mermaid.js.org).

```
src/                    Oberfläche des Editors (TypeScript)
  main.ts               Dokument-Zustand, Öffnen/Speichern, Menübefehle
  editor.ts             Milkdown-Setup und Typora-Verhalten
  extensions/           LaTeX, Highlight, Callouts, [TOC], Code, /-Menü, Link-Editor
  titlebar.ts           Titelleiste mit Name/Ort-Popover und Wortzahl
  sidebar.ts            Seitenleiste mit Ordnern und Gliederung
  images.ts             Regeln für eingefügte Bilder
  settings*.ts          Einstellungen und Dialog
src-tauri/              Native App (Rust): Fenster, Menüs, Dateien, Bilder, Finder-Integration
quicklook/              Quick-Look-Erweiterung (Swift) und ihr Markdown-Renderer
scripts/install-macos.sh  Build und Installation nach /Applications
```

---

## Lizenz

[MIT](LICENSE)
