# ThreadCore BudStorm Sprite Editor

Browserbasierter Sprite-Sheet-Editor für Canvas-/BudStorm-Games.

Copyright © 2026 ThreadCore - Mathias P.R. Hinkel. All rights reserved.

## Hauptfunktionen

- PNG Sprite-Sheets laden
- Farbtransparenz per Color-Key auswählen
- Farbe direkt aus dem Sheet picken
- automatische Hintergrundentfernung über Eckfarben
- Toleranz und Soft-Edge für Alpha-Kanten
- bereinigtes PNG exportieren
- Frames per Raster oder Drag-Crop erzeugen
- Frames verschieben und skalieren
- Animationen bauen, sortieren und previewen
- Onion-Skin, Pivot-Anzeige und Box-Anzeige komplett abschaltbar
- Hitbox, Hurtbox und Attackbox bearbeiten
- BudStorm JSON und JS Runtime-Export
- separate ausführliche Anleitung unter `/help/`
- Synology-ready Build für `/arcade/spriteeditor/`

## Lokaler Start

```bash
npm install
npm run dev
```

## Synology Build

```bash
npm run build:synology
```

Danach den Inhalt von `dist/` nach Synology kopieren:

```text
/web/arcade/spriteeditor/
```

Online-URL:

```text
https://www.threadcore.de/arcade/spriteeditor/
```

Anleitung:

```text
https://www.threadcore.de/arcade/spriteeditor/help/
```
