// find_texts / add_texts: used by the MCP server so agents can reuse keys and add texts directly.
import { openConfig } from '../context.js';
import { requireProject, projectDetail, ensurePlatforms, ensureLocales, valueIndex, releasesURL } from '../remote.js';
import { currentBranch } from '../git.js';
import { LocliError, SNAKE_CASE, matchLocale, plural } from '../util.js';
import { PLATFORMS } from '../config.js';

/**
 * Searches keys, comments and values (case-insensitive substring; all words must match).
 * @param {import('../context.js').Context} ctx
 * @param {{ query: string, locale?: string, limit?: number, config?: string, apiUrl?: string }} options
 */
export async function findTexts(ctx, options) {
  const query = String(options.query ?? '').trim().toLowerCase();
  if (!query) throw new LocliError('query is required', 2);
  const { config, api } = openConfig(ctx, options);
  const project = await requireProject(api, config.project);
  const detail = await projectDetail(api, project.id);
  const index = valueIndex(detail.translations);
  const localeCode = options.locale ? matchLocale(detail.locales.map((l) => l.code), options.locale) : undefined;
  if (options.locale && !localeCode) throw new LocliError(`Unknown language ${options.locale} (project has ${detail.locales.map((l) => l.code).join(', ')})`, 2);
  const words = query.split(/\s+/);
  const matches = [];
  for (const key of detail.keys) {
    if (key.storeField) continue;
    /** @type {Record<string, string>} */
    const values = {};
    for (const locale of detail.locales) {
      if (localeCode && locale.code !== localeCode) continue;
      const scopes = index.get(key.id)?.get(locale.id);
      const value = scopes?.get('shared') ?? key.platforms.map((/** @type {string} */ p) => scopes?.get(p)).find(Boolean);
      if (value) values[locale.code] = value.forms ? Object.entries(value.forms).map(([c, t]) => `${c}: ${t}`).join(' | ') : value.value;
    }
    const haystack = [key.key, key.comment ?? '', ...Object.values(values)].join('\n').toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    const exact = key.key.toLowerCase() === query || Object.values(values).some((v) => v.toLowerCase() === query);
    matches.push({ key: key.key, comment: key.comment && key.comment !== 'Imported' ? key.comment : null, platforms: key.platforms, plural: key.plural ?? null, values, exact });
  }
  matches.sort((a, b) => Number(b.exact) - Number(a.exact) || a.key.localeCompare(b.key));
  return { total: matches.length, matches: matches.slice(0, options.limit ?? 25) };
}

/**
 * @typedef {{ key: string, comment?: string, values?: Record<string, string>, forms?: Record<string, Record<string, string>>,
 *   platforms?: string[], pluralArgument?: number }} NewText
 */

/**
 * Creates missing keys and values; never overwrites. Returns what was created and skipped.
 * @param {import('../context.js').Context} ctx
 * @param {{ texts: NewText[], branch?: string, dryRun?: boolean, config?: string, apiUrl?: string }} options
 */
