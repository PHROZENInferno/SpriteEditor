import React, { useEffect, useMemo, useRef, useState } from 'react';

/*
 * ThreadCore BudStorm Sprite Editor
 * Copyright © 2026 ThreadCore - Mathias P.R. Hinkel. All rights reserved.
 *
 * This editor is designed for browser-only sprite asset preparation:
 * PNG import, background removal, frame cropping, animation sequencing,
 * pivot editing, hit/hurt/attack boxes and BudStorm runtime export.
 */

const DEFAULT_STATE = {
  imageName: '',
  assetId: 'sprite_asset',
  sheet: { frameW: 64, frameH: 64, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0, columns: 0, rows: 0 },
  frames: [],
  animations: [{ id: 'anim_idle', name: 'idle', fps: 8, loop: true, frameIds: [] }],
  selectedFrameId: null,
  selectedAnimationId: 'anim_idle',
};

const BOX_TYPES = ['hitbox', 'hurtbox', 'attackbox'];
const HANDLE_SIZE = 7;
const MIN_FRAME_SIZE = 1;
const MIN_BOX_SIZE = 1;
const BOX_OVERLAY_ALPHA = 0.2;
const BOX_STROKE_ALPHA = 0.45;
const BOX_ACTIVE_STROKE_ALPHA = 0.8;

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function slugifyAssetName(value) {
  const raw = String(value || 'sprite_asset')
    .replace(/\.png$/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return raw || 'sprite_asset';
}

function normalizeRect(x, y, w, h) {
  let nx = Number(x) || 0;
  let ny = Number(y) || 0;
  let nw = Number(w) || 0;
  let nh = Number(h) || 0;
  if (nw < 0) { nx += nw; nw = Math.abs(nw); }
  if (nh < 0) { ny += nh; nh = Math.abs(nh); }
  return { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
}

function rectContainsPoint(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function moveItem(arr, from, to) {
  const next = [...arr];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function toggleFrameIdInAnimation(frameIds, frameId) {
  return frameIds.includes(frameId) ? frameIds.filter((id) => id !== frameId) : [...frameIds, frameId];
}

function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function colorDistanceSq(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function buildDefaultBoxes(frameW, frameH) {
  return {
    hitbox: { x: Math.round(frameW * 0.2), y: Math.round(frameH * 0.2), w: Math.max(1, Math.round(frameW * 0.6)), h: Math.max(1, Math.round(frameH * 0.6)) },
    hurtbox: { x: Math.round(frameW * 0.12), y: Math.round(frameH * 0.12), w: Math.max(1, Math.round(frameW * 0.76)), h: Math.max(1, Math.round(frameH * 0.76)) },
    attackbox: { x: Math.round(frameW * 0.65), y: Math.round(frameH * 0.35), w: Math.max(1, Math.round(frameW * 0.3)), h: Math.max(1, Math.round(frameH * 0.3)) },
  };
}

function createFrame(index, x, y, w, h) {
  const frameW = Math.max(MIN_FRAME_SIZE, Math.round(w));
  const frameH = Math.max(MIN_FRAME_SIZE, Math.round(h));
  return {
    id: `frame_${String(index).padStart(3, '0')}`,
    name: `frame_${String(index).padStart(3, '0')}`,
    index,
    x: Math.round(x), y: Math.round(y), w: frameW, h: frameH,
    pivotX: Math.round(frameW / 2), pivotY: Math.round(frameH / 2),
    durationMs: 100,
    enabled: true,
    boxes: buildDefaultBoxes(frameW, frameH),
  };
}

function ensureFrameShape(frame, indexFallback = 0) {
  const w = Math.max(MIN_FRAME_SIZE, Math.round(Number(frame?.w) || 1));
  const h = Math.max(MIN_FRAME_SIZE, Math.round(Number(frame?.h) || 1));
  return {
    id: frame?.id || `frame_${String(indexFallback).padStart(3, '0')}`,
    name: frame?.name || frame?.id || `frame_${String(indexFallback).padStart(3, '0')}`,
    index: Number.isFinite(frame?.index) ? frame.index : indexFallback,
    x: Math.round(Number(frame?.x) || 0), y: Math.round(Number(frame?.y) || 0), w, h,
    pivotX: Math.round(Number.isFinite(frame?.pivotX) ? frame.pivotX : w / 2),
    pivotY: Math.round(Number.isFinite(frame?.pivotY) ? frame.pivotY : h / 2),
    durationMs: Math.max(1, Math.round(Number(frame?.durationMs) || 100)),
    enabled: frame?.enabled !== false,
    boxes: { ...buildDefaultBoxes(w, h), ...(frame?.boxes || {}) },
  };
}

function buildFramesFromGrid(imageWidth, imageHeight, sheet) {
  const { frameW, frameH, offsetX = 0, offsetY = 0, gapX = 0, gapY = 0 } = sheet || {};
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || !Number.isFinite(frameW) || !Number.isFinite(frameH) || frameW <= 0 || frameH <= 0) return { columns: 0, rows: 0, frames: [] };
  const stepX = frameW + gapX;
  const stepY = frameH + gapY;
  const columns = stepX <= 0 ? 0 : Math.max(0, Math.floor((imageWidth - offsetX + gapX) / stepX));
  const rows = stepY <= 0 ? 0 : Math.max(0, Math.floor((imageHeight - offsetY + gapY) / stepY));
  const frames = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const sx = offsetX + x * stepX;
      const sy = offsetY + y * stepY;
      if (sx + frameW <= imageWidth && sy + frameH <= imageHeight) frames.push(createFrame(frames.length, sx, sy, frameW, frameH));
    }
  }
  return { columns, rows, frames };
}

function processTransparency(sourceImage, options) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceImage.width;
  canvas.height = sourceImage.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceImage, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const tolerance = clamp(options.tolerance ?? 24, 0, 441);
  const tolSq = tolerance * tolerance;
  const soften = clamp(options.softEdge ?? 0, 0, 128);
  const softenSq = (tolerance + soften) * (tolerance + soften);
  let target = hexToRgb(options.color || '#000000');

  if (options.mode === 'auto-corners') {
    const samples = [0, canvas.width - 1, (canvas.height - 1) * canvas.width, canvas.height * canvas.width - 1].map((p) => p * 4);
    const avg = samples.reduce((acc, i) => ({ r: acc.r + data[i], g: acc.g + data[i + 1], b: acc.b + data[i + 2] }), { r: 0, g: 0, b: 0 });
    target = { r: Math.round(avg.r / 4), g: Math.round(avg.g / 4), b: Math.round(avg.b / 4) };
  }

  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d2 = colorDistanceSq({ r: data[i], g: data[i + 1], b: data[i + 2] }, target);
    if (d2 <= tolSq) {
      data[i + 3] = 0;
      removed++;
    } else if (soften > 0 && d2 <= softenSq) {
      const t = (Math.sqrt(d2) - tolerance) / Math.max(1, soften);
      data[i + 3] = Math.round(data[i + 3] * clamp(t, 0, 1));
    }
  }
  ctx.putImageData(img, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), targetHex: rgbToHex(target), removedPixels: removed, width: canvas.width, height: canvas.height };
}

