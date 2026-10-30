// Stack detection: finds String Catalogs, Android resources and web JSON message files.
import fs from 'node:fs';
import path from 'node:path';
import { findLocaleFiles } from './formats/json.js';
import { localeForValuesDir } from './formats/android.js';

export const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'out', '.next', '.nuxt', '.svelte-kit', '.output', 'Pods', 'DerivedData',
  '.build', '.gradle', '.idea', 'target', 'vendor', 'Carthage', '.swiftpm', 'coverage', '.turbo', '.cache', '.expo', 'intermediates', 'generated', '.venv', 'venv', '__pycache__', '.agents', '.claude']);
const LOCALE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 50_000;

/**
 * @param {string} root
 * @returns {{ targets: import('./config.js').Target[], sourceLanguage?: string, locales: string[], notes: string[] }}
 */
export function detectTargets(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const dirs = [];
  let seen = 0;
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      seen += 1;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.endsWith('.xcassets') || entry.name.endsWith('.xcodeproj') || entry.name.endsWith('.xcworkspace')) continue;
        dirs.push(full);
        walk(full, depth + 1);
      } else if (entry.isFile()) files.push(full);
    }
  };
  walk(root, 0);
  const rel = (/** @type {string} */ p) => path.relative(root, p).split(path.sep).join('/');
  /** @type {import('./config.js').Target[]} */
  const targets = [];
  const notes = [];
  const locales = new Set();
  let sourceLanguage;

  for (const file of files.filter((f) => f.endsWith('.xcstrings')).sort()) {
    if (path.basename(file) === 'InfoPlist.xcstrings') { notes.push(`Skipped ${rel(file)} (Info.plist texts; add it with --target ios:xcstrings:${rel(file)} if wanted)`); continue; }
    targets.push({ platform: 'ios', format: 'xcstrings', path: rel(file) });
    try {
      const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
      sourceLanguage ??= catalog.sourceLanguage;
      for (const entry of Object.values(catalog.strings ?? {})) for (const code of Object.keys(/** @type {any} */ (entry).localizations ?? {})) locales.add(code);
      if (catalog.sourceLanguage) locales.add(catalog.sourceLanguage);
    } catch { notes.push(`${rel(file)} is not valid JSON`); }
  }

  for (const file of files.filter((f) => rel(f).endsWith('src/main/res/values/strings.xml')).sort()) {
    const res = path.dirname(path.dirname(file));
    targets.push({ platform: 'android', format: 'android-xml', path: rel(res) });
    for (const dir of fs.readdirSync(res)) {
      const locale = localeForValuesDir(dir);
      if (locale && fs.existsSync(path.join(res, dir, 'strings.xml'))) locales.add(locale);
    }
  }

  // Web JSON: directories of locale-named files, or locale directories with namespace files.
  /** @type {Map<string, string>} pattern → reason */
  const patterns = new Map();
  for (const dir of dirs) {
    const base = path.basename(dir);
    if (!['messages', 'locales', 'locale', 'i18n', 'lang', 'langs', 'translations', 'l10n'].includes(base)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const localeFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json') && LOCALE.test(e.name.slice(0, -5)));
    if (localeFiles.length) { patterns.set(`${rel(dir)}/{locale}.json`, ''); continue; }
    const localeDirs = entries.filter((e) => e.isDirectory() && LOCALE.test(e.name));
    if (localeDirs.length) {
      const namespaces = new Set();
      for (const d of localeDirs) for (const f of fs.readdirSync(path.join(dir, d.name))) if (f.endsWith('.json')) namespaces.add(f.slice(0, -5));
      const many = namespaces.size > 1;
      for (const ns of [...namespaces].sort()) patterns.set(`${rel(dir)}/{locale}/${ns}.json${many ? `#${ns}` : ''}`, '');
    }
  }
  for (const spec of patterns.keys()) {
    const [pattern, keyPrefix] = spec.split('#');
    const found = findLocaleFiles(root, pattern);
    if (!Object.keys(found).length) continue;
    targets.push({ platform: 'web', format: 'json', path: pattern, ...(keyPrefix ? { keyPrefix } : {}) });
    for (const code of Object.keys(found)) locales.add(code);
    if (!sourceLanguage && found.en) sourceLanguage = 'en';
  }
  return { targets, sourceLanguage, locales: [...locales].sort(), notes };
}

/** Short guidance per stack when the repository has no localization files yet. */
export const SETUP_HINTS = [
  'iOS: create a String Catalog in Xcode (File > New > String Catalog, e.g. App/Localizable.xcstrings), then `npx @locli/cli init --target ios:xcstrings:App/Localizable.xcstrings`.',
  'Android: put texts in app/src/main/res/values/strings.xml, then `npx @locli/cli init --target android:app/src/main/res`.',
  'Web: keep ICU messages in messages/en.json (one file per language), then `npx @locli/cli init --target web:json:messages/{locale}.json`.',
  'Backend: same JSON layout, e.g. `--target backend:json:resources/i18n/{locale}.json`.',
];