export async function addTexts(ctx, options) {
  const texts = options.texts;
  if (!Array.isArray(texts) || !texts.length) throw new LocliError('texts must be a non-empty list', 2);
  const warnings = [];
  for (const text of texts) {
    if (!text || typeof text.key !== 'string' || !text.key.trim()) throw new LocliError('every text needs a key', 2);
    if (!text.values && !text.forms) throw new LocliError(`${text.key}: provide values or forms`, 2);
    if (!SNAKE_CASE.test(text.key)) warnings.push(`${text.key}: keys should be lower_snake_case with the feature area first (e.g. receipt_import_title)`);
    if (!text.comment?.trim()) warnings.push(`${text.key}: add a comment saying where the text appears (context for translators)`);
    for (const p of text.platforms ?? []) if (!PLATFORMS.includes(p)) throw new LocliError(`${text.key}: unknown platform ${p}`, 2);
    for (const forms of Object.values(text.forms ?? {})) if (!forms.other) throw new LocliError(`${text.key}: plural forms need "other"`, 2);
  }
  const { loaded, config, api } = openConfig(ctx, options);
  const project = await requireProject(api, config.project);
  const detail = await projectDetail(api, project.id);
  const branch = options.branch || currentBranch(loaded.dir, ctx.env);
  const defaultPlatforms = [...new Set(config.targets.map((t) => t.platform))];
  const wantedPlatforms = [...new Set(texts.flatMap((t) => t.platforms ?? defaultPlatforms))];
  if (!options.dryRun) await ensurePlatforms(api, detail, wantedPlatforms);
  const codes = [...new Set(texts.flatMap((t) => [...Object.keys(t.values ?? {}), ...Object.keys(t.forms ?? {})]))];
  const { ids } = await ensureLocales(api, detail, codes, { dryRun: options.dryRun });
  const index = valueIndex(detail.translations);
  const byName = new Map(detail.keys.map((k) => [k.key, k]));

  /** @type {Map<string, { values: Record<string, string>, forms: Record<string, Record<string, string>>, pluralArguments: Record<string, number> }>} */
  const batches = new Map();
  const created = new Set();
  const added = [];
  const skipped = [];
  for (const text of texts) {
    const remote = byName.get(text.key);
    const entries = [
      ...Object.entries(text.values ?? {}).map(([code, value]) => ({ code, value, forms: undefined })),
      ...Object.entries(text.forms ?? {}).map(([code, forms]) => ({ code, value: forms.other, forms })),
    ];
    for (const entry of entries) {
      const localeID = ids[entry.code];
      const scopes = remote ? index.get(remote.id)?.get(localeID) : undefined;
      if (scopes && scopes.size) { skipped.push(`${text.key} (${entry.code})`); continue; }
      if (!entry.value?.trim()) continue;
      const batch = batches.get(entry.code) ?? { values: {}, forms: {}, pluralArguments: {} };
      if (entry.forms) {
        batch.forms[text.key] = entry.forms;
        if (text.pluralArgument) batch.pluralArguments[text.key] = text.pluralArgument;
      } else batch.values[text.key] = entry.value;
      batches.set(entry.code, batch);
      added.push(`${text.key} (${entry.code})`);
      if (!remote) created.add(text.key);
    }
  }
  const sourceCode = matchLocale(codes, detail.defaultLocale);
  const missingSource = [...created].filter((key) => {
    const text = texts.find((t) => t.key === key);
    return !matchLocale([...Object.keys(text?.values ?? {}), ...Object.keys(text?.forms ?? {})], detail.defaultLocale);
  });
  if (missingSource.length) warnings.push(`no source-language (${detail.defaultLocale}) text for: ${missingSource.join(', ')}`);
  if (options.dryRun) return { dryRun: true, created: [...created], added, skipped, warnings };

  // The source language first, so translations are checked against its placeholders.
  const order = [...batches.keys()].sort((a, b) => Number(b === sourceCode) - Number(a === sourceCode));
  let feature = null;
  for (const code of order) {
    const batch = /** @type {any} */ (batches.get(code));
    const result = await api.post(`/api/projects/${project.id}/translations/import`, {
      localeID: ids[code], platform: 'shared', status: 'translated', values: batch.values, forms: batch.forms, pluralArguments: batch.pluralArguments, branch,
    });
    if (result?.feature) feature = result.feature;
  }
  // New keys: set context and platforms (the import gave them every project platform).
  const after = await projectDetail(api, project.id);
  const remoteKeys = new Map(after.keys.map((k) => [k.key, k]));
  for (const text of texts) {
    const key = remoteKeys.get(text.key);
    if (!key) continue;
    const platforms = created.has(text.key) ? (text.platforms ?? (defaultPlatforms.length ? defaultPlatforms : key.platforms)) : key.platforms;
    const comment = text.comment?.trim() && ['', 'Imported'].includes((key.comment ?? '').trim()) ? text.comment.trim() : key.comment;
    const samePlatforms = platforms.length === key.platforms.length && platforms.every((/** @type {string} */ p) => key.platforms.includes(p));
    if (samePlatforms && comment === key.comment) continue;
    await api.patch(`/api/projects/${project.id}/keys/${key.id}`, { key: key.key, namespace: key.namespace, comment: comment ?? null, platforms });
  }
  const lines = [];
  lines.push(added.length ? `Added ${plural(added.length, 'text')} (${plural(created.size, 'new key')}) to ${config.project}.` : 'Nothing added.');
  if (skipped.length) lines.push(`Skipped ${plural(skipped.length, 'existing text')} (never overwritten; change them in locli): ${skipped.join(', ')}`);
  if (feature) lines.push(`Feature "${feature.title}" (${branch})`);
  if (added.length) lines.push(`These texts wait for a release — ask the project owner to approve it at ${releasesURL(api.baseURL, project.id)}, then run \`npx @locli/cli pull\`.`);
  for (const line of lines) ctx.out(line);
  return { created: [...created], added, skipped, warnings, feature: feature?.title ?? null };
}
