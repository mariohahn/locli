import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseAndroidResources, unescapeAndroid, escapeAndroid, androidText, mergeAndroidResources, readAndroid, localeForValuesDir, valuesDirForLocale } from '../src/formats/android.js';
import { toJavaFormat } from '../src/formats/printf.js';
import { tempDir, writeFiles } from './helpers.js';

const TRICKY = `<?xml version="1.0" encoding="utf-8"?>
<!-- file header -->
<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">
    <!-- Login button on the start screen -->
    <string name="account_login">Sign in</string>
    <string name="apostrophe">Don\\'t stop</string>
    <string name="quoted">"It's   quoted"</string>
    <string name="newline">Line 1\\nLine 2</string>
    <string name="collapse">  lots   of
        space  </string>
    <string name="entities">Fish &amp; Chips &lt;3 &#x1F389; &#169;</string>
    <string name="cdata"><![CDATA[<b>not markup</b> & raw]]></string>
    <string name="at">\\@string/not_a_ref</string>
    <string name="unicode">caf\\u00e9 \\"q\\"</string>
    <string name="xliff">Hello <xliff:g id="name" example="Bob">%1$s</xliff:g>!</string>
    <string name="styled">Hello <b>bold</b></string>
    <string name="app_id" translatable="false">com.example</string>
    <plurals name="receipt_count">
        <!-- comment inside -->
        <item quantity="one">%d receipt</item>
        <item quantity="other">%d receipts</item>
    </plurals>
    <string-array name="planets">
        <item>Mercury</item>
        <item>Venus\\'s</item>
    </string-array>
</resources>
`;

test('parses tricky Android content', () => {
  const { resources } = parseAndroidResources(TRICKY);
  const byName = Object.fromEntries(resources.map((r) => [r.name, r]));
  assert.equal(byName.account_login.value, 'Sign in');
  assert.equal(byName.account_login.comment, 'Login button on the start screen');
  assert.equal(byName.apostrophe.value, "Don't stop");
  assert.equal(byName.quoted.value, "It's   quoted");
  assert.equal(byName.newline.value, 'Line 1\nLine 2');
  assert.equal(byName.collapse.value, 'lots of space');
  assert.equal(byName.entities.value, 'Fish & Chips <3 🎉 ©');
  assert.equal(byName.cdata.value, '<b>not markup</b> & raw');
  assert.equal(byName.at.value, '@string/not_a_ref');
  assert.equal(byName.unicode.value, 'café "q"');
  assert.equal(byName.xliff.value, 'Hello %1$s!');
  assert.equal(byName.xliff.markup, false);
  assert.equal(byName.styled.markup, true);
  assert.equal(byName.app_id.translatable, false);
  assert.deepEqual(byName.receipt_count.forms, { one: '%d receipt', other: '%d receipts' });
  assert.deepEqual(byName.planets.items, ['Mercury', "Venus's"]);
});

test('escape/unescape round-trips', () => {
  for (const text of ["Don't", 'say "hi"', 'a\nb\tc', '  padded  ', 'two  spaces', '@ref', '?attr', 'Fish & <Chips>', 'back\\slash', 'café 🎉', '100% sure']) {
    const escaped = escapeAndroid(text);
    const { resources } = parseAndroidResources(`<resources><string name="x">${escaped}</string></resources>`);
    assert.equal(resources[0].value, text, `${text} → ${escaped}`);
  }
  assert.equal(escapeAndroid("It's"), "It\\'s");
  assert.equal(escapeAndroid('@home'), '\\@home');
  assert.equal(escapeAndroid(' x'), '" x"');
  assert.equal(unescapeAndroid('"a" b "c"'), 'a b c');
});

test('printf conversion matches the server export', () => {
  assert.equal(toJavaFormat('%@ has %lld items'), '%1$s has %2$d items');
  assert.equal(toJavaFormat('%2$@ and %1$@'), '%2$s and %1$s');
  assert.equal(toJavaFormat('%.2f %% done'), '%1$.2f %% done');
  assert.equal(androidText('50% off'), '50% off', 'plain text keeps a single %');
  assert.equal(androidText('%d receipts'), '%1$d receipts');
  assert.throws(() => toJavaFormat("%'d"), /grouping/);
});

