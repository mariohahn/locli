// pull: write an approved release (or, with --draft, the working state) into the app's files.
import fs from 'node:fs';
import path from 'node:path';
import { openConfig } from '../context.js';
import { selectTargets, describeTarget } from '../targets.js';
import { requireProject, resolveRelease, releaseQuery } from '../remote.js';
import { readCatalogFile, units, mergeCatalog, writeCatalog } from '../formats/xcstrings.js';
import { localeForValuesDir, valuesDirForLocale, mergeAndroidResources } from '../formats/android.js';
import { findLocaleFiles, localeFilePath, writeJsonFile, isNested } from '../formats/json.js';
import { LocliError, matchLocale, normalizeLocale, plural, writeFileIfChanged } from '../util.js';


/** @param {string} code */
function canonicalLocale(code) {
  try { return Intl.getCanonicalLocales(code)[0] ?? code; } catch { return code; }
}

/** @param {string | null} release */
function label(release) {
  return release ? `release ${release}` : 'working state (unapproved)';
}

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, draft?: boolean, release?: string, target?: string }} flags
 */
export async function pull(ctx, flags) {
  const { loaded, config, api } = openConfig(ctx, flags);
  const targets = selectTargets(config.targets, flags.target);
  // Validate local catalogs before talking to the server.
  for (const target of targets) {
    if (target.format === 'xcstrings') units(readCatalogFile(path.resolve(loaded.dir, target.path)));
  }
  const project = await requireProject(api, config.project);
  // One explicit name for every request, so two targets can't straddle a new release.
  const release = await resolveRelease(api, project, flags);
  const query = releaseQuery(release);
  const results = [];
  for (const target of targets) {
    if (target.format === 'xcstrings') results.push(await pullCatalog(ctx, api, project, loaded.dir, target, query, release));
    else if (target.format === 'android-xml') results.push(await pullAndroid(ctx, api, project, loaded.dir, target, query, release, config.sourceLanguage));
    else results.push(await pullJson(ctx, api, project, loaded.dir, target, query, release, config.sourceLanguage));
  }
  if (release === null) ctx.out('Note: --draft wrote unapproved texts; use them for local checks only, not for release builds.');
  return { project: config.project, release, targets: results };
}

/** @param {import('../context.js').Context} ctx @param {import('../http.js').Api} api @param {any} project @param {string} root @param {import('../config.js').Target} target @param {string} query @param {string | null} release */
async function pullCatalog(ctx, api, project, root, target, query, release) {
  const file = path.resolve(root, target.path);
  const catalog = readCatalogFile(file);
  const remote = await api.get(`/api/projects/${project.id}/export/ios?format=xcstrings${query ? `&${query}` : ''}`);
  mergeCatalog(catalog, remote);
  const written = writeCatalog(file, catalog);
  ctx.out(`Catalog ready: ${target.path} (${plural(Object.keys(catalog.strings).length, 'key')}, ${label(release)})${written ? '' : ', unchanged'}`);
  return { target: describeTarget(target), files: written ? [target.path] : [] };
}

