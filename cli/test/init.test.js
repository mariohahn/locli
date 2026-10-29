import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectTargets } from '../src/detect.js';
import { upsertBlock, agentsBlock, writeAgentFiles, renameSkill, START, END } from '../src/agents.js';
import { init } from '../src/commands/init.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const xcstrings = { sourceLanguage: 'de', version: '1.0', strings: { hello: { localizations: { de: { stringUnit: { state: 'translated', value: 'Hallo' } }, en: { stringUnit: { state: 'translated', value: 'Hello' } } } } } };

test('detects iOS, Android and web targets and skips build folders', () => {
  const root = tempDir();
  writeFiles(root, {
    'App/Localizable.xcstrings': xcstrings,
    'App/InfoPlist.xcstrings': xcstrings,
    'Pods/Lib/Other.xcstrings': xcstrings,
    'node_modules/pkg/messages/en.json': { a: 'b' },
    'android/app/src/main/res/values/strings.xml': '<resources><string name="a">A</string></resources>',
    'android/app/src/main/res/values-fr/strings.xml': '<resources><string name="a">A</string></resources>',
    'android/app/build/src/main/res/values/strings.xml': '<resources/>',
    'web/messages/en.json': { a: 'A' },
    'web/messages/es.json': { a: 'A' },
    'site/public/locales/en/common.json': { a: 'A' },
    'site/public/locales/en/auth.json': { b: 'B' },
  });
  const result = detectTargets(root);
  assert.deepEqual(result.targets, [
    { platform: 'ios', format: 'xcstrings', path: 'App/Localizable.xcstrings' },
    { platform: 'android', format: 'android-xml', path: 'android/app/src/main/res' },
    { platform: 'web', format: 'json', path: 'site/public/locales/{locale}/auth.json', keyPrefix: 'auth' },
    { platform: 'web', format: 'json', path: 'site/public/locales/{locale}/common.json', keyPrefix: 'common' },
    { platform: 'web', format: 'json', path: 'web/messages/{locale}.json' },
  ]);
  assert.equal(result.sourceLanguage, 'de');
  assert.deepEqual(result.locales, ['de', 'en', 'es', 'fr']);
  assert.ok(result.notes.some((n) => n.includes('InfoPlist')));
});

test('AGENTS.md block is idempotent and keeps surrounding content', () => {
  const block = agentsBlock({ project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', path: 'messages/{locale}.json' }] });
  const once = upsertBlock('# Team rules\n\nBe nice.\n', block);
  const twice = upsertBlock(once, block);
  assert.equal(once, twice);
  assert.equal(once.split(START).length, 2);
  assert.ok(once.startsWith('# Team rules\n\nBe nice.\n\n<!-- locli:start -->'));
  const changed = upsertBlock(once, block.replace('`app`', '`other`'));
  assert.ok(changed.includes('`other`') && !changed.includes('`app`') && changed.endsWith(`${END}\n`));
  assert.ok(block.includes('npx @locli/cli push') && block.includes('https://locli.dev/docs/agents.md'));
  assert.equal(renameSkill('---\nname: localize\ndescription: "x"\n---\nname: localize stays'), '---\nname: locli\ndescription: "x"\n---\nname: localize stays');
});

test('agent files: CLAUDE.md import, skill copy and relative symlink, rerun-safe', () => {
  const root = tempDir();
  writeFiles(root, { 'CLAUDE.md': '# Project\n' });
  const config = { project: 'app', sourceLanguage: 'en', targets: [] };
  writeAgentFiles(root, config);
  const second = writeAgentFiles(root, config);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# Project\n\n@AGENTS.md\n');
  assert.ok(!second.includes('updated AGENTS.md'));
  const skill = fs.readFileSync(path.join(root, '.agents/skills/locli/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: locli$/m);
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/locli/references/cli.md')));
  const link = path.join(root, '.claude/skills/locli');
  assert.equal(fs.readlinkSync(link), path.join('..', '..', '.agents', 'skills', 'locli'));
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')));
});

test('init writes locli.json, creates the project, languages and platforms', async () => {
  const server = await fakeServer();
  try {
    const root = tempDir();
    writeFiles(root, {
      'package.json': { name: '@acme/shop-app' },
      'messages/en.json': { hello: 'Hello' },
      'messages/de.json': { hello: 'Hallo' },
      'app/src/main/res/values/strings.xml': '<resources><string name="hello">Hello</string></resources>',
    });
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    const result = await init(ctx, { noAgentFiles: true, agentFiles: false });
    assert.equal(result.project, 'shop-app');
    assert.equal(result.created, true);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'locli.json'), 'utf8'));
    assert.deepEqual(config, {
      $schema: 'https://locli.dev/schema/locli.json', apiURL: server.url, project: 'shop-app', sourceLanguage: 'en',
      targets: [{ platform: 'android', format: 'android-xml', path: 'app/src/main/res' }, { platform: 'web', format: 'json', path: 'messages/{locale}.json' }],
    });
    assert.deepEqual(server.calls('POST', '/api/projects').filter((r) => r.path === '/api/projects')[0].body, { name: 'shop-app', slug: 'shop-app', defaultLocale: 'en' });
    assert.deepEqual(server.calls('POST', '/locales').map((r) => r.body.code), ['de']);
    assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
    // Rerun: same config, no new project.
    await init(testContext({ cwd: root, env: testEnv(server.url) }), { agentFiles: false });
    assert.equal(server.state.projects.length, 1);
  } finally { await server.close(); }
});

test('init without login still writes the config and explains what to do', async () => {
  const root = tempDir();
  const ctx = testContext({ cwd: root, env: { XDG_CONFIG_HOME: tempDir(), PATH: process.env.PATH } });
  await assert.rejects(init(ctx, { slug: 'my-app', agentFiles: false }), /Not logged in\. Ask the user to run `npx @locli\/cli login`/);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'locli.json'), 'utf8'));
  assert.equal(config.project, 'my-app');
  assert.deepEqual(config.targets, []);
  assert.ok(ctx.output.some((l) => l.includes('No localization files found')));
});

test('in a monorepo, --target paths count from where init runs and are stored from the repo root', async () => {
  const root = tempDir();
  spawnSync('git', ['init', '-q', root]);
  writeFiles(root, { 'web/src/messages/de.json': { hallo: 'Hallo' } });
  const ctx = testContext({ cwd: path.join(root, 'web'), env: { XDG_CONFIG_HOME: tempDir(), PATH: process.env.PATH } });
  await assert.rejects(init(ctx, { slug: 'web', target: ['web:json:src/messages/{locale}.json'], agentFiles: false }), /Not logged in/);
  const config = JSON.parse(fs.readFileSync(path.join(fs.realpathSync(root), 'locli.json'), 'utf8'));
  assert.deepEqual(config.targets, [{ platform: 'web', format: 'json', path: 'web/src/messages/{locale}.json' }]);
});
