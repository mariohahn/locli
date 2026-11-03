import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keys, isDottedIdentifier } from '../src/commands/keys.js';
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
