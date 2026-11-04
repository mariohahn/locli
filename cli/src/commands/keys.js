// keys normalize: identifiers used on iOS or Android are lower_snake_case (Android resource names can't
// hold dots). Renames legacy dotted keys (adminDashboard.location → admin_dashboard_location) in locli,
// in the String Catalogs and in the Swift/Objective-C code, and merges them into an existing snake_case
// key; a camelCase key whose snake_case twin exists (adminDashboard_location) is merged the same way.
import fs from 'node:fs';
import path from 'node:path';
import { openConfig } from '../context.js';
import { requireProject, projectDetail } from '../remote.js';
import { readCatalogFile, writeCatalog } from '../formats/xcstrings.js';
import { localeForValuesDir, removeAndroidResources } from '../formats/android.js';
import { findLocaleFiles, removeMessages } from '../formats/json.js';
import { exportName, androidName } from '../remote.js';
import { sourceFiles } from '../usage.js';
import { LocliError, plural, writeFileIfChanged } from '../util.js';

/** `common.archived`, not text used as a key ("Gespeichert.", "Lädt..."). Same rule as the server. */
export const isDottedIdentifier = (/** @type {string} */ key) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(key);
/** adminDashboard.location → admin_dashboard_location, URLScheme.title → url_scheme_title. Same as the server. */
export const snakeName = (/** @type {string} */ key) => key.replaceAll('.', '_')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase().replace(/_+/g, '_');
const isCamelIdentifier = (/** @type {string} */ key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && snakeName(key) !== key;

const CODE_FILE = /\.(swift|m|mm|h)$/;

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, dryRun?: boolean, code?: boolean, names?: string[] }} flags
 */
