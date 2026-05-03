# Synology Deployment

Target URL:

```text
https://www.threadcore.de/arcade/spriteeditor/
```

## Build

```bash
npm install
npm run build:synology
```

## Upload

Upload the **contents** of `dist/` to:

```text
/web/arcade/spriteeditor/
```

Correct structure:

```text
/web/arcade/spriteeditor/index.html
/web/arcade/spriteeditor/assets/...
/web/arcade/spriteeditor/help/index.html
/web/arcade/spriteeditor/help/assets/...
```

Do not upload as:

```text
/web/arcade/spriteeditor/dist/index.html
```

## Test

Open:

```text
https://www.threadcore.de/arcade/spriteeditor/
https://www.threadcore.de/arcade/spriteeditor/help/
```
