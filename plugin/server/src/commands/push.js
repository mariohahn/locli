// push: upload only what locli lacks. Existing values are never overwritten.
import { glossaryMisses, loadGuide } from './guide.js';
import { describeTooLong, usageReport } from './context.js';
import { autoComment, isAutoComment } from '../usage.js';
import { openConfig } from '../context.js';
import { readTarget, selectTargets, describeTarget } from '../targets.js';
import { requireProject, projectDetail, ensurePlatforms, ensureLocales, valueIndex, exportName, androidName, releasesURL, projectURL } from '../remote.js';
import { currentBranch } from '../git.js';
import { ApiError } from '../http.js';
import { LocliError, areaOf, normalizeLocale, plural } from '../util.js';

/**
 * A key that is visible text rather than an identifier: whitespace, sentence punctuation, braces or
 * characters outside ASCII. Dotted and dashed legacy identifiers (account.login) are fine.
 * @param {string} key
 */
export function isTextKey(key) {
  return !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
}

/** Keys per import request; a whole app's catalog in one body can exceed the server's request limit. */
export const IMPORT_BATCH = 100;

/**
 * Splits one import body into requests of at most `size` keys, keeping each key's plural forms and
 * plural arguments with it.
 * @param {any} body @param {number} [size]
 */
export function importBatches(body, size = IMPORT_BATCH) {
  const keys = Object.keys(body.values ?? {});
  if (keys.length <= size) return [body];
  const pick = (/** @type {any} */ map, /** @type {string[]} */ slice) => (map && typeof map === 'object' ? Object.fromEntries(slice.filter((k) => k in map).map((k) => [k, map[k]])) : map);
  const out = [];
  for (let at = 0; at < keys.length; at += size) {
    const slice = keys.slice(at, at + size);
    out.push({ ...body, values: pick(body.values, slice), forms: pick(body.forms, slice), pluralArguments: pick(body.pluralArguments, slice) });
  }
  return out;
}

/**
 * Maps a key name from a local file to the locli key it belongs to.
 * @param {any[]} keys remote keys @param {string} platform
 */
function nameResolver(keys, platform) {
  const byName = new Map(keys.map((k) => [k.key, k]));
  /** @type {Map<string, any>} */
  const byExport = new Map();
  // Precedence: explicit identifier, then keys already on Android, then any key whose Android name matches.
  for (const key of keys) {
    const explicit = key.platformIdentifiers?.[platform];
    if (explicit) byExport.set(explicit, key);
  }
  if (platform === 'android') {
    const ordered = [...keys.filter((k) => k.platforms.includes('android')), ...keys.filter((k) => !k.platforms.includes('android'))];
    for (const key of ordered) {
      for (const name of [exportName(key, 'android'), androidName(key.key)]) if (!byExport.has(name)) byExport.set(name, key);
    }
  }
  return (/** @type {string} */ local) => byName.get(local) ?? byExport.get(local) ?? null;
}

/**
 * Builds the import requests for one target. iOS follows the Python CLI exactly; other
 * formats treat any shared or platform value as existing.
 * @param {import('../config.js').Target} target @param {import('../formats/model.js').LocalTexts} texts
 * @param {any} detail @param {Record<string, string>} localeIDs @param {string | null} branch
 */