export async function keys(ctx, flags, /** @type {string | undefined} */ action) {
  if (action === 'delete') return deleteKeys(ctx, flags);
  if (action !== 'normalize') throw new LocliError('Usage: locli keys normalize [--dry-run] [--no-code] [--json] | locli keys delete KEY… [--dry-run] [--json]', 2);
  const { loaded, config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  const base = `/api/projects/${project.id}/keys/normalize`;
  const remote = await api.post(base, { apply: false });
  const detail = await projectDetail(api, project.id);
  const remoteNames = new Set(detail.keys.map((/** @type {any} */ k) => k.key));

  /** @type {Map<string, string>} from → to */
  const mapping = new Map();
  for (const r of remote.renamed) mapping.set(r.from, r.to);
  for (const m of remote.merged) mapping.set(m.from, m.into);
  /** @type {{ key: string, target: string, reason: string }[]} */
  const conflicts = [...remote.conflicts];
  const blocked = new Set(conflicts.map((c) => c.key));

  // Catalog keys that were never pushed are renamed locally only, so the first push goes through.
  const catalogs = config.targets.filter((t) => t.format === 'xcstrings').map((target) => {
    const file = path.resolve(loaded.dir, target.path);
    return { target, file, catalog: readCatalogFile(file) };
  });
  /** @type {string[]} */
  const localOnly = [];
  for (const { catalog } of catalogs) {
    const names = new Set([...Object.keys(catalog.strings ?? {}), ...remoteNames]);
    for (const key of Object.keys(catalog.strings ?? {})) {
      if (remoteNames.has(key) || mapping.has(key) || blocked.has(key)) continue;
      if (!isDottedIdentifier(key) && !(isCamelIdentifier(key) && names.has(snakeName(key)))) continue;
      mapping.set(key, snakeName(key)); localOnly.push(key);
    }
  }

  // String literals in the Swift/Objective-C code that name a renamed key.
  const files = flags.code === false ? [] : sourceFiles(loaded.dir).filter((file) => CODE_FILE.test(file));
  /** @type {{ file: string, count: number, text: string }[]} */
  const edits = [];
  if (mapping.size) {
    const pattern = new RegExp(`"(${[...mapping.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})"`, 'g');
    for (const file of files) {
      const full = path.join(loaded.dir, file);
      const source = fs.readFileSync(full, 'utf8');
      let count = 0;
      const text = source.replace(pattern, (_, key) => { count += 1; return `"${mapping.get(key)}"`; });
      if (count) edits.push({ file, count, text });
    }
  }

  const androidChanges = remote.renamed.filter((/** @type {any} */ r) => r.androidBefore && r.androidAfter);
  const web = [...remote.renamed, ...remote.merged].filter((/** @type {any} */ r) => r.platforms.includes('web')).map((/** @type {any} */ r) => r.from);
  const result = {
    applied: false,
    renamed: remote.renamed.map((/** @type {any} */ r) => ({ from: r.from, to: r.to })),
    merged: remote.merged.map((/** @type {any} */ m) => ({ from: m.from, into: m.into })),
    localOnly: localOnly.map((from) => ({ from, to: snakeName(from) })),
    conflicts,
    code: edits.map((e) => ({ file: e.file, replacements: e.count })),
    androidNameChanges: androidChanges.map((/** @type {any} */ r) => ({ from: r.androidBefore, to: r.androidAfter })),
    webLookups: web,
  };

  if (!flags.dryRun && mapping.size) {
    if (remote.renamed.length || remote.merged.length) await api.post(base, { apply: true });
    for (const { file, catalog } of catalogs) {
      let changed = false;
      for (const [from, to] of mapping) {
        const entry = catalog.strings?.[from];
        if (!entry) continue;
        const existing = catalog.strings[to];
        if (existing) {
          // locli kept the underscore key's texts; languages only the old entry had stay.
          existing.localizations = { ...(entry.localizations ?? {}), ...(existing.localizations ?? {}) };
          if (!existing.comment && entry.comment) existing.comment = entry.comment;
        } else catalog.strings[to] = entry;
        delete catalog.strings[from];
        changed = true;
      }
      if (changed) writeCatalog(file, catalog);
    }
    for (const edit of edits) fs.writeFileSync(path.join(loaded.dir, edit.file), edit.text);
    result.applied = true;
  }

  if (flags.json) { ctx.out(JSON.stringify(result, null, 2)); return result; }
  const say = (/** @type {string} */ would, /** @type {string} */ done) => (result.applied ? done : would);
  const total = result.renamed.length + result.merged.length + result.localOnly.length;
  if (!total && !conflicts.length) { ctx.out('No dotted keys on iOS or Android: every identifier already uses _.'); return result; }
  if (result.renamed.length) ctx.out(`${say('Would rename', 'Renamed')} ${plural(result.renamed.length, 'key')} in locli: ${sample(result.renamed.map((r) => `${r.from} → ${r.to}`))}`);
  if (result.merged.length) ctx.out(`${say('Would merge', 'Merged')} ${plural(result.merged.length, 'key')} into the existing snake_case key: ${sample(result.merged.map((m) => `${m.from} → ${m.into}`))}`);
  if (result.localOnly.length) ctx.out(`${say('Would rename', 'Renamed')} ${plural(result.localOnly.length, 'key')} not in locli yet (catalog only): ${sample(result.localOnly.map((r) => `${r.from} → ${r.to}`))}`);
  if (edits.length) ctx.out(`${say('Would update', 'Updated')} ${plural(edits.reduce((n, e) => n + e.count, 0), 'string literal')} in ${plural(edits.length, 'file')}: ${sample(edits.map((e) => e.file))}`);
  for (const c of conflicts) ctx.warn(`${c.key} → ${c.target} not merged: ${c.reason}. Decide which text is right in locli, then rerun.`);
  if (androidChanges.length) ctx.warn(`${plural(androidChanges.length, 'Android resource name')} change${androidChanges.length === 1 ? 's' : ''} (update R.string references): ${sample(result.androidNameChanges.map((c) => `${c.from} → ${c.to}`))}`);
  if (web.length) ctx.warn(`${plural(web.length, 'key')} also used on web: update those lookups too (${sample(web)}).`);
  if (!result.applied) ctx.out('Dry run: nothing changed. Run without --dry-run to apply, then build the app.');
  else ctx.out('Build the app and commit the catalog and code together. Texts, translations and history moved with the keys.');
  return result;
}

const sample = (/** @type {string[]} */ items) => `${items.slice(0, 5).join(', ')}${items.length > 5 ? `, … (${items.length})` : ''}`;

/**
 * keys delete: removes keys that were never released, in locli and in the local catalogs (else the
 * next push would add them again). Released keys are refused; a project owner deletes them in the web.
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, dryRun?: boolean, names?: string[] }} flags
 */
export async function deleteKeys(ctx, flags) {
  const names = [...new Set(flags.names ?? [])];
  if (!names.length) throw new LocliError('Usage: locli keys delete KEY… [--dry-run] [--json]', 2);
  const { loaded, config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  const base = `/api/projects/${project.id}/keys/delete`;
  const plan = await api.post(base, { keys: names, apply: false });
  if (plan.released.length) {
    throw new LocliError(`${plural(plan.released.length, 'key')} already released, nothing was deleted: ${sample(plan.released.map((/** @type {any} */ r) => `${r.key} (${r.release})`))}
Apps may still show released texts, so only a project owner deletes them, in the web editor. Delete the others without them.`, 2);
  }
  const detail = await projectDetail(api, project.id);
  const remote = new Map(detail.keys.map((/** @type {any} */ k) => [k.key, k]));
  const deleted = plan.deleted.map((/** @type {any} */ d) => d.key);
  // Keys locli doesn't know may still sit in a catalog (never pushed): those are removed locally only.
  const gone = [...deleted, ...plan.missing];
  /** @param {import('../config.js').Target} target @param {string} key */
  const localName = (target, key) => {
    const known = remote.get(key);
    if (target.format === 'android-xml') return known ? exportName(known, 'android') : (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : androidName(key));
    if (target.format === 'json' && target.keyPrefix) return key.startsWith(`${target.keyPrefix}.`) ? key.slice(target.keyPrefix.length + 1) : null;
    return key;
  };

  /** @type {{ file: string, removed: number, content: string }[]} */
  const files = [];
  /** @type {Set<string>} */
  const foundLocally = new Set();
  for (const target of config.targets) {
    /** @type {Map<string, string>} local name → key */
    const wanted = new Map();
    for (const key of gone) { const name = localName(target, key); if (name) wanted.set(name, key); }
    const dir = path.resolve(loaded.dir, target.path);
    if (target.format === 'xcstrings') {
      if (!fs.existsSync(dir)) continue;
      const catalog = readCatalogFile(dir);
      let removed = 0;
      for (const [name, key] of wanted) if (catalog.strings?.[name]) { delete catalog.strings[name]; removed += 1; foundLocally.add(key); }
      if (removed) files.push({ file: dir, removed, content: JSON.stringify(catalog) });
    } else if (target.format === 'android-xml') {
      if (!fs.existsSync(dir)) continue;
      for (const values of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, values, target.file ?? 'strings.xml');
        if (localeForValuesDir(values) === undefined || !fs.existsSync(file)) continue;
        let content = fs.readFileSync(file, 'utf8'), removed = 0;
        for (const [name, key] of wanted) {
          const result = removeAndroidResources(content, new Set([name]));
          if (result.removed) { content = result.content; removed += result.removed; foundLocally.add(key); }
        }
        if (removed) files.push({ file, removed, content });
      }
    } else if (target.format === 'json') {
      for (const file of Object.values(findLocaleFiles(loaded.dir, target.path))) {
        const text = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(text);
        let removed = 0;
        for (const [name, key] of wanted) if (removeMessages(data, [name])) { removed += 1; foundLocally.add(key); }
        if (!removed) continue;
        const indent = /^\{\s*\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
        files.push({ file, removed, content: JSON.stringify(data, null, indent) + (text.endsWith('\n') ? '\n' : '') });
      }
    }
  }
  const unknown = plan.missing.filter((/** @type {string} */ key) => !foundLocally.has(key));
  const localOnly = plan.missing.filter((/** @type {string} */ key) => foundLocally.has(key));

  // Code that still names a deleted key: the app would show the raw key after the next pull.
  const references = [];
  const removedKeys = [...deleted, ...localOnly];
  if (removedKeys.length) {
    const literals = removedKeys.flatMap((key) => [`"${key}"`, `R.string.${localName({ platform: 'android', format: 'android-xml', path: '' }, key)}`, `R.plurals.${localName({ platform: 'android', format: 'android-xml', path: '' }, key)}`]);
    for (const file of sourceFiles(loaded.dir).filter((f) => /\.(swift|m|mm|h|kt|java|ts|tsx|js|jsx)$/.test(f))) {
      const source = fs.readFileSync(path.join(loaded.dir, file), 'utf8');
      if (literals.some((literal) => source.includes(literal))) references.push(file);
    }
  }

  const result = {
    applied: false,
    deleted: plan.deleted.map((/** @type {any} */ d) => ({ key: d.key, platforms: d.platforms, values: d.values })),
    localOnly,
    unknown,
    files: files.map((f) => ({ file: path.relative(loaded.dir, f.file), removed: f.removed })),
    stillReferencedIn: references,
  };
  if (!flags.dryRun && (deleted.length || files.length)) {
    if (deleted.length) await api.post(base, { keys: deleted, apply: true });
    for (const f of files) {
      if (f.file.endsWith('.xcstrings')) writeCatalog(f.file, JSON.parse(f.content)); else writeFileIfChanged(f.file, f.content);
    }
    result.applied = true;
  }

  if (flags.json) { ctx.out(JSON.stringify(result, null, 2)); return result; }
  const say = (/** @type {string} */ would, /** @type {string} */ done) => (result.applied ? done : would);
  if (deleted.length) ctx.out(`${say('Would delete', 'Deleted')} ${plural(deleted.length, 'unreleased key')} in locli: ${sample(deleted)}`);
  if (localOnly.length) ctx.out(`${say('Would remove', 'Removed')} ${plural(localOnly.length, 'key')} not in locli from the catalogs: ${sample(localOnly)}`);
  if (files.length) ctx.out(`${say('Would update', 'Updated')} ${plural(files.length, 'file')}: ${sample(result.files.map((f) => f.file))}`);
  if (unknown.length) ctx.warn(`Not found in locli or the catalogs: ${sample(unknown)}`);
  if (references.length) ctx.warn(`The code still uses ${removedKeys.length === 1 ? 'this key' : 'these keys'} in ${sample(references)}: remove those uses too.`);
  if (!deleted.length && !files.length) ctx.out('Nothing to delete.');
  else if (!result.applied) ctx.out('Dry run: nothing changed. Run without --dry-run to delete.');
  return result;
}
