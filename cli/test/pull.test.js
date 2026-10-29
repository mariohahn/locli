import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pull } from '../src/commands/pull.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const unit = (value, state = 'translated') => ({ stringUnit: { state, value } });

const exports = {
  'export/ios': { sourceLanguage: 'en', version: '1.0', strings: { hello: { comment: 'Greeting', extractionState: 'manual', localizations: { en: unit('Hello'), de: unit('Hallo') } } } },
  'resolved/android': {
    sourceLanguage: 'en',
    locales: [{ code: 'en', name: 'English', isBase: true }, { code: 'de', name: 'Deutsch', isBase: false }, { code: 'pt-br', name: 'Português', isBase: false }],
    keys: [
      { key: 'account.login', identifier: 'account_login', valueKind: 'text', values: { en: { value: "Sign in, it's free", status: 'translated' }, de: { value: 'Anmelden', status: 'translated' }, 'pt-br': { value: 'Entrar', status: 'translated' } } },
      { key: 'receipt_count', identifier: 'receipt_count', valueKind: 'text', plural: { argument: 1 }, values: { en: { value: '%lld receipts', status: 'translated', forms: { one: '%lld receipt', other: '%lld receipts' } } } },
      { key: 'planets', identifier: 'planets', valueKind: 'array', values: { en: { value: '[]', status: 'translated', items: ['Mercury', 'Venus'] } } },
      { key: 'percent', identifier: 'percent', valueKind: 'text', values: { de: { value: '%@ zu 50%%', status: 'translated' } } },
    ],
  },
  'export/web': { en: { 'home.title': 'Home', 'cart.count': '{count, plural, one {# item} other {# items}}' }, de: { 'home.title': 'Start' }, fr: { 'home.title': 'Accueil' } },
};

test('pull pins the latest release and writes iOS, Android and web files', async () => {
  const server = await fakeServer({ slug: 'app', releases: ['1.0', '1.1'], exports });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [
        { platform: 'ios', format: 'xcstrings', path: 'Localizable.xcstrings' },
        { platform: 'android', format: 'android-xml', path: 'res' },
        { platform: 'web', format: 'json', path: 'messages/{locale}.json' },
      ] },
      'Localizable.xcstrings': { sourceLanguage: 'en', version: '1.0', strings: { local_only: { localizations: { en: unit('Mine') } } } },
      'res/values/strings.xml': '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name" translatable="false">Shop</string>\n    <string name="account_login">Old</string>\n</resources>\n',
      'messages/en.json': '{\n    "home": {\n        "title": "Old home",\n        "keep": "Local"\n    }\n}\n',
    });
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    const result = await pull(ctx, {});
    assert.equal(result.release, '1.1');
    const exportCalls = server.state.requests.filter((r) => /\/(export|resolved)\//.test(r.path)).map((r) => r.path.replace(/^\/api\/projects\/[^/]+/, ''));
    assert.deepEqual(exportCalls, ['/export/ios?format=xcstrings&release=1.1', '/resolved/android?release=1.1', '/export/web?release=1.1']);

    const catalog = fs.readFileSync(path.join(root, 'Localizable.xcstrings'), 'utf8');
    assert.ok(catalog.includes('"local_only"') && catalog.includes('"Hallo"') && catalog.endsWith('}\n'));

    const values = fs.readFileSync(path.join(root, 'res/values/strings.xml'), 'utf8');
    assert.equal(values, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name" translatable="false">Shop</string>\n    <string name="account_login">Sign in, it\\\'s free</string>\n    <plurals name="receipt_count">\n        <item quantity="one">%1$d receipt</item>\n        <item quantity="other">%1$d receipts</item>\n    </plurals>\n    <string-array name="planets">\n        <item>Mercury</item>\n        <item>Venus</item>\n    </string-array>\n</resources>\n');
    assert.equal(fs.readFileSync(path.join(root, 'res/values-de/strings.xml'), 'utf8'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="account_login">Anmelden</string>\n    <string name="percent">%1$s zu 50%%</string>\n</resources>\n');
    assert.ok(fs.existsSync(path.join(root, 'res/values-pt-rBR/strings.xml')));

    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'messages/en.json'), 'utf8')), { home: { title: 'Home', keep: 'Local' }, cart: { count: '{count, plural, one {# item} other {# items}}' } });
    assert.ok(fs.readFileSync(path.join(root, 'messages/en.json'), 'utf8').startsWith('{\n    "home"'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'messages/fr.json'), 'utf8')), { home: { title: 'Accueil' } });

    // A second pull changes nothing.
    const before = fs.readFileSync(path.join(root, 'res/values/strings.xml'), 'utf8');
    await pull(testContext({ cwd: root, env: testEnv(server.url) }), {});
    assert.equal(fs.readFileSync(path.join(root, 'res/values/strings.xml'), 'utf8'), before);
  } finally { await server.close(); }
});

test('pull without a release fails with a hint instead of falling back to the draft', async () => {
  const server = await fakeServer({ slug: 'app', exports });
  try {
    const root = tempDir();
    writeFiles(root, {
      'locli.json': { project: 'app', sourceLanguage: 'en', targets: [{ platform: 'web', format: 'json', path: 'messages/{locale}.json' }] },
      'messages/en.json': { a: 'A' },
    });
    await assert.rejects(pull(testContext({ cwd: root, env: testEnv(server.url) }), {}), /No release yet\. Ask the project owner .*pull --draft/);
    assert.equal(fs.readFileSync(path.join(root, 'messages/en.json'), 'utf8'), '{\n  "a": "A"\n}\n');
    const ctx = testContext({ cwd: root, env: testEnv(server.url) });
    const result = await pull(ctx, { draft: true });
    assert.equal(result.release, null);
    assert.ok(server.state.requests.some((r) => r.path.endsWith('/export/web')));
    assert.ok(ctx.output.some((l) => l.includes('local checks only')));
  } finally { await server.close(); }
});
