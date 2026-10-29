import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { parseTargetSpec, resolveApiURL } from '../src/config.js';
import { tempDir } from './helpers.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/locli.js');
const run = (/** @type {string[]} */ args, cwd = tempDir()) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, XDG_CONFIG_HOME: tempDir() } });

test('help, version and exit codes', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run(['--version']).stdout.trim(), pkg.version);
  assert.match(run(['--help']).stdout, /Commands:[\s\S]*push[\s\S]*mcp/);
  assert.match(run(['pull', '--help']).stdout, /--draft/);
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['push', '--nope']).status, 2);
  const missing = run(['push']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No locli\.json found\. Run `npx @locli\/cli init`/);
  assert.equal(missing.stdout, '');
});

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['--target', 'a', '--target=b', '--yes', '--api-url', 'http://x'], { target: 'list', yes: 'boolean' }), { target: ['a', 'b'], yes: true, apiUrl: 'http://x' });
  assert.throws(() => parseArgs(['--branch'], { branch: 'string' }), /needs a value/);
  assert.deepEqual(parseTargetSpec('web:json:messages/{locale}.json'), { platform: 'web', format: 'json', path: 'messages/{locale}.json' });
  assert.deepEqual(parseTargetSpec('android:app/src/main/res'), { platform: 'android', format: 'android-xml', path: 'app/src/main/res' });
  assert.throws(() => parseTargetSpec('web:json:messages/en.json'), /\{locale\}/);
  assert.equal(resolveApiURL({}, { LOCALIZE_API_URL: 'http://b/' }, { apiURL: 'http://c' }), 'http://b');
  assert.equal(resolveApiURL({ apiUrl: 'http://a' }, { LOCLI_API_URL: 'http://b' }, {}), 'http://a');
  assert.equal(resolveApiURL({}, {}, {}), 'https://locli.dev');
});

test('package metadata', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const server = JSON.parse(fs.readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@locli/cli');
  assert.equal(pkg.mcpName, server.name);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.equal(server.version, pkg.version);
  assert.deepEqual(pkg.dependencies ?? {}, {});
  JSON.parse(fs.readFileSync(new URL('../schema/locli.json', import.meta.url), 'utf8'));
});