function buildProjectExport(project) {
  return { type: 'ThreadCore.BudStorm.SpriteProject', version: 3, copyright: 'Copyright © 2026 ThreadCore - Mathias P.R. Hinkel. All rights reserved.', exportedAt: new Date().toISOString(), imageName: project.imageName, assetId: project.assetId, sheet: project.sheet, frames: project.frames.map(ensureFrameShape), animations: project.animations };
}

function buildBudStormExport(project) {
  return {
    type: 'BudStorm.SpriteAtlas', version: 1, copyright: 'Copyright © 2026 ThreadCore - Mathias P.R. Hinkel. All rights reserved.',
    assetId: project.assetId || slugifyAssetName(project.imageName), image: project.imageName,
    meta: { source: 'ThreadCore BudStorm Sprite Editor', exportedAt: new Date().toISOString(), coordinateMode: 'source-pixels', pivotMode: 'frame-local-pixels', boxMode: 'frame-local-pixels' },
    sheet: { frameW: project.sheet.frameW, frameH: project.sheet.frameH, columns: project.sheet.columns, rows: project.sheet.rows },
    frames: Object.fromEntries(project.frames.map((source, i) => {
      const f = ensureFrameShape(source, i);
      return [f.id, { id: f.id, name: f.name, src: { x: f.x, y: f.y, w: f.w, h: f.h }, pivot: { x: f.pivotX, y: f.pivotY }, boxes: { hit: f.boxes.hitbox, hurt: f.boxes.hurtbox, attack: f.boxes.attackbox }, durationMs: f.durationMs, enabled: f.enabled }];
    })),
    animations: Object.fromEntries(project.animations.map((a) => [a.name, { id: a.id, name: a.name, fps: a.fps, frameTimeMs: Math.round(1000 / Math.max(1, a.fps)), loop: a.loop, frames: a.frameIds }]))
  };
}

function buildBudStormJsLibrary(project) {
  const atlas = buildBudStormExport(project);
  const constName = `${slugifyAssetName(atlas.assetId).replace(/[^a-zA-Z0-9_$]/g, '_').toUpperCase()}_ATLAS`;
  return `/*\n * BudStorm Sprite Atlas Library\n * ${atlas.copyright}\n * Asset: ${atlas.assetId}\n * Image: ${atlas.image}\n */\n(function(global){\n  \"use strict\";\n  const ${constName} = ${JSON.stringify(atlas, null, 2)};\n  global.BudStormSpriteAtlases = global.BudStormSpriteAtlases || {};\n  global.BudStormSpriteAtlases[${JSON.stringify(atlas.assetId)}] = ${constName};\n  if (global.BudStormAssets && typeof global.BudStormAssets.registerSpriteAtlas === \"function\") {\n    global.BudStormAssets.registerSpriteAtlas(${JSON.stringify(atlas.assetId)}, ${constName});\n  }\n})(typeof window !== \"undefined\" ? window : globalThis);\n`;
}

function parseProjectJson(text) {
  const data = JSON.parse(text);
  const frames = Array.isArray(data.frames) ? data.frames.map(ensureFrameShape) : [];
  const animations = Array.isArray(data.animations) && data.animations.length ? data.animations : DEFAULT_STATE.animations;
  return { ...DEFAULT_STATE, imageName: data.imageName || '', assetId: data.assetId || slugifyAssetName(data.imageName || 'sprite_asset'), sheet: { ...DEFAULT_STATE.sheet, ...(data.sheet || {}) }, frames, animations, selectedFrameId: frames?.[0]?.id || null, selectedAnimationId: animations?.[0]?.id || 'anim_idle' };
}

function downloadText(filename, text, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function downloadCanvasPng(filename, canvas) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, 'image/png');
}

function Field({ label, value, onChange, type = 'text', min, max, step }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} min={min} max={max} step={step} onChange={(e) => onChange(type === 'number' || type === 'range' ? Number(e.target.value) : e.target.value)} /></label>;
}
function Button({ children, onClick, variant = '', disabled = false, small = false, className = '' }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`btn ${variant} ${small ? 'small' : ''} ${className}`}>{children}</button>;
}