export function planTarget(target, texts, detail, localeIDs, branch) {
  const platform = target.platform;
  const index = valueIndex(detail.translations);
  const resolve = nameResolver(detail.keys, platform);
  /** @type {{ localeCode: string, scope: string, body: any, count: number, newKeys: string[] }[]} */
  const imports = [];
  /** @type {{ key: string, localeCode: string, items: string[], create: boolean }[]} */
  const arrays = [];
  const warnings = [...texts.warnings];
  /** local key → remote key name */
  /** @type {Record<string, string>} */
  const names = {};
  for (const key of texts.keys) names[key] = resolve(key)?.key ?? key;
  const selectors = texts.pluralArguments ?? {};
  const newKeys = new Set();

  if (target.format === 'xcstrings') {
    const iosKeys = new Set(detail.keys.filter((k) => k.platforms.includes('ios')).map((k) => k.id));
    const keyNames = new Map(detail.keys.map((k) => [k.id, k.key]));
    // A shared value already supplies iOS; do not recreate a stale platform override.
    const existing = new Set(detail.translations
      .filter((v) => iosKeys.has(v.translationKeyID) && (v.platform === 'shared' || v.platform === 'ios'))
      .map((v) => `${keyNames.get(v.translationKeyID)}\u0000${v.localeID}`));
    const remoteNames = new Set(keyNames.values());
    for (const [code, entries] of Object.entries(texts.locales)) {
      for (const status of ['draft', 'translated']) {
        // Add missing entries only; editorial changes in locli always win.
        const pending = Object.entries(entries).filter(([key, entry]) => entry.status === status && !existing.has(`${key}\u0000${localeIDs[code]}`));
        if (!pending.length) continue;
        /** @type {Record<string, string>} */ const values = {};
        /** @type {Record<string, Record<string, string>>} */ const forms = {};
        for (const [key, entry] of pending) {
          if (entry.forms) forms[key] = entry.forms; else values[key] = entry.value;
          if (!remoteNames.has(key)) newKeys.add(key);
        }
        const pluralArguments = Object.fromEntries(Object.keys(forms).filter((k) => k in selectors).map((k) => [k, selectors[k]]));
        imports.push({ localeCode: code, scope: 'ios', count: pending.length, newKeys: pending.map(([k]) => k).filter((k) => !remoteNames.has(k)),
          body: { localeID: localeIDs[code], platform: 'ios', status, values, forms, pluralArguments, branch } });
      }
    }
    return { imports, arrays, names, warnings, newKeys: [...newKeys].sort(), assign: [] };
  }

  const assign = new Set();
  for (const [code, entries] of Object.entries(texts.locales)) {
    const localeID = localeIDs[code];
    /** @type {Record<'new' | 'shared', { values: Record<string, string>, forms: Record<string, Record<string, string>>, keys: string[] }>} */
    const groups = { new: { values: {}, forms: {}, keys: [] }, shared: { values: {}, forms: {}, keys: [] } };
    for (const [localKey, entry] of Object.entries(entries)) {
      const remote = resolve(localKey);
      const name = remote?.key ?? localKey;
      if (remote && !remote.platforms.includes(platform)) assign.add(remote.key);
      if (entry.items) {
        if (remote && remote.valueKind !== 'array') { warnings.push(`${localKey}: is a <string-array> locally but a text in locli; skipped`); continue; }
        if (remote && hasValue(index, remote.id, localeID, platform)) continue;
        arrays.push({ key: name, localeCode: code, items: entry.items, create: !remote });
        if (!remote) newKeys.add(name);
        continue;
      }
      if (remote?.valueKind === 'array') { warnings.push(`${localKey}: is a string array in locli but a text locally; skipped`); continue; }
      if (remote && hasValue(index, remote.id, localeID, platform)) continue;
      const group = remote ? groups.shared : groups.new;
      if (entry.forms) group.forms[name] = entry.forms; else group.values[name] = entry.value;
      group.keys.push(name);
      if (!remote) newKeys.add(name);
    }
    for (const [kind, group] of Object.entries(groups)) {
      if (!group.keys.length) continue;
      // New keys are created for this platform; missing languages of existing keys become shared values.
      const scope = kind === 'new' ? platform : 'shared';
      const pluralArguments = {};
      for (const name of Object.keys(group.forms)) {
        const local = Object.keys(names).find((k) => names[k] === name) ?? name;
        if (local in selectors) /** @type {any} */ (pluralArguments)[name] = selectors[local];
      }
      imports.push({ localeCode: code, scope, count: group.keys.length, newKeys: kind === 'new' ? group.keys : [],
        body: { localeID, platform: scope, status: 'translated', values: group.values, forms: group.forms, pluralArguments, branch } });
    }
  }
  return { imports, arrays, names, warnings, newKeys: [...newKeys].sort(), assign: [...assign].sort() };
}

