import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keys, isDottedIdentifier, snakeName } from '../src/commands/keys.js';
import { push } from '../src/commands/push.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const unit = (value) => ({ stringUnit: { state: 'translated', value } });
const catalog = (strings) => ({ sourceLanguage: 'en', version: '1.0', strings });

function app(server, strings, code = {}) {
  const root = tempDir();
  writeFiles(root, {
    'locli.json': { project: 'nein', sourceLanguage: 'en', targets: [{ platform: 'ios', format: 'xcstrings', path: 'App/Localizable.xcstrings' }] },
    'App/Localizable.xcstrings': catalog(strings),
    ...code,
  });
  return { root, ctx: testContext({ cwd: root, env: testEnv(server.url) }) };
}

test('dotted identifiers are common.archived, not text used as a key', () => {
  for (const key of ['common.archived', 'adminDashboard.kvSteps', 'a.b.c']) assert.equal(isDottedIdentifier(key), true, key);
  for (const key of ['common_archived', 'Gespeichert.', 'Lädt...', 'Version 2.0 ist da', '.hidden', 'a..b']) assert.equal(isDottedIdentifier(key), false, key);
});

test('keys normalize --dry-run reports locli, catalog and code changes without writing', async () => {
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'common.archived' }, { key: 'account.login' }, { key: 'account_login', platforms: ['android'] }] });
  try {
    const swift = 'Text("common.archived")\nLabel(String(localized: "account.login"), systemImage: "x")\nText("common.archived.more")\n';
    const { root, ctx } = app(server, { 'common.archived': { localizations: { en: unit('Archived') } }, 'draft.new': { localizations: { en: unit('Draft') } }, 'Gespeichert.': { localizations: { en: unit('Saved.') } } },
      { 'App/Views/List.swift': swift });
    const result = await keys(ctx, { dryRun: true }, 'normalize');
    assert.equal(result.applied, false);
    assert.deepEqual(result.renamed, [{ from: 'common.archived', to: 'common_archived' }]);
    assert.deepEqual(result.merged, [{ from: 'account.login', into: 'account_login' }]);
    assert.deepEqual(result.localOnly, [{ from: 'draft.new', to: 'draft_new' }]);
    assert.deepEqual(result.code, [{ file: 'App/Views/List.swift', replacements: 2 }]);
    assert.match(ctx.output.join('\n'), /Would rename 1 key in locli: common\.archived → common_archived/);
    assert.match(ctx.output.join('\n'), /Dry run: nothing changed/);
    assert.equal(fs.readFileSync(path.join(root, 'App/Views/List.swift'), 'utf8'), swift);
    assert.equal(server.state.keys.some((k) => k.key === 'common.archived'), true);
    assert.equal(server.calls('POST', '/keys/normalize').every((c) => c.body.apply === false), true);
  } finally { await server.close(); }
});

test('keys normalize renames in locli, the String Catalog and exact Swift literals', async () => {
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'common.archived' }, { key: 'account.login' }, { key: 'account_login', platforms: ['android'] }] });
  try {
    const { root, ctx } = app(server, {
      'common.archived': { comment: 'Badge', localizations: { en: unit('Archived'), de: unit('Archiviert') } },
      'account.login': { localizations: { en: unit('Sign in'), fr: unit('Connexion') } },
      account_login: { localizations: { en: unit('Sign in') } },
      'Gespeichert.': { localizations: { en: unit('Saved.') } },
    }, { 'App/Views/List.swift': 'Text("common.archived")\nText("common.archived.more")\nText("Gespeichert.")\n' });
    const result = await keys(ctx, {}, 'normalize');
    assert.equal(result.applied, true);
    assert.deepEqual(server.state.keys.map((k) => k.key).sort(), ['account_login', 'common_archived']);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'App/Localizable.xcstrings'), 'utf8'));
    assert.deepEqual(Object.keys(written.strings).sort(), ['Gespeichert.', 'account_login', 'common_archived']);
    assert.equal(written.strings.common_archived.comment, 'Badge');
    assert.equal(written.strings.common_archived.localizations.de.stringUnit.value, 'Archiviert');
    assert.equal(written.strings.account_login.localizations.fr.stringUnit.value, 'Connexion', 'languages only the old entry had stay');
    assert.equal(fs.readFileSync(path.join(root, 'App/Views/List.swift'), 'utf8'), 'Text("common_archived")\nText("common.archived.more")\nText("Gespeichert.")\n');
  } finally { await server.close(); }
});

