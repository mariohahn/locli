import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { login, logout, whoami } from '../src/commands/login.js';
import { credentialsFile } from '../src/credentials.js';
import { tempDir, testContext, fakeServer, TOKEN } from './helpers.js';

test('device login polls through pending and slow_down, stores the token with 0600', async () => {
  const server = await fakeServer({ device: { steps: [428, 429, 428, 200] } });
  try {
    const env = { XDG_CONFIG_HOME: tempDir(), PATH: process.env.PATH };
    const sleeps = [];
    const opened = [];
    const ctx = testContext({ cwd: tempDir(), env, sleep: async (ms) => { sleeps.push(ms); }, openBrowser: (url) => opened.push(url) });
    const result = await login(ctx, { apiUrl: server.url });
    assert.equal(result.email, 'dev@example.com');
    assert.deepEqual(sleeps, [1000, 1000, 6000, 6000], 'slow_down adds 5 seconds');
    assert.deepEqual(opened, ['http://localhost/app/device?code=ABCD-EFGH']);
    assert.ok(ctx.infos.some((l) => l.includes('ABCD-EFGH')) && ctx.infos.some((l) => l.includes('/app/device')));
    assert.ok(!ctx.output.join('\n').includes(TOKEN) && !ctx.infos.join('\n').includes(TOKEN), 'token is never printed');
    const file = credentialsFile(env);
    assert.equal(file, path.join(env.XDG_CONFIG_HOME, 'locli', 'credentials.json'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { [server.url]: { token: TOKEN, tokenID: 'token-id-1', email: 'dev@example.com' } });
    assert.deepEqual(server.calls('POST', '/api/auth/device')[0].body.clientName.startsWith('locli CLI'), true);

    const me = await whoami(testContext({ cwd: tempDir(), env }), { apiUrl: server.url });
    assert.equal(me.email, 'dev@example.com');

    await logout(testContext({ cwd: tempDir(), env }), { apiUrl: server.url });
    assert.deepEqual(server.state.revoked, ['token-id-1']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  } finally { await server.close(); }
});

test('device login reports denial and expiry; --no-browser and CI skip the browser', async () => {
  for (const [step, message] of [[403, /denied/], [410, /expired/]]) {
    const server = await fakeServer({ device: { steps: [428, step] } });
    try {
      const opened = [];
      const ctx = testContext({ cwd: tempDir(), env: { XDG_CONFIG_HOME: tempDir(), CI: step === 410 ? 'true' : '' }, openBrowser: (url) => opened.push(url) });
      await assert.rejects(login(ctx, { apiUrl: server.url, browser: step === 410 }), message);
      assert.deepEqual(opened, []);
    } finally { await server.close(); }
  }
});

test('whoami without a token gives the login instruction', async () => {
  await assert.rejects(whoami(testContext({ cwd: tempDir(), env: { XDG_CONFIG_HOME: tempDir() } }), { apiUrl: 'http://127.0.0.1:9' }), /Not logged in\. Ask the user to run `npx @locli\/cli login`/);
});