/** @param {ReturnType<typeof valueIndex>} index @param {string} keyID @param {string} localeID @param {string} platform */
function hasValue(index, keyID, localeID, platform) {
  const scopes = index.get(keyID)?.get(localeID);
  return Boolean(scopes && (scopes.has('shared') || scopes.has(platform)));
}

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, branch?: string, dryRun?: boolean, target?: string }} flags
 */
export async function push(ctx, flags) {
  const { loaded, config, api } = openConfig(ctx, flags);
  const targets = selectTargets(config.targets, flags.target);
  // Read and validate every file before the first remote change.
  const local = targets.map((target) => {
    const texts = readTarget(loaded.dir, target, config.sourceLanguage);
    if (target.format === 'xcstrings' && normalizeLocale(texts.sourceLanguage ?? '') !== normalizeLocale(config.sourceLanguage)) {
      throw new LocliError(`Configured source language (${config.sourceLanguage}) differs from the local catalog (${texts.sourceLanguage}): ${target.path}`);
    }
    return { target, texts };
  });
  let syncKeys = /** @type {Set<string> | null} */ (new Set());
  for (const target of config.targets) {
    const found = local.find((l) => l.target === target);
    try {
      const texts = found?.texts ?? readTarget(loaded.dir, target, config.sourceLanguage);
      if (syncKeys) for (const key of texts.keys) syncKeys.add(key);
    } catch { syncKeys = null; }
  }

  const project = await requireProject(api, config.project);
  const detail = await projectDetail(api, project.id);
  if (normalizeLocale(detail.defaultLocale) !== normalizeLocale(config.sourceLanguage)) {
    throw new LocliError(`Remote project uses a different source language (${detail.defaultLocale}, locli.json says ${config.sourceLanguage})`);
  }
  const branch = flags.branch || currentBranch(loaded.dir, ctx.env);
  const platforms = targets.map((t) => t.platform);
  const missingPlatforms = platforms.filter((p) => !detail.platforms.includes(p));
  // Refuse new keys that are visible text before anything is written: they break areas, renames and review.
  const remoteNames = new Set(detail.keys.map((/** @type {any} */ k) => k.key));
  const textKeys = [...new Set(local.flatMap(({ texts }) => texts.keys.filter((key) => !remoteNames.has(key) && isTextKey(key))))];
  if (textKeys.length && !flags.allowTextKeys) {
    throw new LocliError(`${plural(textKeys.length, 'new key')} look${textKeys.length === 1 ? 's' : ''} like visible text, not an identifier: ${textKeys.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}${textKeys.length > 5 ? ' …' : ''}
Keys are stable lower_snake_case identifiers with a feature prefix, e.g. account_login or team_seats_used;
the text is the value. The prefix becomes the area in locli. Rename them in the app, then push again.
Apps whose catalog is keyed by text on purpose (e.g. SwiftUI Text("…")) can pass --allow-text-keys.`, 2);
  }
  const unconventional = [...new Set(local.flatMap(({ texts }) => texts.keys.filter((key) => !remoteNames.has(key) && !isTextKey(key) && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key))))];
  if (unconventional.length) ctx.warn(`${plural(unconventional.length, 'new key')} not in lower_snake_case (convention: feature prefix + words, e.g. account_login): ${unconventional.slice(0, 5).join(', ')}${unconventional.length > 5 ? ' …' : ''}`);
  if (!flags.dryRun) await ensurePlatforms(api, detail, platforms);
  const codes = [...new Set(local.flatMap((l) => Object.keys(l.texts.locales)))];
  const { ids: localeIDs, created: createdLocales } = await ensureLocales(api, detail, codes, { dryRun: flags.dryRun });

  const plans = local.map(({ target, texts }) => ({ target, texts, plan: planTarget(target, texts, detail, localeIDs, branch) }));
  for (const { plan, target } of plans) for (const w of plan.warnings) ctx.warn(`${describeTarget(target)}: ${w}`);

  // The glossary is checked on the files, before anything is uploaded: push never overwrites, so a
  // text that breaks the guide has to be fixed here, not after it is in locli.
  const guideState = await loadGuide(api, project.id);
  const localIssues = [];
  if (guideState?.guide.terms.length) {
    for (const { texts, plan } of plans) {
      const source = texts.locales[config.sourceLanguage] ?? {};
      for (const item of plan.imports) {
        if (normalizeLocale(item.localeCode) === normalizeLocale(config.sourceLanguage)) continue;
        const values = { ...(item.body.values ?? {}) };
        for (const [key, forms] of Object.entries(item.body.forms ?? {})) values[key] = Object.values(/** @type {Record<string, string>} */ (forms)).join(' ');
        for (const [key, text] of Object.entries(values)) {
          const from = source[key] ? [source[key].value, ...Object.values(source[key].forms ?? {})].join(' ') : '';
          for (const miss of glossaryMisses(from, String(text), item.localeCode, guideState.guide)) localIssues.push(`${key} (${item.localeCode}): ${miss.message}`);
        }
      }
    }
  }
  if (localIssues.length) {
    ctx.warn(`${plural(localIssues.length, 'text')} in your files break the translation guide's glossary:`);
    for (const issue of [...new Set(localIssues)].slice(0, 20)) ctx.warn(`  ${issue}`);
    ctx.warn(flags.dryRun ? 'Fix them in the files before pushing; push never overwrites a text once it is in locli.'
      : 'They are uploaded as they are; fix them in locli, or next time run push --dry-run first.');
  }

  // Where the keys are used decides how long their texts may be; a toolbar item has room for about 12
  // characters. Like the glossary, this is checked on the files before anything is uploaded.
  let usage = /** @type {ReturnType<typeof usageReport> | null} */ (null);
  try { usage = usageReport(loaded.dir, local, config.sourceLanguage); } catch { usage = null; }
  const uploading = new Set();
  for (const { plan } of plans) {
    const back = Object.fromEntries(Object.entries(plan.names).map(([from, to]) => [to, from]));
    for (const item of plan.imports) for (const name of [...Object.keys(item.body.values ?? {}), ...Object.keys(item.body.forms ?? {})]) uploading.add(`${back[name] ?? name}\u0000${item.localeCode}`);
  }
  const tooLong = (usage?.tooLong ?? []).filter((issue) => uploading.has(`${issue.key}\u0000${issue.locale}`));
  if (tooLong.length) {
    ctx.warn(`${plural(tooLong.length, 'text')} in your files ${tooLong.length === 1 ? 'is' : 'are'} longer than the place ${tooLong.length === 1 ? 'it is' : 'they are'} used in:`);
    for (const issue of tooLong.slice(0, 20)) ctx.warn(`  ${describeTooLong(issue)}`);
    ctx.warn('Shorten them, or make the layout wrap; locli context shows every key\'s role and budget.');
  }

  const summary = { project: config.project, projectID: project.id, branch, dryRun: Boolean(flags.dryRun), createdKeys: 0, addedValues: 0,
    newKeys: /** @type {string[]} */ ([]), createdLocales, enabledPlatforms: flags.dryRun ? [] : missingPlatforms, assigned: 0, comments: 0,
    feature: /** @type {any} */ (null), merged: /** @type {string[]} */ ([]), waiting: /** @type {number | null} */ (null), targets: /** @type {any[]} */ ([]),
    glossaryIssues: /** @type {number | null} */ (null), localGlossaryIssues: localIssues, tooLong };

  if (flags.dryRun) {
    ctx.out(`Dry run for ${config.project} on ${api.baseURL}${branch ? ` (branch ${branch})` : ''}; nothing is written.`);
    if (missingPlatforms.length) ctx.out(`Would enable platform: ${missingPlatforms.join(', ')}`);
    if (createdLocales.length) ctx.out(`Would create languages: ${createdLocales.join(', ')}`);
    for (const { target, plan } of plans) {
      const perLocale = {};
      for (const item of plan.imports) /** @type {any} */ (perLocale)[item.localeCode] = (/** @type {any} */ (perLocale)[item.localeCode] ?? 0) + item.count;
      for (const item of plan.arrays) /** @type {any} */ (perLocale)[item.localeCode] = (/** @type {any} */ (perLocale)[item.localeCode] ?? 0) + 1;
      const total = Object.values(perLocale).reduce((a, b) => a + /** @type {number} */ (b), 0);
      summary.addedValues += /** @type {number} */ (total);
      summary.newKeys.push(...plan.newKeys);
      summary.targets.push({ target: describeTarget(target), newKeys: plan.newKeys, values: perLocale, assign: plan.assign });
      const detailText = Object.entries(perLocale).map(([c, n]) => `${c}: ${n}`).join(', ');
      ctx.out(`${describeTarget(target)}: would create ${plural(plan.newKeys.length, 'key')} and add ${plural(/** @type {number} */ (total), 'text')}${detailText ? ` (${detailText})` : ''}${plan.assign.length ? `; assign ${platformOf(target)} to ${plural(plan.assign.length, 'existing key')}` : ''}.`);
      if (plan.newKeys.length) ctx.out(`  new keys: ${plan.newKeys.slice(0, 30).join(', ')}${plan.newKeys.length > 30 ? ' …' : ''}`);
    }
    const described = new Set(local.flatMap(({ texts }) => Object.keys(texts.comments)));
    const roles = (usage?.keys ?? []).filter((k) => summary.newKeys.includes(k.key) && !described.has(k.key) && autoComment(k));
    if (roles.length) {
      ctx.out(`Context from the code for ${plural(roles.length, 'new key')}:`);
      for (const k of roles.slice(0, 30)) ctx.out(`  ${k.key}: ${autoComment(k)} (${k.uses[0].file}:${k.uses[0].line})`);
    }
    return summary;
  }

  for (const { target, texts, plan } of plans) {
    let added = 0;
    for (const item of plan.imports) {
      for (const body of importBatches(item.body)) {
        const result = await api.post(`/api/projects/${project.id}/translations/import`, body);
        summary.createdKeys += result?.createdKeys ?? 0;
        if (result?.feature && typeof result.feature === 'object') summary.feature = result.feature;
      }
      added += item.count;
    }
    // String arrays cannot be created by the import endpoint: create the key, then import its items.
    const arrayKeys = new Map();
    for (const item of plan.arrays) {
      if (item.create && !arrayKeys.has(item.key)) {
        const created = await api.post(`/api/projects/${project.id}/keys`, { key: item.key, namespace: areaOf(item.key), comment: texts.comments[item.key] ?? null,
          platforms: ['android'], valueKind: 'array', ...(summary.feature?.id && summary.feature.status === 'open' ? { featureID: summary.feature.id } : {}) });
        arrayKeys.set(item.key, created);
        summary.createdKeys += 1;
      }
      await api.post(`/api/projects/${project.id}/translations/import`, { localeID: localeIDs[item.localeCode], platform: 'android', status: 'translated', values: { [item.key]: JSON.stringify(item.items) }, branch });
      added += 1;
    }
    summary.addedValues += added;
    summary.newKeys.push(...plan.newKeys);
    summary.targets.push({ target: describeTarget(target), newKeys: plan.newKeys, added });
  }

  if (branch) {
    if (syncKeys) {
      const names = new Set();
      for (const { plan } of plans) for (const key of Object.values(plan.names)) names.add(key);
      for (const key of syncKeys) if (!plans.some(({ plan }) => key in plan.names)) names.add(key);
      try {
        const synced = await api.post(`/api/projects/${project.id}/features/sync`, { branch, keys: [...names].sort() });
        if (synced?.feature && typeof synced.feature === 'object') summary.feature = synced.feature;
        summary.merged = (synced?.merged ?? []).map((/** @type {any} */ f) => f.title);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error; // server without features
      }
    } else {
      ctx.warn('Skipped the feature sync because another target in locli.json could not be read.');
    }
  }

  // Fill empty context from file comments and assign the platform to existing keys, never overwriting context edited in locli.
  const after = await projectDetail(api, project.id);
  const remoteKeys = new Map(after.keys.map((k) => [k.key, k]));
  /** @type {Map<string, { comment?: string, platforms?: Set<string> }>} */
  const patches = new Map();
  for (const { target, texts, plan } of plans) {
    for (const [localKey, comment] of Object.entries(texts.comments)) {
      const key = remoteKeys.get(plan.names[localKey] ?? localKey);
      if (!comment || comment === 'Imported' || !key || !['', 'Imported'].includes((key.comment ?? '').trim())) continue;
      patches.set(key.key, { ...patches.get(key.key), comment });
    }
    // Keys nobody described get their role from the code; a later push refreshes only that generated text.
    for (const context of usage?.keys ?? []) {
      const comment = autoComment(context);
      const key = remoteKeys.get(plan.names[context.key] ?? context.key);
      if (!comment || !key || texts.comments[context.key] || patches.get(key.key)?.comment) continue;
      const current = (key.comment ?? '').trim();
      if (current === comment || !(['', 'Imported'].includes(current) || isAutoComment(current))) continue;
      patches.set(key.key, { ...patches.get(key.key), comment });
    }
    if (target.format !== 'xcstrings') {
      for (const name of new Set(Object.values(plan.names))) {
        const key = remoteKeys.get(name);
        if (!key || key.platforms.includes(target.platform) || (key.valueKind === 'array' && target.platform !== 'android')) continue;
        const entry = patches.get(name) ?? {};
        entry.platforms = new Set([...(entry.platforms ?? key.platforms), target.platform]);
        patches.set(name, entry);
      }
    }
  }
  for (const [name, change] of patches) {
    const key = /** @type {any} */ (remoteKeys.get(name));
    await api.patch(`/api/projects/${project.id}/keys/${key.id}`, { key: key.key, namespace: key.namespace, comment: change.comment ?? key.comment ?? null,
      platforms: change.platforms ? [...change.platforms] : key.platforms });
    if (change.comment) summary.comments += 1;
    if (change.platforms) summary.assigned += 1;
  }

  try {
    const diff = await api.get(`/api/projects/${project.id}/releases/diff`);
    summary.waiting = Array.isArray(diff?.changes) ? diff.changes.length : null;
  } catch { summary.waiting = null; }

  if (createdLocales.length) ctx.out(`Created languages: ${createdLocales.join(', ')}`);
  if (summary.enabledPlatforms.length) ctx.out(`Enabled platform: ${summary.enabledPlatforms.join(', ')}`);
  if (summary.addedValues) {
    ctx.out(`Added ${plural(summary.addedValues, 'missing text')} (one per key and language) to ${config.project}; ${plural(summary.createdKeys, 'new key')}.`);
  } else {
    ctx.out(`Nothing new to push: locli already has every text in your files. Existing texts are never overwritten; change them in locli (${projectURL(api.baseURL, project.id)}).`);
  }
  if (summary.feature) {
    const stale = summary.feature.staleKeyIDs?.length ?? 0;
    ctx.out(`Feature "${summary.feature.title}" (${branch})${stale ? `; ${plural(stale, 'text')} no longer in the code` : ''}`);
  } else if (branch) ctx.out(`Branch: ${branch}`);
  for (const title of summary.merged) ctx.out(`Merged into ${branch}: feature "${title}"`);
  if (summary.assigned) ctx.out(`Assigned the platform to ${plural(summary.assigned, 'existing key')}.`);
  if (summary.comments) ctx.out(`Added context to ${plural(summary.comments, 'key')} from file comments and the code.`);
  const guide = flags.dryRun ? null : await loadGuide(api, project.id);
  summary.glossaryIssues = guide?.issues.length ?? null;
  if (guide?.issues.length && !localIssues.length) {
    ctx.warn(`${plural(guide.issues.length, 'text')} break the translation guide's glossary:`);
    for (const issue of guide.issues.slice(0, 10)) ctx.warn(`  ${issue.key} (${issue.locale}): ${issue.message}`);
    ctx.warn('Fix them in your files or in locli; locli guide lists all.');
  }
  if (summary.waiting) {
    ctx.out(`${plural(summary.waiting, 'key')} wait for a release — ask the project owner to approve it at ${releasesURL(api.baseURL, project.id)}`);
  } else if (summary.waiting === 0) ctx.out('Nothing waits for a release.');
  return summary;
}

/** @param {import('../config.js').Target} target */
function platformOf(target) { return target.platform; }
