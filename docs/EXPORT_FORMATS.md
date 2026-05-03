# Export Formats

## BudStorm JSON

The BudStorm export contains:

- `assetId`
- `image`
- source-pixel frame rectangles
- frame-local pivot coordinates
- frame-local hit/hurt/attack boxes
- animation frame order and FPS

## BudStorm JS

The JS export registers the atlas at:

```js
window.BudStormSpriteAtlases[assetId]
```

If available, it also calls:

```js
BudStormAssets.registerSpriteAtlas(assetId, atlas)
```
