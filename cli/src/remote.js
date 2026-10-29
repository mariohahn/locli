// Project lookups and setup against the locli API (project IDs in URLs, like the Python CLI).
import { ApiError } from './http.js';
import { LocliError, matchLocale, localeName } from './util.js';

/** Android resource name for a key (port of AndroidResources.name, without the hash fallback). @param {string} key */
export function androidName(key) {
  const mapped = key.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!mapped) return key;
  return /^[0-9]/.test(mapped) ? `key_${mapped}` : mapped;
}

/**
 * Identifier a key exports under on a platform.
 * @param {any} key remote key @param {string} platform
 */
export function exportName(key, platform) {
  const explicit = key.platformIdentifiers?.[platform];
  if (explicit) return explicit;
  if (platform === 'android' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key.key)) return androidName(key.key);
  return key.key;
}

/** @param {string} apiURL @param {string} projectID */
export function projectURL(apiURL, projectID) {
  return `${apiURL}/app/projects/?projectId=${encodeURIComponent(projectID)}`;
}

/** @param {string} apiURL @param {string} projectID */
export function releasesURL(apiURL, projectID) {
  return `${apiURL}/app/projects/releases/?projectId=${encodeURIComponent(projectID)}`;
}

/**
 * Finds the project by slug among the projects visible to the token.
 * @param {import('./http.js').Api} api @param {string} slug
 */
export async function findProject(api, slug) {
  const projects = await api.get('/api/projects');
  if (!Array.isArray(projects)) throw new LocliError('Invalid API response: projects must be a list');
  const matches = projects.filter((p) => p.slug === slug);
  if (matches.length > 1) throw new LocliError('Multiple projects use this slug');
  return matches[0] ?? null;
}

/** @param {import('./http.js').Api} api @param {string} slug */
export async function requireProject(api, slug) {
  const project = await findProject(api, slug);
  if (!project) {
    throw new LocliError(`Project "${slug}" not found on ${api.baseURL} (it does not exist or this account is not a member). Check "project" in locli.json, or run \`npx @locli/cli init\` to create it.`);
  }
  return project;
}

/**
 * @param {import('./http.js').Api} api @param {string} projectID
 * @returns {Promise<{ id: string, slug: string, name: string, defaultLocale: string, role?: string, platforms: string[],
 *   locales: { id: string, code: string, name: string, isBase: boolean }[], keys: any[], translations: any[], features: any[] }>}
 */
export async function projectDetail(api, projectID) {
  const detail = await api.get(`/api/projects/${projectID}`);
  for (const field of ['locales', 'keys', 'translations']) {
    if (!Array.isArray(detail?.[field])) throw new LocliError(`Invalid API response: ${field} must be a list`);
  }
  detail.features ??= [];
  detail.platforms ??= ['ios', 'android', 'web'];
  return detail;
}

/**
 * Index of existing values: keyID → localeID → scopes.
 * @param {any[]} translations
 */
export function valueIndex(translations) {
  /** @type {Map<string, Map<string, Map<string, any>>>} */
  const index = new Map();
  for (const value of translations) {
    let byLocale = index.get(value.translationKeyID);
    if (!byLocale) index.set(value.translationKeyID, (byLocale = new Map()));
    let scopes = byLocale.get(value.localeID);
    if (!scopes) byLocale.set(value.localeID, (scopes = new Map()));
    scopes.set(value.platform, value);
  }
  return index;
}

/**
 * Enables platforms on the project (owner only). Import rejects disabled platforms.
 * @param {import('./http.js').Api} api @param {any} detail @param {string[]} platforms
 * @returns {Promise<string[]>} the platforms that were enabled now
 */
export async function ensurePlatforms(api, detail, platforms) {
  const missing = [...new Set(platforms)].filter((p) => !detail.platforms.includes(p));
  if (!missing.length) return [];
  try {
    const updated = await api.patch(`/api/projects/${detail.id}`, { platforms: [...detail.platforms, ...missing] });
    detail.platforms = updated?.platforms ?? [...detail.platforms, ...missing];
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new LocliError(`The ${missing.join(', ')} platform is not enabled for project "${detail.slug}", and only a project owner can enable it. Ask the owner to enable it in the project settings (${api.baseURL}/app/projects/settings/?projectId=${detail.id}), then push again.`);
    }
    throw error;
  }
  return missing;
}

/**
 * Creates the locales the project lacks (matching codes case-insensitively).
 * @param {import('./http.js').Api} api @param {any} detail @param {string[]} codes
 * @returns {Promise<{ ids: Record<string, string>, created: string[] }>} local code → locale ID
 */
export async function ensureLocales(api, detail, codes, { dryRun = false } = {}) {
  /** @type {Record<string, string>} */
  const ids = {};
  const created = [];
  for (const code of codes) {
    const remote = matchLocale(detail.locales.map((/** @type {any} */ l) => l.code), code);
    if (remote) { ids[code] = detail.locales.find((/** @type {any} */ l) => l.code === remote).id; continue; }
    if (dryRun) { ids[code] = `(new ${code})`; created.push(code); continue; }
    const locale = await api.post(`/api/projects/${detail.id}/locales`, { code, name: localeName(code), isBase: false });
    detail.locales.push(locale);
    ids[code] = locale.id;
    created.push(code);
  }
  return { ids, created };
}

/**
 * Release name for pull: explicit name, the latest approved one, or null for the working state.
 * @param {import('./http.js').Api} api @param {any} project @param {{ draft?: boolean, release?: string }} options
 */
export async function resolveRelease(api, project, { draft, release }) {
  if (draft) return null;
  if (release && release !== 'latest') return release;
  const releases = await api.get(`/api/projects/${project.id}/releases`);
  if (!Array.isArray(releases) || !releases.length) {
    throw new LocliError(`No release yet. Ask the project owner to approve one in locli (${releasesURL(api.baseURL, project.id)}), or run \`npx @locli/cli pull --draft\` for the unapproved working state (local checks only).`);
  }
  return releases[0].name;
}

/** @param {string | null} release */
export function releaseQuery(release) {
  return release ? `release=${encodeURIComponent(release)}` : '';
}
