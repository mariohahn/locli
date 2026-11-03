// keys normalize: identifiers used on iOS or Android are `_` only (Android resource names can't hold
// dots). Renames legacy dotted keys (common.archived → common_archived) in locli, in the String
// Catalogs and in the Swift/Objective-C code, and merges them into an existing underscore key.
import fs from 'node:fs';
import path from 'node:path';
import { openConfig } from '../context.js';
import { requireProject, projectDetail } from '../remote.js';
import { readCatalogFile, writeCatalog } from '../formats/xcstrings.js';
import { sourceFiles } from '../usage.js';
import { LocliError, plural } from '../util.js';

/** `common.archived`, not text used as a key ("Gespeichert.", "Lädt..."). Same rule as the server. */
export const isDottedIdentifier = (/** @type {string} */ key) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(key);
export const dotFree = (/** @type {string} */ key) => key.replaceAll('.', '_');

const CODE_FILE = /\.(swift|m|mm|h)$/;

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean, dryRun?: boolean, code?: boolean }} flags
 */
export async function keys(ctx, flags, /** @type {string | undefined} */ action) {
  if (action !== 'normalize') throw new LocliError('Usage: locli keys normalize [--dry-run] [--no-code] [--json]', 2);
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
    for (const key of Object.keys(catalog.strings ?? {})) {
      if (!isDottedIdentifier(key) || remoteNames.has(key) || mapping.has(key) || blocked.has(key)) continue;
      mapping.set(key, dotFree(key)); localOnly.push(key);
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
    localOnly: localOnly.map((from) => ({ from, to: dotFree(from) })),
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
  if (result.merged.length) ctx.out(`${say('Would merge', 'Merged')} ${plural(result.merged.length, 'key')} into the existing _ key: ${sample(result.merged.map((m) => `${m.from} → ${m.into}`))}`);
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
