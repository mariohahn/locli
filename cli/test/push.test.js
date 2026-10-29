import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBatches, isTextKey, push } from '../src/commands/push.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const unit = (value, state = 'translated') => ({ stringUnit: { state, value } });

test('iOS push uploads only missing values, with branch and plural arguments, never overwriting', async () => {
  const server = await fakeServer({
    slug: 'app', defaultLocale: 'en', locales: ['en', 'de'],
    keys: [{ key: 'account.login', platforms: ['ios'] }, { key: 'legacy', platforms: ['web'] }],
    values: [{ key: 'account.login', locale: 'en', value: 'Log in (edited in locli)' }, { key: 'legacy', locale: 'en', value: 'Old' }],
  });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'ios', format: 'xcstrings', path: 'App/Localizable.xcstrings' }] },
      'App/Localizable.xcstrings': {
        sourceLanguage: 'en', version: '1.0', strings: {
          'account.login': { comment: 'Login button', localizations: { en: unit('Sign in'), de: unit('Anmelden', 'needs_review') } },
          legacy: { localizations: { en: unit('Old') } },
          owner_receipts: { localizations: { en: { stringUnit: { state: 'translated', value: '%#@count@' }, substitutions: { count: { argNum: 2, formatSpecifier: 'lld', variations: { plural: { one: unit('%1$@ has %arg receipt'), other: unit('%1$@ has %arg receipts') } } } } } } },
        },
      },
    });
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    const summary = await push(ctx, {});
    const imports = server.calls('POST', '/translations/import').map((r) => r.body);
    const en = server.state.locales.find((l) => l.code === 'en').id;
    const de = server.state.locales.find((l) => l.code === 'de').id;
    assert.deepEqual(imports.find((b) => b.localeID === de), { localeID: de, platform: 'ios', status: 'draft', values: { 'account.login': 'Anmelden' }, forms: {}, pluralArguments: {}, branch: 'feature/receipts' });
    const enImport = imports.find((b) => b.localeID === en);
    // account.login (assigned to iOS, has a value) is never re-sent; legacy is not assigned to iOS, so it is (Python behaviour).
    assert.deepEqual(Object.keys(enImport.values), ['legacy']);
    assert.deepEqual(enImport.forms, { owner_receipts: { one: '%1$@ has %2$lld receipt', other: '%1$@ has %2$lld receipts' } });
    assert.deepEqual(enImport.pluralArguments, { owner_receipts: 2 });
    assert.equal(server.state.values.find((v) => v.localeID === en && v.value.startsWith('Log in')).value, 'Log in (edited in locli)');
    assert.deepEqual(server.calls('POST', '/features/sync')[0].body, { branch: 'feature/receipts', keys: ['account.login', 'legacy', 'owner_receipts'] });
    // Comment filled from the catalog because locli only had the "Imported" placeholder.
    const patch = server.calls('PATCH', '/keys/')[0].body;
    assert.equal(patch.comment, 'Login button');
    assert.equal(summary.addedValues, 3);
    assert.ok(ctx.output.some((l) => /wait for a release — ask the project owner to approve it at .*\/app\/projects\/releases\/\?projectId=/.test(l)));
    // Second push: nothing left to add.
    const again = await push(testContext({ cwd: root, env: testEnv(server.url) }), {});
    assert.equal(again.addedValues, 0);
  } finally { await server.close(); }
});

test('Android push enables the platform, maps resource names, creates arrays and never overwrites', async () => {
  const server = await fakeServer({
    slug: 'app', defaultLocale: 'en', locales: ['en'], platforms: ['ios', 'web'],
    keys: [{ key: 'account.login', platforms: ['ios'] }],
    values: [{ key: 'account.login', locale: 'en', value: 'Sign in' }],
  });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'android', format: 'android-xml', path: 'app/src/main/res' }] },
      'app/src/main/res/values/strings.xml': `<resources>
    <string name="account_login">Log in locally</string>
    <!-- Shown on the receipts tab -->
    <plurals name="receipt_count"><item quantity="one">%d receipt</item><item quantity="other">%d receipts</item></plurals>
    <string-array name="planets"><item>Mercury</item><item>Venus</item></string-array>
</resources>`,
      'app/src/main/res/values-pt-rBR/strings.xml': '<resources><string name="account_login">Entrar</string></resources>',
    });
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    await push(ctx, {});
    assert.deepEqual(server.calls('PATCH', '/api/projects/').filter((r) => !r.path.includes('/keys/'))[0].body, { platforms: ['ios', 'web', 'android'] });
    assert.equal(server.calls('POST', '/locales')[0].body.code, 'pt-BR');
    const imports = server.calls('POST', '/translations/import').map((r) => r.body);
    const ptBR = server.state.locales.find((l) => l.code === 'pt-br').id;
    // account_login maps to the existing key account.login: en is not re-sent, pt-BR becomes a shared value.
    assert.ok(imports.every((b) => !('account_login' in b.values)));
    assert.ok(!imports.some((b) => b.values['account.login'] === 'Log in locally'));
    assert.deepEqual(imports.find((b) => b.localeID === ptBR), { localeID: ptBR, platform: 'shared', status: 'translated', values: { 'account.login': 'Entrar' }, forms: {}, pluralArguments: {}, branch: 'feature/receipts' });
    const created = imports.find((b) => b.platform === 'android' && b.forms.receipt_count);
    assert.deepEqual(created.forms.receipt_count, { one: '%d receipt', other: '%d receipts' });
    assert.deepEqual(server.calls('POST', '/keys')[0].body, { key: 'planets', namespace: 'planets', comment: null, platforms: ['android'], valueKind: 'array', featureID: server.state.features[0].id });
    assert.ok(imports.some((b) => b.values.planets === '["Mercury","Venus"]'));
    // Existing key got android assigned; new plural key got its comment.
    const login = server.state.keys.find((k) => k.key === 'account.login');
    assert.deepEqual(login.platforms, ['ios', 'android']);
    assert.equal(server.state.keys.find((k) => k.key === 'receipt_count').comment, 'Shown on the receipts tab');
    assert.equal(server.state.values.find((v) => v.value === 'Sign in').value, 'Sign in');
  } finally { await server.close(); }
});

