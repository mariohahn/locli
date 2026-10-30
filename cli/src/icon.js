// The app's own icon for the project in locli: the iOS AppIcon, the Android launcher icon or the
// web app icon, scaled to 128 px when macOS `sips` is there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SKIP_DIRS } from './detect.js';

/** What the server accepts (Project.maxIconLength), with room for the data URL prefix. */
const MAX_BYTES = 70 * 1024;
const MIME = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });

/** Web icons by preference: the large touch icons first, favicons last. */
const WEB_ICONS = ['apple-touch-icon.png', 'apple-icon.png', 'icon-512.png', 'icon-512x512.png', 'android-chrome-512x512.png', 'logo512.png', 'icon.png',
  'icon-192.png', 'icon-192x192.png', 'android-chrome-192x192.png', 'logo192.png', 'favicon.png'];
const ANDROID_DENSITIES = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];

/**
 * Finds the app icon under root, iOS first, then Android, then web.
 * @param {string} root @returns {{ file: string, platform: 'ios' | 'android' | 'web' } | null}
 */
export function findAppIcon(root) {
  /** @type {string[]} */
  const iconSets = [];
  /** @type {string[]} */
  const androidMains = [];
  /** @type {string[]} */
  const webDirs = [];
  const walk = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    if (depth > 7) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'AppIcon.appiconset') { iconSets.push(full); continue; }
      if (entry.name === 'main' && path.basename(dir) === 'src') androidMains.push(full);
      if (['public', 'static', 'app'].includes(entry.name)) webDirs.push(full);
      walk(full, depth + 1);
    }
  };
  walk(root, 0);

  for (const set of iconSets.sort()) {
    const file = largestAppIcon(set);
    if (file) return { file, platform: 'ios' };
  }
  for (const main of androidMains.sort()) {
    const store = ['ic_launcher-playstore.png', 'ic_launcher-web.png'].map((name) => path.join(main, name)).find(isFile);
    if (store) return { file: store, platform: 'android' };
    for (const density of ANDROID_DENSITIES) {
      for (const name of ['ic_launcher.png', 'ic_launcher.webp', 'ic_launcher_round.png', 'ic_launcher_round.webp']) {
        const file = path.join(main, 'res', `mipmap-${density}`, name);
        if (isFile(file)) return { file, platform: 'android' };
      }
    }
  }
  for (const name of WEB_ICONS) {
    const file = webDirs.sort().map((dir) => path.join(dir, name)).find(isFile);
    if (file) return { file, platform: 'web' };
  }
  return null;
}

const isFile = (/** @type {string} */ file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** The biggest light-mode image of an AppIcon set (1024 px in current Xcode projects). @param {string} set */
function largestAppIcon(set) {
  let contents;
  try { contents = JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8')); } catch { return null; }
  const images = (contents.images ?? [])
    .filter((/** @type {any} */ image) => image.filename && !image.appearances?.length && isFile(path.join(set, image.filename)))
    .map((/** @type {any} */ image) => ({ file: path.join(set, image.filename), px: Number.parseFloat(image.size ?? '0') * Number.parseFloat(image.scale ?? '1') }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.px - a.px);
  return images[0]?.file ?? null;
}

/**
 * The icon as a data URL: scaled to 128 px PNG with `sips` (macOS), else the file as it is when small
 * enough. Null when it is too large and can't be scaled.
 * @param {string} file
 */
export function iconDataURL(file) {
  const temp = path.join(os.tmpdir(), `locli-icon-${process.pid}.png`);
  try {
    const scaled = spawnSync('sips', ['-s', 'format', 'png', '-Z', '128', file, '--out', temp], { encoding: 'utf8', timeout: 15000 });
    if (scaled.status === 0 && isFile(temp)) {
      const data = fs.readFileSync(temp);
      if (data.length <= MAX_BYTES) return `data:image/png;base64,${data.toString('base64')}`;
    }
  } catch { /* no sips */ } finally { fs.rmSync(temp, { force: true }); }
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  const data = fs.readFileSync(file);
  return data.length <= MAX_BYTES ? `data:${mime};base64,${data.toString('base64')}` : null;
}
