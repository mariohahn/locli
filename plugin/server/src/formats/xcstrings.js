// Apple String Catalogs, ported from scripts/localize-ios.py (plain and single-selector plural entries).
import fs from 'node:fs';
import { pythonJson, writeFileIfChanged, matchLocale, LocliError } from '../util.js';

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const FORMAT_SPECIFIERS = ['d', 'i', 'u', 'ld', 'li', 'lu', 'lld', 'lli', 'llu', 'zd', 'zu'];

const isObject = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysEqual = (/** @type {object} */ o, /** @type {string[]} */ keys) => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};

/**
 * Returns [units, forms, explicit selector]. Rejects unsupported shapes before losing data.
 * @param {unknown} localization @param {string} context
 * @returns {[any[], Record<string, string> | null, number | null]}
 */
export function localizationUnits(localization, context) {
  if (!isObject(localization)) throw new LocliError(`${context}: invalid localization`);
  const loc = /** @type {Record<string, any>} */ (localization);
  let selector = null;
  let wrapper = null;
  let substitution = null;
  let cases = null;
  let items;
  if (keysEqual(loc, ['stringUnit'])) {
    items = [loc.stringUnit];
  } else {
    let variations;
    if (keysEqual(loc, ['variations'])) {
      variations = loc.variations;
    } else if (keysEqual(loc, ['stringUnit', 'substitutions'])) {
      const substitutions = loc.substitutions;
      if (!isObject(substitutions) || Object.keys(substitutions).length !== 1) {
        throw new LocliError(`${context}: only one plural substitution is supported`);
      }
      const [name, sub] = Object.entries(substitutions)[0];
      substitution = sub;
      wrapper = loc.stringUnit;
      if (!isObject(sub) || !keysEqual(sub, ['argNum', 'formatSpecifier', 'variations']) || !isObject(wrapper) || wrapper.value !== `%#@${name}@`) {
        throw new LocliError(`${context}: unsupported substitution structure`);
      }
      selector = sub.argNum;
      if (!Number.isInteger(selector) || typeof selector === 'boolean' || selector < 1 || selector > 20 || !FORMAT_SPECIFIERS.includes(sub.formatSpecifier)) {
        throw new LocliError(`${context}: invalid plural selector`);
      }
      variations = sub.variations;
    } else {
      throw new LocliError(`${context}: device variations and nested substitutions are not supported`);
    }
    if (!isObject(variations) || !keysEqual(variations, ['plural'])) throw new LocliError(`${context}: unsupported plural variation`);
    cases = variations.plural;
    if (!isObject(cases) || !Object.keys(cases).every((c) => PLURAL_CATEGORIES.includes(c)) || !('other' in cases)
      || Object.values(cases).some((c) => !isObject(c) || !keysEqual(c, ['stringUnit']))) {
      throw new LocliError(`${context}: unsupported plural variation (needs flat categories incl. other)`);
    }
    items = Object.values(cases).map((c) => c.stringUnit);
  }
  if (items.some((unit) => !isObject(unit) || typeof unit.value !== 'string' || !unit.value.trim())) {
    throw new LocliError(`${context}: empty or invalid translation unit`);
  }
  /** @type {Record<string, string> | null} */
  let forms = cases ? Object.fromEntries(Object.entries(cases).map(([c, v]) => [c, v.stringUnit.value])) : null;
  if (forms && selector !== null && substitution) {
    // Xcode may spell the selected argument as %arg inside a substitution; %%arg is literal text.
    const replacement = `%${selector}$${substitution.formatSpecifier}`;
    forms = Object.fromEntries(Object.entries(forms).map(([c, text]) => [c, text.replace(/%%|%arg/g, (m) => (m === '%%' ? '%%' : replacement))]));
  }
  return [items.concat(wrapper ? [wrapper] : []), forms, selector];
}

/** @param {unknown} catalog */
function validateCatalog(catalog) {
  const c = /** @type {any} */ (catalog);
  if (!isObject(c) || !isObject(c.strings) || typeof c.sourceLanguage !== 'string' || !c.sourceLanguage.trim()) {
    throw new LocliError('Invalid String Catalog (requires version, sourceLanguage and a strings object)');
  }
  // Xcode writes 1.0 or, since Xcode 26, 1.1; a new major version could change the format.
  if (typeof c.version !== 'string' || !/^1\.\d+$/.test(c.version)) {
    throw new LocliError(`Unsupported String Catalog version ${JSON.stringify(c.version ?? null)} (locli reads 1.x)`);
  }
}