test('push refuses new dotted iOS keys and points to keys normalize; known ones only warn', async () => {
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'common.archived' }] });
  try {
    const { ctx } = app(server, { 'common.archived': { localizations: { en: unit('Archived') } }, 'draft.new': { localizations: { en: unit('Draft') } } });
    await assert.rejects(push(ctx, { dryRun: true }), /1 new key contains dots: draft\.new[\s\S]*keys normalize/);
  } finally { await server.close(); }
  const known = await fakeServer({ slug: 'nein', keys: [{ key: 'common.archived' }] });
  try {
    const { ctx } = app(known, { 'common.archived': { localizations: { en: unit('Archived') } } });
    await push(ctx, { dryRun: true });
    assert.ok(ctx.warnings.some((w) => /1 key still uses dots \(common\.archived\)/.test(w)), ctx.warnings.join('\n'));
  } finally { await known.close(); }
});

test('init on an iOS app with dotted keys says to normalize before the first push', async () => {
  const { init } = await import('../src/commands/init.js');
  const root = tempDir();
  writeFiles(root, { 'App/Localizable.xcstrings': catalog({ 'common.archived': { localizations: { en: unit('Archived') } }, title_main: { localizations: { en: unit('Start') } } }) });
  const ctx = testContext({ cwd: root, env: { XDG_CONFIG_HOME: tempDir(), PATH: process.env.PATH } });
  await assert.rejects(init(ctx, { slug: 'nein', agentFiles: false, icon: false }), /Not logged in/);
  assert.ok(ctx.output.some((l) => /1 key uses dots \(common\.archived\).*keys normalize --dry-run/.test(l)), ctx.output.join('\n'));
});

test('keys normalize moves camelCase to snake_case and merges with the Android twin', async () => {
  assert.equal(snakeName('adminDashboard.location'), 'admin_dashboard_location');
  assert.equal(snakeName('URLScheme.title'), 'url_scheme_title');
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'adminDashboard.location', platforms: ['ios'] }, { key: 'admin_dashboard_location', platforms: ['android'] }] });
  try {
    const { root, ctx } = app(server, {
      'adminDashboard.location': { localizations: { en: unit('Location') } },
      adminDashboard_steps: { localizations: { en: unit('Steps') } },
      admin_dashboard_steps: { localizations: { de: unit('Schritte') } },
      welcomeTitle: { localizations: { en: unit('Welcome') } },
    }, { 'App/Admin.swift': 'Text("adminDashboard.location")\nText("adminDashboard_steps")\nText("welcomeTitle")\n' });
    const result = await keys(ctx, {}, 'normalize');
    assert.deepEqual(result.merged, [{ from: 'adminDashboard.location', into: 'admin_dashboard_location' }]);
    assert.deepEqual(result.localOnly, [{ from: 'adminDashboard_steps', to: 'admin_dashboard_steps' }]);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'App/Localizable.xcstrings'), 'utf8'));
    assert.deepEqual(Object.keys(written.strings).sort(), ['admin_dashboard_location', 'admin_dashboard_steps', 'welcomeTitle']);
    assert.deepEqual(Object.keys(written.strings.admin_dashboard_steps.localizations).sort(), ['de', 'en']);
    assert.equal(fs.readFileSync(path.join(root, 'App/Admin.swift'), 'utf8'), 'Text("admin_dashboard_location")\nText("admin_dashboard_steps")\nText("welcomeTitle")\n');
  } finally { await server.close(); }
});

