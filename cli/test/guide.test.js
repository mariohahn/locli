import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guide } from '../src/commands/guide.js';
import { status } from '../src/commands/status.js';
import { callTool } from '../src/mcp.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const seed = {
  slug: 'app', defaultLocale: 'de', locales: ['de', 'en'],
  guide: { tone: { de: 'du, freundlich' }, terms: [{ term: 'Pro', keep: true, translations: {} }, { term: 'Freigabe', keep: false, translations: { en: 'release' } }] },
  issues: [{ key: 'plan_upgrade', locale: 'en', platform: 'shared', term: 'Pro', expected: 'Pro', message: '“Pro” must stay “Pro”.' }],
};

function project(server) {
  const root = tempDir();
  writeFiles(root, { 'locli.json': { project: 'app', sourceLanguage: 'de', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] } });
  return { root, ctx: testContext({ cwd: root, env: testEnv(server.url) }) };
}

test('guide prints tone, glossary rules and the texts that break them', async () => {
  const server = await fakeServer(seed);
  try {
    const { ctx } = project(server);
    await guide(ctx, {});
    const out = ctx.output.join('\n');
    assert.match(out, /de {5}du, freundlich/);
    assert.match(out, /Pro +keep as written/);
    assert.match(out, /Freigabe +en: release/);
    assert.match(out, /1 glossary issue:\n {2}plan_upgrade \(en\): “Pro” must stay “Pro”\./);
  } finally { await server.close(); }
});

test('guide --set replaces the guide from a file, also from --json output', async () => {
  const server = await fakeServer(seed);
  try {
    const { root, ctx } = project(server);
    writeFiles(root, { 'guide.json': { guide: { tone: { en: 'friendly' }, terms: [{ term: 'locli', keep: true }] }, issues: [] } });
    await guide(ctx, { set: 'guide.json' });
    assert.deepEqual(server.calls('PUT', '/guide')[0].body, { tone: { en: 'friendly' }, terms: [{ term: 'locli', keep: true }] });
    assert.match(ctx.output.join('\n'), /Saved the translation guide of app\./);
  } finally { await server.close(); }
});

test('status and the MCP tool report the guide; servers without a guide are fine', async () => {
  const server = await fakeServer(seed);
  try {
    const { ctx, root } = project(server);
    const result = await status(ctx, {});
    assert.deepEqual(result.glossary, { terms: 2, tone: ['de'], issues: 1, firstIssues: seed.issues });
    assert.match(ctx.output.join('\n'), /Translation guide: 2 glossary terms, tone for de; 1 text break the glossary/);
    const tool = await callTool('locli_guide', {}, { cwd: root, env: testEnv(server.url) });
    assert.equal(tool.isError, false);
    assert.equal(JSON.parse(tool.content[0].text).guide.tone.de, 'du, freundlich');
  } finally { await server.close(); }
  const old = await fakeServer({ slug: 'app', defaultLocale: 'de', locales: ['de'] });
  try {
    const { ctx } = project(old);
    assert.equal((await status(ctx, {})).glossary, null);
  } finally { await old.close(); }
});

test('push --dry-run checks the files against the glossary before anything is uploaded', async () => {
  const server = await fakeServer({ slug: 'app', defaultLocale: 'en', locales: ['en', 'de'],
    guide: { tone: {}, terms: [{ term: 'sign in', keep: false, translations: { de: 'anmelden | melde dich an' } }, { term: 'Shoply', keep: true, translations: {} }] }, issues: [] });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] },
      'messages/en.json': { auth_banner: 'Sign in to sync your Shoply orders', auth_hint: 'Please sign in', auth_cta: 'Sign in' },
      'messages/de.json': { auth_banner: 'Melde dich an, um deine Shoply-Bestellungen zu synchronisieren', auth_hint: 'Bitte einloggen', auth_cta: 'Zu shoply' },
    });
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    const { push } = await import('../src/commands/push.js');
    const summary = await push(ctx, { dryRun: true });
    // The separable "melde dich an" is an accepted form; "einloggen" and a missing "anmelden" are not.
    assert.deepEqual(summary.localGlossaryIssues.sort(), ['auth_cta (de): “sign in” should be “anmelden” or “melde dich an”.', 'auth_hint (de): “sign in” should be “anmelden” or “melde dich an”.']);
    assert.match(ctx.warnings.join('\n'), /Fix them in the files before pushing/);
    assert.equal(server.calls('POST', '/translations/import').length, 0);
  } finally { await server.close(); }
});
