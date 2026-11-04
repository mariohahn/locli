import { snakeName } from '../src/commands/keys.js';
// Test helpers: temp dirs, a capturing context and a fake locli server (node:http) that
// implements the endpoints the CLI uses with the server's add-only import semantics.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createContext } from '../src/context.js';

export function tempDir(prefix = 'locli-test-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** @param {string} root @param {Record<string, string | object>} files */
export function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
}

/** @param {Partial<import('../src/context.js').Context>} overrides */
export function testContext(overrides = {}) {
  const out = [];
  const info = [];
  const warnings = [];
  const ctx = createContext({
    out: (l) => out.push(l), info: (l) => info.push(l), warn: (l) => warnings.push(l),
    sleep: async () => {}, interactive: false, openBrowser: () => {}, ...overrides,
  });
  return Object.assign(ctx, { output: out, infos: info, warnings });
}

export const TOKEN = 'lcz_test_token';

/**
 * @param {{ slug?: string, defaultLocale?: string, platforms?: string[], locales?: string[], keys?: any[], values?: any[],
 *   releases?: string[], exports?: Record<string, any>, device?: { steps: number[] }, guide?: any, issues?: any[], community?: any, suggestions?: any[] }} [seed]
 */
export async function fakeServer(seed = {}) {
  const state = {
    requests: /** @type {{ method: string, path: string, body: any, auth: string | undefined }[]} */ ([]),
    projects: /** @type {any[]} */ ([]),
    locales: /** @type {any[]} */ ([]),
    keys: /** @type {any[]} */ ([]),
    values: /** @type {any[]} */ ([]),
    features: /** @type {any[]} */ ([]),
    releases: (seed.releases ?? []).map((name) => ({ id: randomUUID(), name })),
    exports: seed.exports ?? {},
    device: seed.device ?? { steps: [200] },
    deviceCalls: 0,
    revoked: /** @type {string[]} */ ([]),
    guide: seed.guide ?? null,
    issues: seed.issues ?? [],
    community: seed.community ?? { enabled: false, locales: [], path: `/c/${seed.slug ?? 'app'}`, openSuggestions: 0 },
    suggestions: seed.suggestions ?? [],
  };
  if (seed.slug) {
    const project = { id: randomUUID(), name: seed.slug, slug: seed.slug, defaultLocale: seed.defaultLocale ?? 'en', platforms: seed.platforms ?? ['ios', 'android', 'web'] };
    state.projects.push(project);
    for (const code of seed.locales ?? [project.defaultLocale]) state.locales.push({ id: randomUUID(), code, name: code, isBase: code === project.defaultLocale });
    for (const key of seed.keys ?? []) state.keys.push({ id: randomUUID(), namespace: key.key.split('.')[0], comment: 'Imported', platforms: ['ios'], plural: null, platformIdentifiers: {}, valueKind: 'text', featureID: null, ...key });
    for (const value of seed.values ?? []) {
      const key = state.keys.find((k) => k.key === value.key);
      const locale = state.locales.find((l) => l.code === value.locale);
      state.values.push({ id: randomUUID(), translationKeyID: key.id, localeID: locale.id, platform: value.platform ?? 'shared', value: value.value, status: 'translated', forms: value.forms ?? null, items: value.items ?? null });
    }
  }
  const project = () => state.projects[0];
  const detail = (p) => ({ ...p, role: 'owner', stores: [], locales: state.locales, keys: state.keys, translations: state.values, features: state.features });

  /** @param {any} body */
  function importValues(p, body) {
    if (body.platform !== 'shared' && !p.platforms.includes(body.platform)) return [400, { error: true, reason: 'Enable this platform in project settings first.' }];
    const entries = Object.entries(body.values ?? {}).map(([k, v]) => [k, v, null]);
    for (const [k, forms] of Object.entries(body.forms ?? {})) entries.push([k, forms.other, forms]);
    let createdKeys = 0;
    let feature = null;
    const branch = body.branch && !['main', 'master'].includes(body.branch) ? body.branch : null;
    for (const [name, text, forms] of entries) {
      let key = state.keys.find((k) => k.key === name);
      if (!key) {
        if (branch) {
          feature = state.features.find((f) => f.branch === branch);
          if (!feature) { feature = { id: randomUUID(), branch, title: branch.split('/').pop(), status: 'open', staleKeyIDs: [] }; state.features.push(feature); }
        }
        key = { id: randomUUID(), key: name, namespace: name.split('.')[0], comment: 'Imported', platforms: body.platform === 'shared' ? [...p.platforms] : [body.platform], plural: null, platformIdentifiers: {}, valueKind: 'text', featureID: feature?.id ?? null };
        state.keys.push(key);
        createdKeys += 1;
      }
      if (body.platform !== 'shared' && !key.platforms.includes(body.platform)) key.platforms.push(body.platform);
      if (forms && !key.plural) key.plural = { argument: body.pluralArguments?.[name] ?? 1 };
      const scope = body.platform === 'shared' || key.platforms.length === 1 ? 'shared' : body.platform;
      let value = state.values.find((v) => v.translationKeyID === key.id && v.localeID === body.localeID && v.platform === scope);
      const items = key.valueKind === 'array' ? JSON.parse(text) : null;
      if (!value) { value = { id: randomUUID(), translationKeyID: key.id, localeID: body.localeID, platform: scope }; state.values.push(value); }
      Object.assign(value, { value: text, status: body.status ?? 'translated', forms: forms ?? null, items });
    }
    return [200, { createdKeys, upsertedTranslations: entries.length, feature }];
  }

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url ?? '/', 'http://x');
    state.requests.push({ method: req.method ?? '', path: url.pathname + url.search, body, auth: req.headers.authorization });
    const send = (/** @type {number} */ status, /** @type {any} */ payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };
    const route = `${req.method} ${url.pathname}`;
    // Public device flow.
    if (route === 'POST /api/auth/device') return send(200, { deviceCode: 'lcd_device', userCode: 'ABCD-EFGH', verificationURL: `http://localhost/app/device?code=ABCD-EFGH`, expiresIn: 600, interval: 1 });
    if (route === 'POST /api/auth/device/token') {
      const step = state.device.steps[Math.min(state.deviceCalls++, state.device.steps.length - 1)];
      const reasons = { 428: 'authorization_pending', 429: 'slow_down', 410: 'expired_token', 403: 'access_denied' };
      if (step !== 200) return send(step, { error: true, reason: reasons[/** @type {keyof typeof reasons} */ (step)] });
      return send(200, { token: TOKEN, details: { id: 'token-id-1', name: 'locli CLI', scope: 'write', projectID: null, lastUsedAt: null, createdAt: null } });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: true, reason: 'Unauthorized' });
    if (route === 'GET /api/me') return send(200, { user: { email: 'dev@example.com', name: 'Dev' }, via: 'token' });
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/me/tokens/')) { state.revoked.push(url.pathname.split('/').pop() ?? ''); return send(204); }
    if (route === 'GET /api/projects') return send(200, state.projects.map((p) => ({ ...p, role: 'owner' })));
    if (route === 'POST /api/projects') {
      const p = { id: randomUUID(), name: body.name, slug: body.slug, defaultLocale: body.defaultLocale, platforms: ['ios', 'android', 'web'] };
      state.projects.push(p);
      state.locales.push({ id: randomUUID(), code: body.defaultLocale, name: body.defaultLocale, isBase: true });
      return send(200, p);
    }
    const match = /^\/api\/projects\/([^/]+)(\/.*)?$/.exec(url.pathname);
    const p = project();
    if (!match || !p || match[1] !== p.id) return send(404, { error: true, reason: 'Project not found.' });
    const sub = `${req.method} ${match[2] ?? ''}`;
    if (sub === 'GET ') return send(200, detail(p));
    if (sub === 'PATCH ') { if (body.platforms) p.platforms = body.platforms; if (body.icon !== undefined) { p.iconData = body.icon || null; p.iconURL = body.icon ? `/api/projects/${p.id}/icon?v=${body.icon.length}` : null; } return send(200, { ...p, role: 'owner' }); }
    if (sub === 'POST /locales') { const l = { id: randomUUID(), code: body.code.toLowerCase(), name: body.name, isBase: false }; state.locales.push(l); return send(200, l); }
    if (sub === 'POST /translations/import') { const [status, payload] = importValues(p, body); return send(status, payload); }
    if (sub === 'POST /keys') {
      const key = { id: randomUUID(), key: body.key, namespace: body.namespace, comment: body.comment, platforms: body.platforms, plural: null, platformIdentifiers: {}, valueKind: body.valueKind ?? 'text', featureID: body.featureID ?? null };
      state.keys.push(key);
      return send(200, key);
    }
    const keyMatch = /^PATCH \/keys\/(.+)$/.exec(sub);
    if (keyMatch) {
      const key = state.keys.find((k) => k.id === keyMatch[1]);
      if (!key) return send(404, { error: true, reason: 'not found' });
      Object.assign(key, { key: body.key, namespace: body.namespace, comment: body.comment, platforms: body.platforms ?? key.platforms });
      return send(200, key);
    }
    if (sub === 'POST /features/sync') return send(200, { feature: state.features.find((f) => f.branch === body.branch) ?? null, merged: [] });
    if (sub === 'GET /guide') return state.guide ? send(200, state.guide) : send(404, { error: true, reason: 'no route' });
    if (sub === 'GET /guide/issues') return state.guide ? send(200, state.issues) : send(404, { error: true, reason: 'no route' });
    if (sub === 'PUT /guide') { state.guide = body; return send(200, body); }
    if (sub === 'POST /keys/delete') {
      // Like the server: keys with `released: 'NAME'` are refused, all or nothing.
      const plan = { deleted: [], released: [], missing: [], applied: false };
      for (const name of [...new Set(body.keys)].sort()) {
        const key = state.keys.find((k) => k.key === name);
        if (!key) plan.missing.push(name);
        else if (key.released) plan.released.push({ key: name, release: key.released });
        else plan.deleted.push({ key: name, platforms: key.platforms, values: state.values.filter((v) => v.translationKeyID === key.id).length });
      }
      if (body.apply && plan.released.length) return send(409, { error: true, reason: 'Released keys can\'t be deleted from the CLI.' });
      if (body.apply) {
        const names = new Set(plan.deleted.map((d) => d.key));
        state.keys = state.keys.filter((k) => !names.has(k.key));
        plan.applied = true;
      }
      return send(200, plan);
    }
    if (sub === 'POST /keys/normalize') {
      // Like the server: dotted iOS/Android identifiers → snake_case, merged into an existing key (no conflict or camel-twin logic here).
      const plan = { renamed: [], merged: [], conflicts: [], applied: Boolean(body?.apply) };
      for (const key of [...state.keys].sort((a, b) => a.key.localeCompare(b.key))) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(key.key) || !key.platforms.some((p) => p === 'ios' || p === 'android')) continue;
        const to = snakeName(key.key);
        const target = state.keys.find((k) => k.key === to);
        if (target) {
          plan.merged.push({ from: key.key, into: to, platforms: key.platforms });
          if (body?.apply) { target.platforms = [...new Set([...target.platforms, ...key.platforms])]; state.keys = state.keys.filter((k) => k !== key); }
        } else {
          plan.renamed.push({ from: key.key, to, platforms: key.platforms });
          if (body?.apply) key.key = to;
        }
      }
      return send(200, plan);
    }
    if (sub === 'GET /community') return send(200, state.community);
    if (sub === 'GET /community/suggestions') {
      const status = url.searchParams.get('status') ?? 'open';
      const locale = url.searchParams.get('locale');
      return send(200, state.suggestions.filter((s) => s.status === status && (!locale || s.locale === locale)));
    }
    const reviewMatch = /^POST \/community\/suggestions\/([^/]+)\/(accept|reject)$/.exec(sub);
    if (reviewMatch) {
      const suggestion = state.suggestions.find((s) => s.id === reviewMatch[1]);
      if (!suggestion) return send(404, { error: true, reason: 'Suggestion not found.' });
      suggestion.status = reviewMatch[2] === 'accept' ? 'accepted' : body?.hide ? 'hidden' : 'rejected';
      return reviewMatch[2] === 'accept' ? send(200, { id: randomUUID(), value: suggestion.text }) : send(204);
    }
    if (sub === 'GET /releases') return send(200, [...state.releases].reverse());
    if (sub === 'GET /releases/diff') return send(200, { latest: state.releases.at(-1) ?? null, changes: state.keys.map((k) => ({ key: k.key })), missing: [], placeholderErrors: [], reviews: [] });
    const exportMatch = /^GET \/(export|resolved)\/(\w+)$/.exec(sub);
    if (exportMatch) {
      const release = url.searchParams.get('release');
      if (release && !state.releases.some((r) => r.name === release)) return send(404, { error: true, reason: `Release ${release} not found.` });
      const payload = state.exports[`${exportMatch[1]}/${exportMatch[2]}`];
      return payload === undefined ? send(404, { error: true, reason: 'no fixture' }) : send(200, payload);
    }
    return send(404, { error: true, reason: `no route ${route}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    project,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    /** @param {string} method @param {string} prefix */
    calls: (method, prefix) => state.requests.filter((r) => r.method === method && r.path.includes(prefix)),
  };
}

/** Env for commands: isolated config dir and an explicit token. */
export function testEnv(apiURL, extra = {}) {
  return { XDG_CONFIG_HOME: tempDir('locli-config-'), LOCLI_API_URL: apiURL, LOCLI_TOKEN: TOKEN, LOCLI_BRANCH: 'feature/receipts', PATH: process.env.PATH, ...extra };
}
