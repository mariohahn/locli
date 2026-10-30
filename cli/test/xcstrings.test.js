import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { units, pluralArguments, mergeCatalog, formatCatalog, localizationUnits } from '../src/formats/xcstrings.js';
import { tempDir } from './helpers.js';

const PYTHON_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/localize-ios.py');

const unit = (value, state = 'translated') => ({ stringUnit: { state, value } });
export const catalog = {
  sourceLanguage: 'en',
  version: '1.0',
  strings: {
    'account.login': { comment: 'Login button', extractionState: 'manual', localizations: { en: unit('Sign in'), de: unit('Anmelden', 'needs_review') } },
    receipt_count: { localizations: { en: { variations: { plural: { one: unit('%lld receipt'), other: unit('%lld receipts') } } }, de: { variations: { plural: { one: unit('%lld Beleg'), other: unit('%lld Belege') } } } } },
    owner_receipts: {
      localizations: {
        en: { stringUnit: { state: 'translated', value: '%#@count@' }, substitutions: { count: { argNum: 2, formatSpecifier: 'lld', variations: { plural: { one: unit('%1$@ has %arg receipt (100%%)'), other: unit('%1$@ has %arg receipts') } } } } },
      },
    },
    'Ünïcode “quotes”': { localizations: { en: unit('Grüße\n"zitiert" / \\ \t emoji 🎉') } },
    '10': { localizations: { en: unit('ten') } },
    '2': { localizations: { en: unit('two') } },
    local_only: { comment: 'kept', localizations: {} },
  },
};

const remote = {
  sourceLanguage: 'en',
  version: '1.0',
  strings: {
    'account.login': { comment: 'Imported', extractionState: 'manual', localizations: { de: unit('Einloggen') } },
    new_key: { comment: 'From locli', extractionState: 'manual', localizations: { en: unit('New'), 'pt-br': unit('Novo') } },
  },
};

test('units and plural arguments match the Python CLI semantics', () => {
  const result = units(catalog);
  assert.deepEqual(result.en['account.login'], { value: 'Sign in', status: 'translated' });
  assert.deepEqual(result.de['account.login'], { value: 'Anmelden', status: 'draft' });
  assert.deepEqual(result.en.receipt_count.forms, { one: '%lld receipt', other: '%lld receipts' });
  // %arg expands to the selected argument; %% stays literal.
  assert.equal(result.en.owner_receipts.forms.one, '%1$@ has %2$lld receipt (100%%)');
  assert.equal(result.en.owner_receipts.value, '%1$@ has %2$lld receipts');
  assert.deepEqual(pluralArguments(catalog), { owner_receipts: 2 });
});

test('unsupported shapes are rejected before any data is lost', () => {
  assert.throws(() => localizationUnits({ variations: { device: {} } }, 'k (en)'), /unsupported plural variation/);
  assert.throws(() => localizationUnits({ stringUnit: { value: '  ' } }, 'k (en)'), /empty or invalid/);
  assert.throws(() => localizationUnits({ stringUnit: {}, substitutions: { a: {}, b: {} } }, 'k (en)'), /only one plural substitution/);
  assert.throws(() => units({ version: '2.0', strings: {}, sourceLanguage: 'en' }), /Unsupported String Catalog version/);
  const conflicting = structuredClone(catalog);
  conflicting.strings.owner_receipts.localizations.de = structuredClone(conflicting.strings.owner_receipts.localizations.en);
  conflicting.strings.owner_receipts.localizations.de.substitutions.count.argNum = 1;
  assert.throws(() => pluralArguments(conflicting), /conflicting plural selectors/);
});

test('merge keeps local-only keys and comments, maps locale spelling, refuses empty catalogs', () => {
  const local = structuredClone(catalog);
  local.strings.x = { localizations: { 'pt-BR': unit('x') } };
  mergeCatalog(local, remote);
  assert.equal(local.strings['account.login'].comment, 'Login button');
  assert.deepEqual(local.strings['account.login'].localizations.de, unit('Einloggen'));
  assert.deepEqual(local.strings['account.login'].localizations.en, unit('Sign in'));
  assert.equal(local.strings.new_key.extractionState, 'manual');
  assert.equal(local.strings.new_key.comment, 'From locli');
  assert.ok(local.strings.new_key.localizations['pt-BR'], 'remote pt-br is written as the local pt-BR');
  assert.ok(local.strings.local_only);
  assert.throws(() => mergeCatalog(structuredClone(catalog), { ...remote, strings: {} }), /Refusing an empty catalog/);
  assert.throws(() => mergeCatalog(structuredClone(catalog), { ...remote, sourceLanguage: 'de' }), /changed source language/);
});

test('catalog output is byte-identical to the Python CLI (json.dumps indent=2, sort_keys, ensure_ascii=False)', (t) => {
  const python = spawnSync('python3', ['--version']);
  if (python.status !== 0 || !fs.existsSync(PYTHON_CLI)) { t.skip('python3 or scripts/localize-ios.py not available'); return; }
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(dir, 'remote.json'), JSON.stringify(remote));
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cli", sys.argv[1]); cli = importlib.util.module_from_spec(spec); spec.loader.exec_module(cli)
catalog = json.load(open(sys.argv[2])); remote = json.load(open(sys.argv[3]))
u = cli.units(catalog)
out = {"units": {loc: {k: [v[0], v[1], v[2]] for k, v in e.items()} for loc, e in u.items()}, "plural": cli.plural_arguments(catalog)}
cli.units(remote)
for key, entry in remote["strings"].items():
    local = catalog["strings"].setdefault(key, {"extractionState": "manual", "localizations": {}})
    if not local.get("comment") and entry.get("comment") and entry["comment"] != "Imported":
        local["comment"] = entry["comment"]
    local.setdefault("localizations", {}).update(entry["localizations"])
out["content"] = json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True) + "\\n"
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync('python3', ['-I', '-c', script, PYTHON_CLI, path.join(dir, 'catalog.json'), path.join(dir, 'remote.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const expected = JSON.parse(result.stdout);
  const js = units(catalog);
  for (const [locale, entries] of Object.entries(expected.units)) {
    for (const [key, [value, status, forms]] of Object.entries(entries)) {
      assert.deepEqual([js[locale][key].value, js[locale][key].status, js[locale][key].forms ?? null], [value, status, forms], `${locale}/${key}`);
    }
  }
  assert.deepEqual(pluralArguments(catalog), expected.plural);
  // Python does not remap locale spelling; use a remote whose codes already match.
  const merged = mergeCatalog(structuredClone(catalog), remote);
  merged.strings.new_key.localizations = { en: unit('New'), 'pt-br': unit('Novo') };
  assert.equal(formatCatalog(merged), expected.content);
});

test('catalogs of version 1.x are read; another major version is refused by name', () => {
  for (const version of ['1.0', '1.1']) {
    assert.equal(units({ sourceLanguage: 'en', version, strings: { a: { localizations: { en: unit('A') } } } }).en.a.value, 'A');
  }
  assert.throws(() => units({ sourceLanguage: 'en', version: '2.0', strings: {} }), /Unsupported String Catalog version "2.0"/);
  assert.throws(() => units({ sourceLanguage: 'en', strings: {} }), /Unsupported String Catalog version null/);
});