test('keys delete removes unreleased keys in locli and in every catalog, released ones are refused', async () => {
  const server = await fakeServer({ slug: 'nein', keys: [
    { key: 'adminDashboard_location', platforms: ['ios'] },
    { key: 'draft_banner', platforms: ['ios', 'android', 'web'] },
    { key: 'home_title', platforms: ['ios'], released: '1.0' },
  ] });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'nein', sourceLanguage: 'en', targets: [
        { platform: 'ios', format: 'xcstrings', path: 'App/Localizable.xcstrings' },
        { platform: 'android', format: 'android-xml', path: 'app/src/main/res' },
        { platform: 'web', format: 'json', path: 'messages/{locale}.json' },
      ] },
      'App/Localizable.xcstrings': catalog({ adminDashboard_location: { localizations: { en: unit('Location') } }, draft_banner: { localizations: { en: unit('Draft') } }, home_title: { localizations: { en: unit('Home') } }, old_local: { localizations: { en: unit('Old') } } }),
      'App/Views/Admin.swift': 'Text("adminDashboard_location")\n',
      'messages/en.json': { draft_banner: 'Draft', home: { title: 'Home' } },
    });
    const android = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- Banner on drafts -->\n    <string name="draft_banner">Draft</string>\n    <string name="home_title">Home</string>\n</resources>\n';
    fs.mkdirSync(path.join(root, 'app/src/main/res/values'), { recursive: true });
    fs.mkdirSync(path.join(root, 'app/src/main/res/values-de'), { recursive: true });
    fs.writeFileSync(path.join(root, 'app/src/main/res/values/strings.xml'), android);
    fs.writeFileSync(path.join(root, 'app/src/main/res/values-de/strings.xml'), android.replace('>Draft<', '>Entwurf<'));
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });

    await assert.rejects(keys(ctx, { names: ['draft_banner', 'home_title'] }, 'delete'), /1 key already released, nothing was deleted: home_title \(1\.0\)/);
    assert.equal(server.state.keys.length, 3);

    const dry = await keys(ctx, { names: ['adminDashboard_location', 'draft_banner', 'old_local', 'ghost'], dryRun: true }, 'delete');
    assert.equal(dry.applied, false);
    assert.deepEqual(dry.localOnly, ['old_local']);
    assert.deepEqual(dry.unknown, ['ghost']);
    assert.deepEqual(dry.stillReferencedIn, ['App/Views/Admin.swift']);
    assert.equal(server.state.keys.length, 3);

    const result = await keys(ctx, { names: ['adminDashboard_location', 'draft_banner', 'old_local'] }, 'delete');
    assert.equal(result.applied, true);
    assert.deepEqual(server.state.keys.map((k) => k.key), ['home_title']);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'App/Localizable.xcstrings'), 'utf8'));
    assert.deepEqual(Object.keys(written.strings), ['home_title']);
    assert.equal(fs.readFileSync(path.join(root, 'app/src/main/res/values/strings.xml'), 'utf8'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="home_title">Home</string>\n</resources>\n');
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'app/src/main/res/values-de/strings.xml'), 'utf8'), /draft_banner/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'messages/en.json'), 'utf8')), { home: { title: 'Home' } });
    assert.ok(ctx.warnings.some((w) => /still uses .*Admin\.swift/.test(w)), ctx.warnings.join('\n'));
  } finally { await server.close(); }
});

test('removeMessages deletes flat keys and nested paths and prunes empty objects', async () => {
  const { removeMessages } = await import('../src/formats/json.js');
  const data = { nav: { home: 'Home', admin: { location: 'Location' } }, 'a.b': 'flat', keep: 'x' };
  assert.equal(removeMessages(data, ['nav.admin.location', 'a.b', 'missing.key']), 2);
  assert.deepEqual(data, { nav: { home: 'Home' }, keep: 'x' });
});

test('locli keys delete takes several key names before and after flags', async () => {
  const { main } = await import('../src/cli.js');
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'a_one' }, { key: 'b_two' }] });
  try {
    const { ctx } = app(server, { a_one: { localizations: { en: unit('A') } }, b_two: { localizations: { en: unit('B') } } });
    const code = await main(['keys', 'delete', 'a_one', '--dry-run', 'b_two', '--json'], { cwd: ctx.cwd, env: ctx.env, out: ctx.out, info: ctx.info, warn: ctx.warn });
    assert.equal(code, 0);
    assert.deepEqual(server.calls('POST', '/keys/delete')[0].body, { keys: ['a_one', 'b_two'], apply: false });
    assert.equal(server.state.keys.length, 2);
  } finally { await server.close(); }
});

test('MCP locli_delete_keys deletes unreleased keys and refuses released ones', async () => {
  const { callTool } = await import('../src/mcp.js');
  const server = await fakeServer({ slug: 'nein', keys: [{ key: 'draft_banner' }, { key: 'home_title', released: '1.0' }] });
  try {
    const { root } = app(server, { draft_banner: { localizations: { en: unit('Draft') } }, home_title: { localizations: { en: unit('Home') } } });
    const refused = await callTool('locli_delete_keys', { keys: ['home_title'] }, { cwd: root, env: testEnv(server.url) });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /already released.*home_title \(1\.0\)[\s\S]*web editor/);
    const done = await callTool('locli_delete_keys', { keys: ['draft_banner'] }, { cwd: root, env: testEnv(server.url) });
    assert.equal(done.isError, false, done.content[0].text);
    assert.match(done.content[0].text, /Deleted 1 unreleased key in locli: draft_banner/);
    assert.deepEqual(server.state.keys.map((k) => k.key), ['home_title']);
  } finally { await server.close(); }
});
