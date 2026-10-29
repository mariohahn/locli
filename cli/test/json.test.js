import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flatten, readJsonTarget, writeJsonFile, findLocaleFiles } from '../src/formats/json.js';
import { parseIcuPlural } from '../src/formats/icu.js';
import { tempDir, writeFiles } from './helpers.js';

test('flatten nested objects with dots', () => {
  assert.deepEqual(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' }), { 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
});

test('top-level ICU plurals become printf forms (inverse of the server export)', () => {
  assert.deepEqual(parseIcuPlural('{count, plural, one {# receipt} other {# receipts}}'), { forms: { one: '%lld receipt', other: '%lld receipts' }, selector: 1 });
  assert.deepEqual(parseIcuPlural('{count, plural, one {{arg1} has # receipt} other {{arg1} has # receipts}}'), { forms: { one: '%1$@ has %2$lld receipt', other: '%1$@ has %2$lld receipts' }, selector: 2 });
  assert.deepEqual(parseIcuPlural("{count, plural, =0 {No receipts} zero {No receipts} other {# receipts, it''s 100%}}"), { forms: { zero: 'No receipts', other: "%lld receipts, it's 100%%" }, selector: 1 });
  assert.deepEqual(parseIcuPlural("{count, plural, other {# '{'braces'}' {arg2, number, ::.00 group-off}}}").forms, { other: "%1$lld {braces} %2$.2f" });
  // Anything the server can't represent stays a plain ICU string.
  assert.equal(parseIcuPlural('{n, plural, one {# x} other {# xs}}'), null);
  assert.equal(parseIcuPlural('{count, plural, =1 {one} other {many}}'), null);
  assert.equal(parseIcuPlural('{count, plural, one {{gender, select, male {he} other {they}}} other {x}}'), null);
  assert.equal(parseIcuPlural('Hello {name}'), null);
});

test('reads locale files from a {locale} pattern, including key prefixes', () => {
  const root = tempDir();
  writeFiles(root, {
    'messages/en.json': { home: { title: 'Home', count: '{count, plural, one {# item} other {# items}}' }, greeting: 'Hi {name}' },
    'messages/pt-BR.json': { home: { title: 'Início' } },
    'messages/README.json': { ignored: true },
    'public/locales/de/common.json': { save: 'Speichern' },
  });
  assert.deepEqual(Object.keys(findLocaleFiles(root, 'messages/{locale}.json')).sort(), ['en', 'pt-BR']);
  const texts = readJsonTarget(root, { path: 'messages/{locale}.json' });
  assert.deepEqual(texts.keys, ['greeting', 'home.count', 'home.title']);
  assert.equal(texts.locales.en.greeting.value, 'Hi {name}');
  assert.deepEqual(texts.locales.en['home.count'].forms, { one: '%lld item', other: '%lld items' });
  const prefixed = readJsonTarget(root, { path: 'public/locales/{locale}/common.json', keyPrefix: 'common' });
  assert.equal(prefixed.locales.de['common.save'].value, 'Speichern');
});

test('writing preserves nesting, key order, indentation and untouched keys', () => {
  const root = tempDir();
  const file = path.join(root, 'de.json');
  fs.writeFileSync(file, '{\n\t"zeta": "bleibt",\n\t"home": {\n\t\t"title": "Alt"\n\t}\n}');
  const { changed } = writeJsonFile(file, { 'home.title': 'Start', 'home.sub.text': 'Neu', zeta: 'bleibt', top: 'Oben' }, { nestedDefault: false });
  assert.equal(changed, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n\t"zeta": "bleibt",\n\t"home": {\n\t\t"title": "Start",\n\t\t"sub": {\n\t\t\t"text": "Neu"\n\t\t}\n\t},\n\t"top": "Oben"\n}');

  const flat = path.join(root, 'flat.json');
  fs.writeFileSync(flat, '{\n    "a.b": "x"\n}\n');
  writeJsonFile(flat, { 'a.b': 'y', 'c.d': 'z' }, { nestedDefault: true });
  assert.equal(fs.readFileSync(flat, 'utf8'), '{\n    "a.b": "y",\n    "c.d": "z"\n}\n');

  // Conflict: "a" is a string, so "a.b" falls back to a flat key.
  const conflict = path.join(root, 'conflict.json');
  fs.writeFileSync(conflict, '{"a": "text", "n": {"x": "1"}}');
  writeJsonFile(conflict, { 'a.b': 'deep' }, { nestedDefault: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(conflict, 'utf8')), { a: 'text', n: { x: '1' }, 'a.b': 'deep' });

  const fresh = path.join(root, 'new', 'fr.json');
  writeJsonFile(fresh, { 'home.title': 'Accueil' }, { nestedDefault: true });
  assert.equal(fs.readFileSync(fresh, 'utf8'), '{\n  "home": {\n    "title": "Accueil"\n  }\n}\n');
});