test('locale directories map both ways', () => {
  assert.equal(localeForValuesDir('values'), null);
  assert.equal(localeForValuesDir('values-de'), 'de');
  assert.equal(localeForValuesDir('values-pt-rBR'), 'pt-BR');
  assert.equal(localeForValuesDir('values-b+sr+Latn'), 'sr-Latn');
  assert.equal(localeForValuesDir('values-iw'), 'he');
  for (const dir of ['values-night', 'values-v21', 'values-sw600dp', 'values-land', 'values-car']) assert.equal(localeForValuesDir(dir), undefined, dir);
  assert.equal(valuesDirForLocale('pt-br'), 'values-pt-rBR');
  assert.equal(valuesDirForLocale('sr-latn'), 'values-b+sr+Latn');
  assert.equal(valuesDirForLocale('es-419'), 'values-b+es+419');
  assert.equal(valuesDirForLocale('de'), 'values-de');
});

test('readAndroid reads every locale and skips non-translatable and markup entries', () => {
  const root = tempDir();
  writeFiles(root, {
    'res/values/strings.xml': TRICKY,
    'res/values-de/strings.xml': '<resources><string name="account_login">Anmelden</string></resources>',
    'res/values-pt-rBR/strings.xml': '<resources><string name="account_login">Entrar</string></resources>',
    'res/values-night/strings.xml': '<resources><string name="account_login">night</string></resources>',
  });
  const texts = readAndroid(path.join(root, 'res'), { sourceLanguage: 'en' });
  assert.deepEqual(Object.keys(texts.locales).sort(), ['de', 'en', 'pt-BR']);
  assert.equal(texts.locales.en.app_id, undefined);
  assert.equal(texts.locales.en.styled, undefined);
  assert.ok(texts.warnings.some((w) => w.includes('styled')));
  assert.deepEqual(texts.locales.en.planets.items, ['Mercury', "Venus's"]);
  assert.equal(texts.comments.account_login, 'Login button on the start screen');
  assert.equal(texts.locales['pt-BR'].account_login.value, 'Entrar');
});

test('merge touches only changed exported entries and keeps the rest byte-for-byte', () => {
  const { content, changed } = mergeAndroidResources(TRICKY, [
    { name: 'account_login', kind: 'string', value: 'Sign in' }, // unchanged
    { name: 'apostrophe', kind: 'string', value: "Don't go" },
    { name: 'receipt_count', kind: 'plurals', forms: { one: '%lld receipt', other: '%lld receipts' } },
    { name: 'styled', kind: 'string', value: 'replaced?' }, // markup: left alone
    { name: 'new_key', kind: 'string', value: "It's new & <fresh>" },
    { name: 'new_array', kind: 'array', items: ['a', 'b'] },
  ]);
  assert.equal(changed, 4);
  assert.ok(content.includes('<string name="account_login">Sign in</string>'));
  assert.ok(content.includes("<string name=\"apostrophe\">Don\\'t go</string>"));
  assert.ok(content.includes('    <plurals name="receipt_count">\n        <item quantity="one">%1$d receipt</item>\n        <item quantity="other">%1$d receipts</item>\n    </plurals>'));
  assert.ok(content.includes('<string name="styled">Hello <b>bold</b></string>'));
  assert.ok(content.includes("    <string name=\"new_key\">It\\'s new &amp; &lt;fresh&gt;</string>\n    <string-array name=\"new_array\">\n        <item>a</item>\n        <item>b</item>\n    </string-array>\n</resources>\n"));
  assert.ok(content.includes('<!-- file header -->') && content.includes('<string name="app_id" translatable="false">com.example</string>'));
  const reparsed = Object.fromEntries(parseAndroidResources(content).resources.map((r) => [r.name, r]));
  assert.equal(reparsed.new_key.value, "It's new & <fresh>");
  // Merging the same values again changes nothing.
  assert.equal(mergeAndroidResources(content, [{ name: 'new_key', kind: 'string', value: "It's new & <fresh>" }]).changed, 0);
});

test('new files are generated with an XML header', () => {
  const { content } = mergeAndroidResources(null, [{ name: 'hello', kind: 'string', value: 'Hallo %@' }]);
  assert.equal(content, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="hello">Hallo %1$s</string>\n</resources>\n');
});