/** @param {import('../context.js').Context} ctx @param {import('../http.js').Api} api @param {any} project @param {string} root @param {import('../config.js').Target} target @param {string} query @param {string | null} release @param {string} sourceLanguage */
async function pullAndroid(ctx, api, project, root, target, query, release, sourceLanguage) {
  const resDir = path.resolve(root, target.path);
  const fileName = target.file ?? 'strings.xml';
  const resolved = await api.get(`/api/projects/${project.id}/resolved/android${query ? `?${query}` : ''}`);
  if (!Array.isArray(resolved?.keys) || !Array.isArray(resolved?.locales)) throw new LocliError('Invalid API response from resolved/android');
  if (!resolved.keys.length) {
    ctx.out(`${describeTarget(target)}: no texts assigned to Android in the ${label(release)}; nothing written.`);
    return { target: describeTarget(target), files: [] };
  }
  /** @type {Map<string, string>} normalized locale → existing values dir */
  const existingDirs = new Map();
  if (fs.existsSync(resDir)) {
    for (const entry of fs.readdirSync(resDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const locale = localeForValuesDir(entry.name);
      if (locale) existingDirs.set(normalizeLocale(locale), entry.name);
    }
  }
  const source = normalizeLocale(resolved.sourceLanguage ?? sourceLanguage);
  const files = [];
  let changedTotal = 0;
  for (const locale of resolved.locales) {
    const code = normalizeLocale(locale.code);
    const dir = code === source ? 'values' : existingDirs.get(code) ?? valuesDirForLocale(locale.code);
    /** @type {import('../formats/android.js').AndroidOutput[]} */
    const entries = [];
    for (const key of resolved.keys) {
      const value = key.values?.[locale.code];
      if (!value) continue;
      const name = key.identifier ?? key.key;
      if (key.valueKind === 'array') { if (value.items?.length) entries.push({ name, kind: 'array', items: value.items }); continue; }
      if (key.plural && value.forms) { entries.push({ name, kind: 'plurals', forms: value.forms }); continue; }
      if (!value.value) continue; // missing ≠ empty: let Android fall back to the default language
      entries.push({ name, kind: 'string', value: value.value });
    }
    const filePath = path.join(resDir, dir, fileName);
    let existing = null;
    try { existing = fs.readFileSync(filePath, 'utf8'); } catch { /* new */ }
    if (!entries.length && existing === null) continue;
    const valid = [];
    for (const entry of entries) {
      try { mergeAndroidResources(null, [entry]); valid.push(entry); } catch (error) {
        ctx.warn(`${dir}/${fileName}: ${entry.name} skipped (${/** @type {Error} */ (error).message}); add an Android-specific text in locli`);
      }
    }
    let merged;
    try { merged = mergeAndroidResources(existing, valid); } catch (error) {
      throw new LocliError(`${path.join(target.path, dir, fileName)}: ${/** @type {Error} */ (error).message}`);
    }
    for (const w of merged.warnings) ctx.warn(`${dir}/${fileName}: ${w}`);
    if (writeFileIfChanged(filePath, merged.content)) { files.push(path.join(target.path, dir, fileName)); changedTotal += merged.changed; }
  }
  ctx.out(`${describeTarget(target)}: ${files.length ? `updated ${plural(files.length, 'file')} (${plural(changedTotal, 'text')})` : 'up to date'} from the ${label(release)}.`);
  return { target: describeTarget(target), files };
}

/** @param {import('../context.js').Context} ctx @param {import('../http.js').Api} api @param {any} project @param {string} root @param {import('../config.js').Target} target @param {string} query @param {string | null} release @param {string} sourceLanguage */
async function pullJson(ctx, api, project, root, target, query, release, sourceLanguage) {
  const exported = await api.get(`/api/projects/${project.id}/export/${target.platform}${query ? `?${query}` : ''}`);
  if (!exported || typeof exported !== 'object') throw new LocliError(`Invalid API response from export/${target.platform}`);
  const prefix = target.keyPrefix ? `${target.keyPrefix}.` : '';
  const localFiles = findLocaleFiles(root, target.path);
  const sourceFile = localFiles[matchLocale(Object.keys(localFiles), sourceLanguage) ?? ''];
  let nestedDefault = false;
  if (sourceFile) { try { nestedDefault = isNested(JSON.parse(fs.readFileSync(sourceFile, 'utf8'))); } catch { /* checked on write */ } }
  const total = Object.values(exported).reduce((n, messages) => n + Object.keys(/** @type {object} */ (messages ?? {})).filter((k) => k.startsWith(prefix)).length, 0);
  if (!total) {
    ctx.out(`${describeTarget(target)}: no texts assigned to ${target.platform}${prefix ? ` with prefix ${target.keyPrefix}` : ''} in the ${label(release)}; nothing written.`);
    return { target: describeTarget(target), files: [] };
  }
  const files = [];
  let changedTotal = 0;
  for (const [code, messages] of Object.entries(exported)) {
    /** @type {Record<string, string>} */
    const selected = {};
    for (const [key, value] of Object.entries(/** @type {Record<string, string>} */ (messages ?? {}))) {
      if (key.startsWith(prefix) && typeof value === 'string') selected[key.slice(prefix.length)] = value;
    }
    const localCode = matchLocale(Object.keys(localFiles), code);
    if (!localCode && !Object.keys(selected).length) continue;
    const file = localCode ? localFiles[localCode] : localeFilePath(root, target.path, canonicalLocale(code));
    const { written, changed } = writeJsonFile(file, selected, { nestedDefault });
    if (written) { files.push(path.relative(root, file)); changedTotal += changed; }
  }
  ctx.out(`${describeTarget(target)}: ${files.length ? `updated ${plural(files.length, 'file')} (${plural(changedTotal, 'text')})` : 'up to date'} from the ${label(release)}.`);
  return { target: describeTarget(target), files };
}
