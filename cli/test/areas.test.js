import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areas } from '../src/commands/areas.js';
import { callTool } from '../src/mcp.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const seed = { slug: 'app', defaultLocale: 'en', locales: ['en'], keys: [
  { key: 'auth_title' }, { key: 'auth_password_label' }, { key: 'paywall_title' }, { key: 'account.logout' },
] };

function project(server) {
  const root = tempDir();
  writeFiles(root, { 'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'ios', format: 'xcstrings', path: 'App/Localizable.xcstrings' }] } });
  return { root, ctx: testContext({ cwd: root, env: testEnv(server.url) }) };
}

test('areas groups keys by their first segment, dotted or snake_case', async () => {
  const server = await fakeServer(seed);
  try {
    const { ctx } = project(server);
    const result = await areas(ctx, {});
    assert.deepEqual(result.areas.map((a) => [a.area, a.keys]), [['account', 1], ['auth', 2], ['paywall', 1]]);
  } finally { await server.close(); }
});

test('a feature finds its existing area by name or synonym, or proposes a new one', async () => {
  const server = await fakeServer(seed);
  try {
    const { ctx, root } = project(server);
    const login = (await areas(ctx, { feature: 'Login' })).suggestion;
    // "login" has no area of its own; auth (2 keys) wins over account (1 key).
    assert.equal(login.area, 'auth');
    assert.equal(login.exists, true);
    assert.match(ctx.output.join('\n'), /Use the existing area "auth" \(2 keys\): name new keys auth_<element>/);
    const paywall = (await areas(ctx, { feature: 'paywall' })).suggestion;
    assert.deepEqual([paywall.area, paywall.matchedBy], ['paywall', 'name']);
    const receipts = (await areas(ctx, { feature: 'receipt import' })).suggestion;
    assert.deepEqual([receipts.area, receipts.exists], ['receipt', false]);
    const tool = await callTool('locli_areas', { feature: 'sign in' }, { cwd: root, env: testEnv(server.url) });
    assert.equal(JSON.parse(tool.content[0].text).suggestion.area, 'auth');
  } finally { await server.close(); }
});
