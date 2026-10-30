// status: project, languages, missing texts per language, open features, unreleased changes.
import { openConfig } from '../context.js';
import { requireProject, projectDetail, valueIndex, releasesURL, projectURL } from '../remote.js';
import { plural } from '../util.js';
import { loadGuide } from './guide.js';

/**
 * @param {import('../context.js').Context} ctx
 * @param {{ config?: string, apiUrl?: string, json?: boolean }} flags
 */
export async function status(ctx, flags) {
  const { config, api } = openConfig(ctx, flags);
  const project = await requireProject(api, config.project);
  const detail = await projectDetail(api, project.id);
  const index = valueIndex(detail.translations);
  const appKeys = detail.keys.filter((k) => !k.storeField && k.platforms.length);
  const locales = detail.locales.map((locale) => {
    const missing = appKeys.filter((key) => {
      const scopes = index.get(key.id)?.get(locale.id);
      return !scopes || !(scopes.has('shared') || key.platforms.some((/** @type {string} */ p) => scopes.has(p)));
    }).map((k) => k.key);
    return { code: locale.code, name: locale.name, isBase: locale.isBase, missing: missing.length, missingKeys: missing.slice(0, 20) };
  });
  const featureKeys = new Map();
  for (const key of detail.keys) if (key.featureID) featureKeys.set(key.featureID, (featureKeys.get(key.featureID) ?? 0) + 1);
  const features = detail.features.filter((f) => f.status === 'open')
    .map((f) => ({ title: f.title, branch: f.branch, keys: featureKeys.get(f.id) ?? 0, staleKeys: f.staleKeyIDs?.length ?? 0 }));
  /** @type {{ latest: string | null, changedKeys: number, pendingReviews: number, placeholderErrors: number } | null} */
  let release = null;
  try {
    const diff = await api.get(`/api/projects/${project.id}/releases/diff`);
    release = {
      latest: diff?.latest?.name ?? null,
      changedKeys: diff?.changes?.length ?? 0,
      pendingReviews: (diff?.reviews ?? []).filter((/** @type {any} */ r) => r.review?.decision !== 'approved').length,
      placeholderErrors: diff?.placeholderErrors?.length ?? 0,
    };
  } catch { /* older server or missing permission */ }
  const guide = await loadGuide(api, project.id);
  const glossary = guide ? { terms: guide.guide.terms.length, tone: Object.keys(guide.guide.tone), issues: guide.issues.length, firstIssues: guide.issues.slice(0, 10) } : null;
  const result = {
    apiURL: api.baseURL, project: detail.slug, name: detail.name, projectID: detail.id, role: detail.role ?? null,
    sourceLanguage: detail.defaultLocale, platforms: detail.platforms, keys: appKeys.length,
    targets: config.targets.map((t) => `${t.platform}:${t.format}:${t.path}`),
    locales, openFeatures: features, release, glossary,
    unreleasedChanges: release ? release.changedKeys > 0 : null,
    url: projectURL(api.baseURL, detail.id), releaseURL: releasesURL(api.baseURL, detail.id),
  };
  if (flags.json) { ctx.out(JSON.stringify(result, null, 2)); return result; }
  ctx.out(`${detail.name} (${detail.slug}) on ${api.baseURL}${detail.role ? `, role ${detail.role}` : ''}`);
  ctx.out(`Platforms: ${detail.platforms.join(', ')}; ${plural(appKeys.length, 'key')}; source language ${detail.defaultLocale}`);
  for (const locale of locales) ctx.out(`  ${locale.code.padEnd(8)} ${locale.missing ? `${locale.missing} missing` : 'complete'}${locale.isBase ? ' (source)' : ''}`);
  if (features.length) {
    ctx.out('Open features:');
    for (const f of features) ctx.out(`  ${f.title} (${f.branch}): ${plural(f.keys, 'key')}${f.staleKeys ? `, ${f.staleKeys} no longer in the code` : ''}`);
  }
  if (glossary && (glossary.terms || glossary.tone.length)) {
    ctx.out(`Translation guide: ${plural(glossary.terms, 'glossary term')}${glossary.tone.length ? `, tone for ${glossary.tone.join(', ')}` : ''}; ${glossary.issues ? `${plural(glossary.issues, 'text')} break the glossary (locli guide lists them)` : 'every translation follows it'}.`);
  }
  if (release) {
    ctx.out(release.changedKeys
      ? `${plural(release.changedKeys, 'key')} changed since ${release.latest ? `release ${release.latest}` : 'the start (no release yet)'}; ${plural(release.pendingReviews, 'text')} (key × language) awaiting review${release.placeholderErrors ? `, ${release.placeholderErrors} placeholder errors block the release` : ''}. Release page: ${result.releaseURL}`
      : `No unreleased changes${release.latest ? ` (latest release ${release.latest})` : ''}.`);
  }
  return result;
}
