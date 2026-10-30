import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { tempDir, writeFiles, fakeServer, testEnv } from './helpers.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/locli.js');

/** Spawns `locli mcp` and returns a request function. */
function startMcp(cwd, env) {
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const lines = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  let next = 1;
  return {
    child,
    lines,
    request(method, params) {
      const id = next++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    notify(method) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    close() { child.stdin.end(); return new Promise((resolve) => child.on('close', resolve)); },
  };
}

test('MCP server: initialize, tools/list and tools/call over stdio', async () => {
  const server = await fakeServer({
    slug: 'app', defaultLocale: 'en', locales: ['en', 'de'],
    keys: [{ key: 'account_login', platforms: ['web'], comment: 'Login button' }],
    values: [{ key: 'account_login', locale: 'en', value: 'Sign in' }, { key: 'account_login', locale: 'de', value: 'Anmelden' }],
  });
  const root = tempDir();
  writeFiles(root, { 'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] }, 'messages/en.json': { account_login: 'Sign in' } });
  const mcp = startMcp(root, testEnv(server.url));
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'locli');
    assert.ok(init.result.capabilities.tools);
    mcp.notify('notifications/initialized');
    assert.deepEqual((await mcp.request('ping', {})).result, {});

    const list = await mcp.request('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['locli_status', 'locli_areas', 'locli_guide', 'locli_context', 'locli_find_texts', 'locli_add_texts', 'locli_push', 'locli_pull']);
    for (const tool of list.result.tools) assert.equal(tool.inputSchema.type, 'object');

    const found = await mcp.request('tools/call', { name: 'locli_find_texts', arguments: { query: 'sign in' } });
    assert.equal(found.result.isError, false);
    assert.match(found.result.content[0].text, /account_login \[web\] — Login button/);
    assert.match(found.result.content[0].text, /de: Anmelden/);

    const status = await mcp.request('tools/call', { name: 'locli_status', arguments: {} });
    const parsed = JSON.parse(status.result.content[0].text);
    assert.equal(parsed.project, 'app');
    assert.deepEqual(parsed.locales.map((l) => [l.code, l.missing]), [['en', 0], ['de', 0]]);

    const added = await mcp.request('tools/call', { name: 'locli_add_texts', arguments: { texts: [
      { key: 'account_login', comment: 'x', values: { en: 'Log in', fr: 'Connexion' } },
      { key: 'cart.count', comment: 'Cart badge', forms: { en: { one: '%lld item', other: '%lld items' } } },
    ] } });
    assert.equal(added.result.isError, false, added.result.content[0].text);
    assert.match(added.result.content[0].text, /Skipped 1 existing text .*account_login \(en\)/);
    assert.match(added.result.content[0].text, /lower_snake_case/);
    assert.equal(server.state.values.find((v) => v.value === 'Sign in').value, 'Sign in', 'never overwritten');
    assert.ok(server.state.values.some((v) => v.value === 'Connexion'));
    const cart = server.state.keys.find((k) => k.key === 'cart.count');
    assert.equal(cart.comment, 'Cart badge');
    assert.deepEqual(cart.platforms, ['web']);

    const push = await mcp.request('tools/call', { name: 'locli_push', arguments: { dryRun: true } });
    assert.equal(push.result.isError, false);
    assert.match(push.result.content[0].text, /Dry run/);

    const unknown = await mcp.request('nope', {});
    assert.equal(unknown.error.code, -32601);
    for (const line of mcp.lines) assert.doesNotThrow(() => JSON.parse(line), 'stdout carries only JSON-RPC');
  } finally {
    await mcp.close();
    await server.close();
  }
});

test('MCP tools report "not logged in" as an actionable tool error', async () => {
  const root = tempDir();
  writeFiles(root, { 'locli.json': { project: 'app', sourceLanguage: 'en', targets: [] } });
  const mcp = startMcp(root, { PATH: process.env.PATH, XDG_CONFIG_HOME: tempDir(), LOCLI_API_URL: 'http://127.0.0.1:9' });
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const result = await mcp.request('tools/call', { name: 'locli_status', arguments: {} });
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, /Not logged in\. Ask the user to run `npx @locli\/cli login`/);
  } finally { await mcp.close(); }
});