/**
 * locale → key → entry. `forms` is set for "Vary by Plural" entries.
 * @param {any} catalog
 * @returns {Record<string, Record<string, import('./model.js').LocalEntry>>}
 */
export function units(catalog) {
  validateCatalog(catalog);
  /** @type {Record<string, Record<string, import('./model.js').LocalEntry>>} */
  const result = {};
  for (const [key, entry] of Object.entries(catalog.strings)) {
    if (!key.trim() || !isObject(entry) || !isObject(/** @type {any} */ (entry).localizations ?? {})) throw new LocliError('Invalid catalog entry');
    for (const [locale, localization] of Object.entries(/** @type {any} */ (entry).localizations ?? {})) {
      if (!locale.trim()) throw new LocliError(`${key}: invalid locale`);
      const [items, forms] = localizationUnits(localization, `${key} (${locale})`);
      const value = forms ? forms.other : items[0].value;
      const status = items.every((unit) => unit.state === 'translated') ? 'translated' : 'draft';
      (result[locale] ??= {})[key] = forms ? { value, status, forms } : { value, status };
    }
  }
  return result;
}

/** @param {any} catalog @returns {Record<string, number>} */
export function pluralArguments(catalog) {
  /** @type {Record<string, number>} */
  const result = {};
  for (const [key, entry] of Object.entries(catalog.strings)) {
    for (const [locale, localization] of Object.entries(/** @type {any} */ (entry).localizations ?? {})) {
      const [, , selector] = localizationUnits(localization, `${key} (${locale})`);
      if (selector !== null) {
        if (key in result && result[key] !== selector) throw new LocliError(`${key}: conflicting plural selectors across languages`);
        result[key] = selector;
      }
    }
  }
  return result;
}

/** @param {string} file */
export function readCatalogFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch {
    throw new LocliError(`String Catalog not found: ${file}. Create it in Xcode first (File > New > String Catalog).`);
  }
  try { return JSON.parse(text); } catch (error) {
    throw new LocliError(`${file}: invalid JSON (${/** @type {Error} */ (error).message})`);
  }
}

/**
 * @param {string} file
 * @returns {import('./model.js').LocalTexts & { catalog: any }}
 */
export function readXcstrings(file) {
  const catalog = readCatalogFile(file);
  const locales = units(catalog);
  const selectors = pluralArguments(catalog);
  /** @type {Record<string, string>} */
  const comments = {};
  for (const [key, entry] of Object.entries(catalog.strings)) {
    const comment = String(/** @type {any} */ (entry).comment ?? '').trim();
    if (comment && comment !== 'Imported') comments[key] = comment;
  }
  return { catalog, sourceLanguage: catalog.sourceLanguage, locales, comments, keys: Object.keys(catalog.strings).sort(), warnings: [], pluralArguments: selectors };
}

/** Serialises like the Python CLI: sorted keys, two-space indent, trailing newline. @param {any} catalog */
export function formatCatalog(catalog) {
  return pythonJson(catalog) + '\n';
}

/**
 * Merges a remote catalog (export/ios?format=xcstrings) into the local one, like `pull` in Python:
 * remote localizations replace local ones per key/locale; local-only keys, comments and metadata stay.
 * @param {any} catalog local catalog (mutated)
 * @param {any} remote
 */
export function mergeCatalog(catalog, remote) {
  units(remote);
  if (String(remote.sourceLanguage ?? '').toLowerCase() !== String(catalog.sourceLanguage).toLowerCase() || !isObject(remote.strings) || !Object.keys(remote.strings).length) {
    throw new LocliError('Refusing an empty catalog or a changed source language');
  }
  pluralArguments(remote);
  // locli lowercases locale codes; keep the spelling the local catalog already uses.
  const localCodes = new Set([catalog.sourceLanguage]);
  for (const entry of Object.values(catalog.strings)) for (const code of Object.keys(/** @type {any} */ (entry).localizations ?? {})) localCodes.add(code);
  for (const [key, entry] of Object.entries(/** @type {Record<string, any>} */ (remote.strings))) {
    const local = (catalog.strings[key] ??= { extractionState: 'manual', localizations: {} });
    // "Imported" is locli's placeholder for missing context, not a catalog comment.
    if (!local.comment && entry.comment && entry.comment !== 'Imported') local.comment = entry.comment;
    local.localizations ??= {};
    for (const [code, localization] of Object.entries(entry.localizations ?? {})) {
      local.localizations[matchLocale(localCodes, code) ?? code] = localization;
    }
  }
  return catalog;
}

/** @param {string} file @param {any} catalog */
export function writeCatalog(file, catalog) {
  return writeFileIfChanged(file, formatCatalog(catalog));
}