function runSelfTests() {
  const tests = [];
  const test = (name, fn) => { try { fn(); tests.push({ name, ok: true }); } catch (e) { tests.push({ name, ok: false, error: String(e?.message || e) }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  test('normalizeRect negative Werte', () => { const r = normalizeRect(10, 10, -5, -8); assert(r.x === 5 && r.y === 2 && r.w === 5 && r.h === 8, 'normalizeRect falsch'); });
  test('Grid 128x128 / 64x64 erzeugt 4 Frames', () => { assert(buildFramesFromGrid(128, 128, { frameW: 64, frameH: 64 }).frames.length === 4, 'Grid falsch'); });
  test('Color-Konvertierung roundtrip', () => { assert(rgbToHex(hexToRgb('#ff00aa')) === '#ff00aa', 'Hex falsch'); });
  test('Box-Overlay ist 80 Prozent transparent', () => { assert(BOX_OVERLAY_ALPHA === 0.2, 'Alpha falsch'); });
  return tests;
}

export default function SpriteSheetEditor() {
  const [project, setProject] = useState(DEFAULT_STATE);
  const [sourceImage, setSourceImage] = useState(null);
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [sheetTool, setSheetTool] = useState('select');
  const [previewTool, setPreviewTool] = useState('pivot');
  const [activeBoxType, setActiveBoxType] = useState('hitbox');
  const [onionSkin, setOnionSkin] = useState(true);
  const [onionOpacity, setOnionOpacity] = useState(0.28);
  const [previewScale, setPreviewScale] = useState(3);
  const [showPreviewBoxes, setShowPreviewBoxes] = useState(true);
  const [showPreviewPivot, setShowPreviewPivot] = useState(true);
  const [showHelp, setShowHelp] = useState(true);
  const [transparencyColor, setTransparencyColor] = useState('#ff00ff');
  const [transparencyTolerance, setTransparencyTolerance] = useState(28);
  const [softEdge, setSoftEdge] = useState(0);
  const [transparencyReport, setTransparencyReport] = useState('Keine Transparenzbearbeitung angewendet.');
  const [testResults] = useState(() => runSelfTests());

  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);
  const sheetCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const sheetDragRef = useRef(null);
  const previewDragRef = useRef(null);

  const selectedAnimation = useMemo(() => project.animations.find((a) => a.id === project.selectedAnimationId) || project.animations[0] || null, [project.animations, project.selectedAnimationId]);
  const selectedFrame = useMemo(() => project.frames.find((f) => f.id === project.selectedFrameId) || null, [project.frames, project.selectedFrameId]);
  const currentPreviewFrame = useMemo(() => {
    const ids = selectedAnimation?.frameIds || [];
    const id = ids[previewIndex % Math.max(1, ids.length)] || project.selectedFrameId;
    return project.frames.find((f) => f.id === id) || selectedFrame;
  }, [selectedAnimation, previewIndex, project.frames, project.selectedFrameId, selectedFrame]);

  function setImageFromDataUrl(dataUrl, asSource = false) {
    const img = new Image();
    img.onload = () => {
      if (asSource) setSourceImage(img);
      setImage(img);
      setImageUrl(dataUrl);
    };
    img.src = dataUrl;
  }

  function handleImageFile(file) {
    if (!file) return;
    if (!file.type.includes('png')) { alert('Bitte eine PNG-Datei laden.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setImageFromDataUrl(dataUrl, true);
      setProject((p) => ({ ...p, imageName: file.name, assetId: p.assetId === 'sprite_asset' ? slugifyAssetName(file.name) : p.assetId }));
      setTransparencyReport('Original-PNG geladen. Transparenzbearbeitung noch nicht angewendet.');
    };
    reader.readAsDataURL(file);
  }

  function pickColorFromSheetEvent(e) {
    if (!image) return;
    const p = getSheetPoint(e);
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(clamp(Math.floor(p.x), 0, image.width - 1), clamp(Math.floor(p.y), 0, image.height - 1), 1, 1).data;
    const hex = rgbToHex({ r: px[0], g: px[1], b: px[2] });
    setTransparencyColor(hex);
    setTransparencyReport(`Farbe gewählt: ${hex}`);
  }

  function applyTransparency(mode = 'color-key') {
    const base = sourceImage || image;
    if (!base) return;
    const result = processTransparency(base, { mode, color: transparencyColor, tolerance: transparencyTolerance, softEdge });
    setImageFromDataUrl(result.dataUrl, false);
    setTransparencyColor(result.targetHex);
    setProject((p) => ({ ...p, imageName: `${slugifyAssetName(p.imageName || p.assetId)}_transparent.png` }));
    setTransparencyReport(`${mode === 'auto-corners' ? 'Auto-Hintergrund' : 'Farbtransparenz'} entfernt: ${result.removedPixels.toLocaleString('de-DE')} Pixel · Ziel: ${result.targetHex}`);
  }

  function restoreOriginalImage() {
    if (!sourceImage) return;
    const c = document.createElement('canvas');
    c.width = sourceImage.width; c.height = sourceImage.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(sourceImage, 0, 0);
    setImageFromDataUrl(c.toDataURL('image/png'), false);
    setTransparencyReport('Originalbild wiederhergestellt.');
  }

  function exportProcessedPng() {
    if (!image) return;
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    downloadCanvasPng(`${project.assetId || 'sprite'}_processed.png`, c);
  }

  function updateProjectPatch(patch) { setProject((p) => ({ ...p, ...patch })); }
  function updateSheet(patch) { setProject((p) => ({ ...p, sheet: { ...p.sheet, ...patch } })); }
  function updateFrame(frameId, patchOrFn) {
    setProject((p) => ({ ...p, frames: p.frames.map((source, i) => {
      if (source.id !== frameId) return source;
      const frame = ensureFrameShape(source, i);
      const patch = typeof patchOrFn === 'function' ? patchOrFn(frame) : patchOrFn;
      return ensureFrameShape({ ...frame, ...patch }, i);
    }) }));
  }
  function updateSelectedFrame(patchOrFn) { if (project.selectedFrameId) updateFrame(project.selectedFrameId, patchOrFn); }
  function updateFrameBox(frameId, boxType, patchOrRect) {
    updateFrame(frameId, (frame) => {
      const current = frame.boxes?.[boxType] || { x: 0, y: 0, w: 1, h: 1 };
      const nextRaw = typeof patchOrRect === 'function' ? patchOrRect(current, frame) : { ...current, ...patchOrRect };
      const r = normalizeRect(nextRaw.x, nextRaw.y, nextRaw.w, nextRaw.h);
      return { boxes: { ...frame.boxes, [boxType]: { x: clamp(r.x, -9999, 9999), y: clamp(r.y, -9999, 9999), w: Math.max(MIN_BOX_SIZE, r.w), h: Math.max(MIN_BOX_SIZE, r.h) } } };
    });
  }
  function updateAnimation(id, patch) { setProject((p) => ({ ...p, animations: p.animations.map((a) => (a.id === id ? { ...a, ...patch } : a)) })); }
  function getFrameById(id) { return project.frames.find((f) => f.id === id); }

  function generateFramesFromGridAction() {
    if (!image) return;
    const out = buildFramesFromGrid(image.width, image.height, project.sheet);
    setProject((p) => ({ ...p, sheet: { ...p.sheet, columns: out.columns, rows: out.rows }, frames: out.frames, selectedFrameId: out.frames[0]?.id || null, animations: p.animations.map((a, i) => (i === 0 ? { ...a, frameIds: out.frames.map((f) => f.id) } : a)) }));
  }
  function addAnimation() {
    const id = uid('anim');
    setProject((p) => ({ ...p, selectedAnimationId: id, animations: [...p.animations, { id, name: `animation_${p.animations.length + 1}`, fps: 8, loop: true, frameIds: [] }] }));
  }
  function deleteAnimation(id) {
    if (project.animations.length <= 1) return;
    setProject((p) => { const next = p.animations.filter((a) => a.id !== id); return { ...p, animations: next, selectedAnimationId: next[0]?.id || null }; });
  }
  function toggleFrameInAnimation(frameId) { if (selectedAnimation) updateAnimation(selectedAnimation.id, { frameIds: toggleFrameIdInAnimation(selectedAnimation.frameIds, frameId) }); }
  function moveAnimFrame(from, to) { if (selectedAnimation) updateAnimation(selectedAnimation.id, { frameIds: moveItem(selectedAnimation.frameIds, from, to) }); }

  function exportProjectJson() { downloadText(`${project.assetId || 'sprite_project'}.sprite.json`, JSON.stringify(buildProjectExport(project), null, 2)); }
  function exportCanvasGameJson() { downloadText(`${project.assetId || 'sprite'}.game.json`, JSON.stringify(buildBudStormExport(project), null, 2)); }
  function exportBudStormJson() { downloadText(`${project.assetId || 'sprite'}.budstorm.json`, JSON.stringify(buildBudStormExport(project), null, 2)); }
  function exportBudStormJs() { downloadText(`${project.assetId || 'sprite'}.budstorm-atlas.js`, buildBudStormJsLibrary(project), 'text/javascript;charset=utf-8'); }
  function importProjectJson(file) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { setProject(parseProjectJson(String(reader.result))); } catch { alert('Projekt-JSON konnte nicht gelesen werden.'); } }; reader.readAsText(file); }
  function exportAnimationStrip() {
    if (!image || !selectedAnimation?.frameIds.length) return;
    const frames = selectedAnimation.frameIds.map(getFrameById).filter(Boolean).map(ensureFrameShape);
    const maxW = Math.max(...frames.map((f) => f.w)); const maxH = Math.max(...frames.map((f) => f.h));
    const c = document.createElement('canvas'); c.width = maxW * frames.length; c.height = maxH;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    frames.forEach((f, i) => ctx.drawImage(image, f.x, f.y, f.w, f.h, i * maxW, 0, f.w, f.h));
    downloadCanvasPng(`${selectedAnimation.name || 'animation'}_strip.png`, c);
  }
  function clearProject() { setProject(DEFAULT_STATE); setSourceImage(null); setImage(null); setImageUrl(''); setPreviewIndex(0); setTransparencyReport('Projekt zurückgesetzt.'); }

  function getSheetPoint(e) { const rect = sheetCanvasRef.current.getBoundingClientRect(); return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }; }
  function findFrameAtSheetPoint(x, y) { for (let i = project.frames.length - 1; i >= 0; i--) { const f = ensureFrameShape(project.frames[i], i); if (rectContainsPoint(f, x, y)) return f; } return null; }
  function getFrameHandleAtPoint(frame, x, y) { const s = HANDLE_SIZE / zoom; const hs = [{ id: 'nw', x: frame.x, y: frame.y }, { id: 'ne', x: frame.x + frame.w, y: frame.y }, { id: 'sw', x: frame.x, y: frame.y + frame.h }, { id: 'se', x: frame.x + frame.w, y: frame.y + frame.h }]; return hs.find((h) => Math.abs(x - h.x) <= s && Math.abs(y - h.y) <= s)?.id || null; }

  function handleSheetPointerDown(e) {
    if (!image) return;
    if (sheetTool === 'pickTransparent') { pickColorFromSheetEvent(e); return; }
    const point = getSheetPoint(e); const selected = selectedFrame ? ensureFrameShape(selectedFrame) : null; const handle = selected ? getFrameHandleAtPoint(selected, point.x, point.y) : null; const hit = findFrameAtSheetPoint(point.x, point.y);
    if (sheetTool === 'crop') { sheetDragRef.current = { type: 'newFrame', startX: point.x, startY: point.y, x: point.x, y: point.y }; setProject((p) => ({ ...p, selectedFrameId: null })); return; }
    if (handle && selected) { sheetDragRef.current = { type: 'resizeFrame', frameId: selected.id, handle, startX: point.x, startY: point.y, startFrame: selected }; return; }
    if (hit) { setProject((p) => ({ ...p, selectedFrameId: hit.id })); if (sheetTool === 'animPaint') toggleFrameInAnimation(hit.id); if (sheetTool === 'select') sheetDragRef.current = { type: 'moveFrame', frameId: hit.id, startX: point.x, startY: point.y, startFrame: hit }; }
  }
  function handleSheetPointerMove(e) {
    const drag = sheetDragRef.current; if (!drag) return; const point = getSheetPoint(e);
    if (drag.type === 'newFrame') { sheetDragRef.current = { ...drag, x: point.x, y: point.y }; drawSheetCanvas(); return; }
    if (drag.type === 'moveFrame') { const dx = Math.round(point.x - drag.startX); const dy = Math.round(point.y - drag.startY); updateFrame(drag.frameId, { x: clamp(drag.startFrame.x + dx, 0, image ? image.width - 1 : 99999), y: clamp(drag.startFrame.y + dy, 0, image ? image.height - 1 : 99999) }); return; }
    if (drag.type === 'resizeFrame') { const f = drag.startFrame; let x1 = f.x, y1 = f.y, x2 = f.x + f.w, y2 = f.y + f.h; if (drag.handle.includes('n')) y1 = point.y; if (drag.handle.includes('s')) y2 = point.y; if (drag.handle.includes('w')) x1 = point.x; if (drag.handle.includes('e')) x2 = point.x; const r = normalizeRect(x1, y1, x2 - x1, y2 - y1); updateFrame(drag.frameId, { x: clamp(r.x, 0, image ? image.width - 1 : 99999), y: clamp(r.y, 0, image ? image.height - 1 : 99999), w: Math.max(MIN_FRAME_SIZE, r.w), h: Math.max(MIN_FRAME_SIZE, r.h) }); }
  }
  function handleSheetPointerUp() {
    const drag = sheetDragRef.current; if (!drag) return;
    if (drag.type === 'newFrame') { const r = normalizeRect(drag.startX, drag.startY, drag.x - drag.startX, drag.y - drag.startY); if (r.w >= MIN_FRAME_SIZE && r.h >= MIN_FRAME_SIZE) { const frame = createFrame(project.frames.length, r.x, r.y, r.w, r.h); setProject((p) => ({ ...p, frames: [...p.frames, frame], selectedFrameId: frame.id })); } }
    sheetDragRef.current = null; drawSheetCanvas();
  }

  function getPreviewGeometry(frame) { const canvas = previewCanvasRef.current; const size = canvas ? canvas.width : 384; const scale = Math.max(1, previewScale); return { scale, dx: Math.round((size - frame.w * scale) / 2), dy: Math.round((size - frame.h * scale) / 2), size }; }
  function getPreviewPoint(e, frame) { const rect = previewCanvasRef.current.getBoundingClientRect(); const px = e.clientX - rect.left; const py = e.clientY - rect.top; const geo = getPreviewGeometry(frame); return { x: Math.round((px - geo.dx) / geo.scale), y: Math.round((py - geo.dy) / geo.scale), ...geo }; }
  function boxHandleAtPoint(box, x, y) { const s = HANDLE_SIZE; const hs = [{ id: 'nw', x: box.x, y: box.y }, { id: 'ne', x: box.x + box.w, y: box.y }, { id: 'sw', x: box.x, y: box.y + box.h }, { id: 'se', x: box.x + box.w, y: box.y + box.h }]; return hs.find((h) => Math.abs(x - h.x) <= s && Math.abs(y - h.y) <= s)?.id || null; }
  function handlePreviewPointerDown(e) {
    const frame = currentPreviewFrame ? ensureFrameShape(currentPreviewFrame) : null; if (!frame) return; setProject((p) => ({ ...p, selectedFrameId: frame.id })); const p = getPreviewPoint(e, frame);
    if (previewTool === 'pivot') { previewDragRef.current = { type: 'pivot', frameId: frame.id }; updateFrame(frame.id, { pivotX: clamp(p.x, -9999, 9999), pivotY: clamp(p.y, -9999, 9999) }); return; }
    const box = frame.boxes?.[activeBoxType] || { x: 0, y: 0, w: 1, h: 1 }; const handle = boxHandleAtPoint(box, p.x, p.y);
    if (handle) { previewDragRef.current = { type: 'resizeBox', frameId: frame.id, boxType: activeBoxType, handle, startBox: box }; return; }
    if (previewTool === 'boxCreate') { previewDragRef.current = { type: 'newBox', frameId: frame.id, boxType: activeBoxType, startX: p.x, startY: p.y }; return; }
    if (previewTool === 'boxMove' && rectContainsPoint(box, p.x, p.y)) previewDragRef.current = { type: 'moveBox', frameId: frame.id, boxType: activeBoxType, startX: p.x, startY: p.y, startBox: box };
  }
  function handlePreviewPointerMove(e) {
    const drag = previewDragRef.current; const frame = currentPreviewFrame ? ensureFrameShape(currentPreviewFrame) : null; if (!drag || !frame) return; const p = getPreviewPoint(e, frame);
    if (drag.type === 'pivot') { updateFrame(drag.frameId, { pivotX: clamp(p.x, -9999, 9999), pivotY: clamp(p.y, -9999, 9999) }); return; }
    if (drag.type === 'newBox') { updateFrameBox(drag.frameId, drag.boxType, normalizeRect(drag.startX, drag.startY, p.x - drag.startX, p.y - drag.startY)); return; }
    if (drag.type === 'moveBox') { updateFrameBox(drag.frameId, drag.boxType, { x: Math.round(drag.startBox.x + p.x - drag.startX), y: Math.round(drag.startBox.y + p.y - drag.startY), w: drag.startBox.w, h: drag.startBox.h }); return; }
    if (drag.type === 'resizeBox') { const b = drag.startBox; let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h; if (drag.handle.includes('n')) y1 = p.y; if (drag.handle.includes('s')) y2 = p.y; if (drag.handle.includes('w')) x1 = p.x; if (drag.handle.includes('e')) x2 = p.x; updateFrameBox(drag.frameId, drag.boxType, normalizeRect(x1, y1, x2 - x1, y2 - y1)); }
  }
  function handlePreviewPointerUp() { previewDragRef.current = null; }

  function drawSheetCanvas() {
    const canvas = sheetCanvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); const w = image ? image.width : 900; const h = image ? image.height : 540;
    canvas.width = Math.max(1, Math.floor(w * zoom)); canvas.height = Math.max(1, Math.floor(h * zoom)); ctx.setTransform(zoom, 0, 0, zoom, 0, 0); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, w, h);
    if (image) { ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0); } else { ctx.fillStyle = '#71717a'; ctx.font = '18px sans-serif'; ctx.fillText('PNG laden, Transparenz bearbeiten, Frames croppen', 28, 44); }
    for (const source of project.frames) { const f = ensureFrameShape(source); const inAnim = selectedAnimation?.frameIds.includes(f.id); const isSelected = f.id === project.selectedFrameId; if (showGrid) { ctx.strokeStyle = isSelected ? '#22c55e' : inAnim ? '#a855f7' : 'rgba(255,255,255,0.28)'; ctx.lineWidth = isSelected ? 3 / zoom : 1 / zoom; ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1); } if (!f.enabled) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(f.x, f.y, f.w, f.h); } if (isSelected) { ctx.fillStyle = 'rgba(34,197,94,0.14)'; ctx.fillRect(f.x, f.y, f.w, f.h); ctx.fillStyle = '#22c55e'; ctx.font = `${12 / zoom}px sans-serif`; ctx.fillText(f.name, f.x + 4, f.y + 14); const s = HANDLE_SIZE / zoom; [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]].forEach(([hx, hy]) => ctx.fillRect(hx - s / 2, hy - s / 2, s, s)); } }
    const drag = sheetDragRef.current; if (drag?.type === 'newFrame') { const r = normalizeRect(drag.startX, drag.startY, drag.x - drag.startX, drag.y - drag.startY); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]); ctx.fillStyle = 'rgba(250,204,21,0.16)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
  }
  function drawPreviewCanvas() {
    const canvas = previewCanvasRef.current; if (!canvas) return; const ctx = canvas.getContext('2d'); const size = 384; canvas.width = size; canvas.height = size; ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, size, size); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i <= size; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke(); }
    const frameIds = selectedAnimation?.frameIds || []; const frame = currentPreviewFrame ? ensureFrameShape(currentPreviewFrame) : null; if (!image || !frame) return; const geo = getPreviewGeometry(frame); ctx.imageSmoothingEnabled = false;
    if (onionSkin && selectedAnimation && frameIds.length > 1) { const prevId = frameIds[(previewIndex - 1 + frameIds.length) % frameIds.length]; const nextId = frameIds[(previewIndex + 1) % frameIds.length]; ctx.globalAlpha = onionOpacity; [getFrameById(prevId), getFrameById(nextId)].filter(Boolean).map(ensureFrameShape).forEach((of, i) => ctx.drawImage(image, of.x, of.y, of.w, of.h, geo.dx + (i === 0 ? -8 : 8), geo.dy, of.w * geo.scale, of.h * geo.scale)); ctx.globalAlpha = 1; }
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, geo.dx, geo.dy, frame.w * geo.scale, frame.h * geo.scale);
    if (showPreviewPivot) { const px = geo.dx + frame.pivotX * geo.scale; const py = geo.dy + frame.pivotY * geo.scale; ctx.strokeStyle = 'rgba(34,197,94,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke(); ctx.fillStyle = 'rgba(34,197,94,.8)'; ctx.fillRect(px - 3, py - 3, 6, 6); }
    if (showPreviewBoxes) { const styles = { hitbox: ['rgba(56,189,248,', 'HIT'], hurtbox: ['rgba(249,115,22,', 'HURT'], attackbox: ['rgba(239,68,68,', 'ATK'] }; BOX_TYPES.forEach((type) => { const b = frame.boxes?.[type]; if (!b) return; const [base, label] = styles[type]; const x = geo.dx + b.x * geo.scale, y = geo.dy + b.y * geo.scale, w = b.w * geo.scale, h = b.h * geo.scale; ctx.fillStyle = `${base}${BOX_OVERLAY_ALPHA})`; ctx.fillRect(x, y, w, h); ctx.strokeStyle = type === activeBoxType ? `rgba(255,255,255,${BOX_ACTIVE_STROKE_ALPHA})` : `${base}${BOX_STROKE_ALPHA})`; ctx.lineWidth = type === activeBoxType ? 3 : 2; ctx.strokeRect(x + .5, y + .5, w, h); ctx.fillStyle = type === activeBoxType ? 'rgba(255,255,255,.8)' : `${base}.75)`; ctx.font = '11px sans-serif'; ctx.fillText(label, x + 4, y + 12); if (type === activeBoxType) { ctx.fillStyle = 'rgba(255,255,255,.85)'; [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => ctx.fillRect(hx - 4, hy - 4, 8, 8)); } }); }
  }

  useEffect(() => { drawSheetCanvas(); }, [image, project.frames, project.selectedFrameId, selectedAnimation, showGrid, zoom, sheetTool]);
  useEffect(() => { drawPreviewCanvas(); }, [image, currentPreviewFrame, selectedAnimation, previewIndex, project.frames, onionSkin, onionOpacity, previewScale, activeBoxType, previewTool, showPreviewBoxes, showPreviewPivot]);
  useEffect(() => { if (!playing || !selectedAnimation?.frameIds.length) return; const fps = clamp(selectedAnimation.fps, 1, 60); const timer = setInterval(() => setPreviewIndex((i) => selectedAnimation.loop ? (i + 1) % selectedAnimation.frameIds.length : Math.min(i + 1, selectedAnimation.frameIds.length - 1)), 1000 / fps); return () => clearInterval(timer); }, [playing, selectedAnimation?.id, selectedAnimation?.fps, selectedAnimation?.loop, selectedAnimation?.frameIds.length]);

  const activeBox = selectedFrame?.boxes?.[activeBoxType] || { x: 0, y: 0, w: 1, h: 1 };
  const passedTests = testResults.filter((t) => t.ok).length;
  const failedTests = testResults.length - passedTests;

  return <div className="app"><div className="shell">
    <header className="card card-pad header">
      <div><h1 className="title">ThreadCore BudStorm Sprite Editor</h1><div className="subtle">PNG · Transparenz · Auto-Hintergrundentfernung · Drag-Crop · Pivot · Boxes · BudStorm Export</div></div>
      <div className="row"><input ref={fileInputRef} type="file" accept="image/png" hidden onChange={(e) => handleImageFile(e.target.files?.[0])}/><input ref={projectInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => importProjectJson(e.target.files?.[0])}/><Button onClick={() => fileInputRef.current?.click()}>PNG laden</Button><Button variant="secondary" onClick={() => projectInputRef.current?.click()}>Projekt laden</Button><Button variant="secondary" onClick={exportProjectJson}>Projekt JSON</Button><Button variant="purple" onClick={exportBudStormJson}>BudStorm JSON</Button><Button variant="purple" onClick={exportBudStormJs}>BudStorm JS</Button><Button variant="danger" onClick={clearProject}>Reset</Button></div>
    </header>

    <section className="card card-pad">
      <div className="header"><div><b>Projektstatus</b><div className="subtle">Selbsttests: {passedTests} bestanden · {failedTests} fehlgeschlagen</div></div><div className="row"><Field label="Asset-ID / Runtime-Key" value={project.assetId} onChange={(v) => updateProjectPatch({ assetId: slugifyAssetName(v) })}/><Button variant="secondary" small onClick={() => setShowHelp((v) => !v)}>{showHelp ? 'Hilfe ausblenden' : 'Hilfe anzeigen'}</Button><a className="btn secondary small" href="./help/" target="_blank" rel="noreferrer">Ausführliche Anleitung</a></div></div>
      {failedTests > 0 && <div className="info">{testResults.filter(t=>!t.ok).map(t => <div key={t.name}>{t.name}: {t.error}</div>)}</div>}
    </section>

    {showHelp && <section className="card card-pad"><div className="section-title">Schnellhilfe</div><div className="help-grid"><div className="help-card"><b>1. PNG laden</b><br/>Sprite-Sheet laden. Danach zuerst Transparenz bearbeiten, wenn nötig.</div><div className="help-card"><b>2. Transparenz wählen</b><br/>Tool „Farbe picken“ aktivieren und im Sheet klicken oder Farbfeld manuell setzen.</div><div className="help-card"><b>3. Hintergrund entfernen</b><br/>„Farbtransparenz anwenden“ nutzt die gewählte Farbe. „Auto-Hintergrund“ berechnet den Hintergrund aus den Ecken.</div><div className="help-card"><b>4. Reine Animation prüfen</b><br/>In der Preview Boxes, Pivot und Onion abschalten.</div></div></section>}

    <main className="grid-main">
      <aside className="card card-pad">
        <section className="section"><div className="section-title">Sheet</div><div className="info"><b>Bild:</b> {project.imageName || 'kein PNG geladen'}<br/><b>Größe:</b> {image ? `${image.width} × ${image.height}px` : '—'}<br/><b>Frames:</b> {project.frames.length}</div><div className="two"><Field label="Frame W" type="number" value={project.sheet.frameW} min={1} onChange={(v) => updateSheet({ frameW: clamp(v,1,9999) })}/><Field label="Frame H" type="number" value={project.sheet.frameH} min={1} onChange={(v) => updateSheet({ frameH: clamp(v,1,9999) })}/><Field label="Offset X" type="number" value={project.sheet.offsetX} onChange={(v) => updateSheet({ offsetX: v })}/><Field label="Offset Y" type="number" value={project.sheet.offsetY} onChange={(v) => updateSheet({ offsetY: v })}/><Field label="Gap X" type="number" value={project.sheet.gapX} onChange={(v) => updateSheet({ gapX: v })}/><Field label="Gap Y" type="number" value={project.sheet.gapY} onChange={(v) => updateSheet({ gapY: v })}/></div><Button onClick={generateFramesFromGridAction} disabled={!image}>Frames aus Raster erzeugen</Button></section>
        <section className="section"><div className="section-title">Transparenz / Hintergrund</div><div className="two"><label className="field"><span>Transparenzfarbe</span><input type="color" value={transparencyColor} onChange={(e) => setTransparencyColor(e.target.value)}/></label><Field label="Toleranz" type="number" min={0} max={441} value={transparencyTolerance} onChange={(v) => setTransparencyTolerance(clamp(v,0,441))}/><Field label="Soft Edge" type="number" min={0} max={128} value={softEdge} onChange={(v) => setSoftEdge(clamp(v,0,128))}/><Button variant={sheetTool === 'pickTransparent' ? 'active' : 'secondary'} onClick={() => setSheetTool('pickTransparent')}>Farbe picken</Button></div><div className="row"><Button onClick={() => applyTransparency('color-key')} disabled={!image}>Farbtransparenz anwenden</Button><Button onClick={() => applyTransparency('auto-corners')} disabled={!image}>Auto-Hintergrund</Button><Button variant="secondary" onClick={restoreOriginalImage} disabled={!sourceImage}>Original</Button><Button variant="secondary" onClick={exportProcessedPng} disabled={!image}>PNG exportieren</Button></div><div className="info">{transparencyReport}</div></section>
        <section className="section"><div className="section-title">Sheet-Werkzeug</div><div className="two"><Button variant={sheetTool === 'select' ? 'active' : 'secondary'} onClick={() => setSheetTool('select')}>Select/Move</Button><Button variant={sheetTool === 'crop' ? 'active' : 'secondary'} onClick={() => setSheetTool('crop')}>Drag-Crop</Button><Button variant={sheetTool === 'animPaint' ? 'active' : 'secondary'} onClick={() => setSheetTool('animPaint')}>Anim-Paint</Button><Button variant="secondary" onClick={() => setShowGrid((v) => !v)}>{showGrid ? 'Grid aus' : 'Grid an'}</Button></div><Field label={`Sheet Zoom ${zoom.toFixed(2)}x`} type="range" min={0.5} max={5} step={0.25} value={zoom} onChange={setZoom}/></section>
        <section className="section"><div className="section-title">Frame Editor</div>{selectedFrame ? <><Field label="Frame Name" value={selectedFrame.name} onChange={(v) => updateSelectedFrame({ name: v })}/><div className="two"><Field label="X" type="number" value={selectedFrame.x} onChange={(v) => updateSelectedFrame({ x: v })}/><Field label="Y" type="number" value={selectedFrame.y} onChange={(v) => updateSelectedFrame({ y: v })}/><Field label="W" type="number" value={selectedFrame.w} min={1} onChange={(v) => updateSelectedFrame({ w: Math.max(1,v) })}/><Field label="H" type="number" value={selectedFrame.h} min={1} onChange={(v) => updateSelectedFrame({ h: Math.max(1,v) })}/><Field label="Pivot X" type="number" value={selectedFrame.pivotX} onChange={(v) => updateSelectedFrame({ pivotX: v })}/><Field label="Pivot Y" type="number" value={selectedFrame.pivotY} onChange={(v) => updateSelectedFrame({ pivotY: v })}/></div></> : <div className="info">Kein Frame ausgewählt.</div>}</section>
        <section className="section"><div className="section-title">Box Editor</div><div className="three">{BOX_TYPES.map(t => <Button key={t} small variant={activeBoxType === t ? 'active' : 'secondary'} onClick={() => setActiveBoxType(t)}>{t.replace('box','')}</Button>)}</div>{selectedFrame && <div className="two"><Field label="Box X" type="number" value={activeBox.x} onChange={(v) => updateFrameBox(selectedFrame.id, activeBoxType, { x: v })}/><Field label="Box Y" type="number" value={activeBox.y} onChange={(v) => updateFrameBox(selectedFrame.id, activeBoxType, { y: v })}/><Field label="Box W" type="number" value={activeBox.w} min={1} onChange={(v) => updateFrameBox(selectedFrame.id, activeBoxType, { w: Math.max(1,v) })}/><Field label="Box H" type="number" value={activeBox.h} min={1} onChange={(v) => updateFrameBox(selectedFrame.id, activeBoxType, { h: Math.max(1,v) })}/></div>}</section>
      </aside>

      <section className="card card-pad"><div className="header"><div><b>Sheet Canvas</b><div className="subtle">Aktuelles Tool: {sheetTool}</div></div><span className="badge">Transparenz wird direkt im Arbeitsbild sichtbar</span></div><div className="canvas-wrap"><canvas ref={sheetCanvasRef} className="sheet-canvas" onPointerDown={handleSheetPointerDown} onPointerMove={handleSheetPointerMove} onPointerUp={handleSheetPointerUp} onPointerLeave={handleSheetPointerUp}/></div></section>

      <aside className="card card-pad">
        <section className="section"><div className="header"><b>Animationen</b><Button small onClick={addAnimation}>Neu</Button></div>{project.animations.map(a => <button key={a.id} className={`btn secondary ${a.id === project.selectedAnimationId ? 'active' : ''}`} onClick={() => { setProject((p) => ({ ...p, selectedAnimationId: a.id })); setPreviewIndex(0); }}>{a.name} · {a.frameIds.length} Frames</button>)}{selectedAnimation && <><div className="two"><Field label="Name" value={selectedAnimation.name} onChange={(v) => updateAnimation(selectedAnimation.id, { name: v })}/><Field label="FPS" type="number" min={1} max={60} value={selectedAnimation.fps} onChange={(v) => updateAnimation(selectedAnimation.id, { fps: clamp(v,1,60) })}/></div><label className="field"><span>Loop</span><input type="checkbox" checked={selectedAnimation.loop} onChange={(e) => updateAnimation(selectedAnimation.id, { loop: e.target.checked })}/></label><div className="two"><Button variant="secondary" onClick={() => setPlaying((v) => !v)}>{playing ? 'Pause' : 'Play'}</Button><Button variant="danger" disabled={project.animations.length <= 1} onClick={() => deleteAnimation(selectedAnimation.id)}>Löschen</Button></div></>}</section>
        <section className="section"><div className="header"><b>Preview</b><span className="badge">{currentPreviewFrame?.name || '—'}</span></div><div className="three"><Button small variant={previewTool === 'pivot' ? 'active' : 'secondary'} onClick={() => setPreviewTool('pivot')}>Pivot</Button><Button small variant={previewTool === 'boxMove' ? 'active' : 'secondary'} onClick={() => setPreviewTool('boxMove')}>Box Move</Button><Button small variant={previewTool === 'boxCreate' ? 'active' : 'secondary'} onClick={() => setPreviewTool('boxCreate')}>Box Draw</Button></div><canvas ref={previewCanvasRef} className="preview-canvas" onPointerDown={handlePreviewPointerDown} onPointerMove={handlePreviewPointerMove} onPointerUp={handlePreviewPointerUp} onPointerLeave={handlePreviewPointerUp}/><div className="two"><label className="field"><span>Boxes</span><input type="checkbox" checked={showPreviewBoxes} onChange={(e) => setShowPreviewBoxes(e.target.checked)}/></label><label className="field"><span>Pivot</span><input type="checkbox" checked={showPreviewPivot} onChange={(e) => setShowPreviewPivot(e.target.checked)}/></label><label className="field"><span>Onion</span><input type="checkbox" checked={onionSkin} onChange={(e) => setOnionSkin(e.target.checked)}/></label><Field label={`Scale ${previewScale}x`} type="range" min={1} max={6} step={1} value={previewScale} onChange={setPreviewScale}/></div><Field label={`Onion Opacity ${onionOpacity.toFixed(2)}`} type="range" min={0.05} max={0.8} step={0.05} value={onionOpacity} onChange={setOnionOpacity}/><Button onClick={exportAnimationStrip} disabled={!image || !selectedAnimation?.frameIds.length}>Animation Strip PNG</Button></section>
        <section className="section"><div className="section-title">Sequenz</div><div className="sequence">{selectedAnimation?.frameIds.length ? selectedAnimation.frameIds.map((fid, i) => <div key={`${fid}_${i}`} className="seq-item"><Button small variant="secondary" onClick={() => moveAnimFrame(i, i - 1)}>↑</Button><Button small variant="secondary" onClick={() => moveAnimFrame(i, i + 1)}>↓</Button><button className="btn secondary small name" onClick={() => setProject((p) => ({ ...p, selectedFrameId: fid }))}>{i + 1}. {getFrameById(fid)?.name || fid}</button><Button small variant="danger" onClick={() => toggleFrameInAnimation(fid)}>x</Button></div>) : <div className="subtle">Noch keine Frames.</div>}</div></section>
        <section className="section"><div className="section-title">Frame Pool</div><div className="pool">{project.frames.map((f) => <button key={f.id} className={selectedAnimation?.frameIds.includes(f.id) ? 'active' : ''} title={f.name} onClick={() => { setProject((p) => ({ ...p, selectedFrameId: f.id })); toggleFrameInAnimation(f.id); }}>{String(f.index).padStart(3, '0')}</button>)}</div></section>
        <section className="section"><div className="section-title">Export</div><div className="two"><Button variant="secondary" onClick={exportCanvasGameJson}>Game JSON</Button><Button variant="purple" onClick={exportBudStormJson}>BudStorm JSON</Button><Button variant="purple" onClick={exportBudStormJs}>BudStorm JS</Button><Button variant="secondary" onClick={exportProcessedPng}>PNG</Button></div></section>
      </aside>
    </main>

    <footer className="card card-pad subtle">Copyright © 2026 ThreadCore - Mathias P.R. Hinkel. All rights reserved. · Online-Ziel: /arcade/spriteeditor/ · Hilfe: /arcade/spriteeditor/help/</footer>
  </div></div>;
}