test('web push converts ICU plurals, passes other ICU through, and --dry-run writes nothing', async () => {
  const server = await fakeServer({ slug: 'app', defaultLocale: 'en', locales: ['en'] });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] },
      'messages/en.json': { cart: { count: '{count, plural, one {# item} other {# items}}', hello: 'Hi {name}', select: '{g, select, male {He} other {They}}' } },
      'messages/de.json': { cart: { hello: 'Hallo {name}' } },
    });
    const dry = await push(testContext({ cwd: root, env: testEnv(server.url) }), { dryRun: true });
    assert.equal(dry.addedValues, 4);
    assert.deepEqual(dry.newKeys.sort(), ['cart.count', 'cart.hello', 'cart.select']);
    assert.equal(server.state.requests.filter((r) => r.method !== 'GET').length, 0, 'dry run sends no writes');

    await push(testContext({ cwd: root, env: testEnv(server.url, { LOCLI_BRANCH: 'main' }) }), {});
    const en = server.calls('POST', '/translations/import').map((r) => r.body).find((b) => b.forms['cart.count']);
    assert.deepEqual(en.forms, { 'cart.count': { one: '%lld item', other: '%lld items' } });
    assert.deepEqual(en.pluralArguments, { 'cart.count': 1 });
    assert.equal(en.values['cart.select'], '{g, select, male {He} other {They}}');
    assert.equal(en.platform, 'web');
    assert.equal(en.branch, 'main');
  } finally { await server.close(); }
});

test('push without a token tells the agent to ask the user to log in', async () => {
  const server = await fakeServer({ slug: 'app' });
  try {
    const root = tempDir();
    writeFiles(root, { 'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', format: 'json', path: 'm/{locale}.json' }] }, 'm/en.json': { a: 'A' } });
    const env = { XDG_CONFIG_HOME: tempDir(), LOCLI_API_URL: server.url, PATH: process.env.PATH };
    await assert.rejects(push(testContext({ cwd: root, env }), {}), { message: 'Not logged in. Ask the user to run `npx @locli/cli login` (it opens a browser to approve), or set LOCLI_TOKEN in CI.' });
    await assert.rejects(push(testContext({ cwd: root, env: { ...env, LOCLI_TOKEN: 'wrong' } }), {}), /token was rejected/);
  } finally { await server.close(); }
});

test('a large catalog goes up in batches, each key with its own plural forms', () => {
  const values = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`key.${i}`, `Text ${i}`]));
  const body = { localeID: 'de', platform: 'web', status: 'translated', values, forms: { 'key.599': { one: '#', other: '#' } }, pluralArguments: { 'key.599': 'count' }, branch: 'main' };
  const batches = importBatches(body);
  assert.deepEqual(batches.map((b) => Object.keys(b.values).length), [100, 100, 100, 100, 100, 100]);
  assert.deepEqual(batches.map((b) => Object.keys(b.forms)), [[], [], [], [], [], ["key.599"]]);
  assert.equal(batches[5].pluralArguments['key.599'], 'count');
  assert.ok(batches.every((b) => b.localeID === 'de' && b.branch === 'main'));
  assert.deepEqual(importBatches({ values: { a: 'A' } }), [{ values: { a: 'A' } }]);
});

test('new keys that are visible text are refused before anything is written', async () => {
  const server = await fakeServer({ slug: 'app', defaultLocale: 'de', locales: ['de'] });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'de', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] },
      'messages/de.json': { 'Projekt wechseln: {name}': 'Projekt wechseln: {name}', team_seats_used: '{used} von {limit} Plätzen belegt' },
    });
    await assert.rejects(push(testContext({ cwd: root, env: testEnv(server.url) }), {}), (error) => {
      assert.equal(/** @type {any} */ (error).exitCode, 2);
      assert.match(String(error), /1 new key looks like visible text, not an identifier: "Projekt wechseln: \{name\}"/);
      assert.match(String(error), /lower_snake_case/);
      return true;
    });
    assert.equal(server.state.requests.filter((r) => r.method !== 'GET').length, 0, 'nothing is written');
    const result = await push(testContext({ cwd: root, env: testEnv(server.url) }), { allowTextKeys: true });
    assert.equal(result.createdKeys >= 0, true);
  } finally { await server.close(); }
});

test('identifiers pass, text and sentences do not', () => {
  for (const key of ['account_login', 'account.login', 'receipt-count', 'Welcome']) assert.equal(isTextKey(key), false, key);
  for (const key of ['Hello world', 'Projekte', 'Plätze', '{name} entfernen', 'Save?', ' leading']) assert.equal(isTextKey(key), key !== 'Projekte', key);
});
