// Web/backend JSON message files: one file per locale, flat or nested, ICU MessageFormat values.
import fs from 'node:fs';
import path from 'node:path';
import { parseIcuPlural } from './icu.js';
import { writeFileIfChanged, LocliError } from '../util.js';

const LOCALE_PATTERN = '([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)';

/**
 * Lists locale files for a `{locale}` path pattern, e.g. `messages/{locale}.json` or
 * `public/locales/{locale}/common.json`. Returns locale → absolute file path.
 * @param {string} root directory the pattern is relative to
 * @param {string} pattern
 * @returns {Record<string, string>}
 */
export function findLocaleFiles(root, pattern) {
  if (!pattern.includes('{locale}')) throw new LocliError(`JSON target path needs a {locale} placeholder: ${pattern}`);
  const segments = pattern.split('/').filter((s) => s && s !== '.');
  /** @type {Record<string, string>} */
  const result = {};
  /** @param {string} dir @param {number} index @param {string | undefined} locale */
  const walk = (dir, index, locale) => {
    if (index === segments.length) {
      if (locale && fs.existsSync(dir) && fs.statSync(dir).isFile()) result[locale] = dir;
      return;
    }
    const segment = segments[index];
    if (!segment.includes('{locale}')) { walk(path.join(dir, segment), index + 1, locale); return; }
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    const [before, after] = segment.split('{locale}');
    const regex = new RegExp(`^${escapeRegex(before)}${LOCALE_PATTERN}${escapeRegex(after)}$`);
    for (const name of names.sort()) {
      const match = regex.exec(name);
      if (match && (!locale || locale === match[1])) walk(path.join(dir, name), index + 1, match[1]);
    }
  };
  walk(root, 0, undefined);
  return result;
}

/** @param {string} s */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} root @param {string} pattern @param {string} locale */
export function localeFilePath(root, pattern, locale) {
  return path.join(root, pattern.replaceAll('{locale}', locale));
}

/**
 * Flattens nested objects with `.`. Non-string leaves are reported, not sent.
 * @param {any} object @param {string} [prefix] @param {Record<string, string>} [out] @param {string[]} [skipped]
 */
export function flatten(object, prefix = '', out = {}, skipped = []) {
  for (const [key, value] of Object.entries(object)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out, skipped);
    else if (typeof value === 'string') out[full] = value;
    else skipped.push(full);
  }
  return out;
}

/**
 * Reads every locale file of a JSON target.
 * @param {string} root @param {{ path: string, keyPrefix?: string }} target
 * @returns {import('./model.js').LocalTexts}
 */
export function readJsonTarget(root, target) {
  /** @type {import('./model.js').LocalTexts} */
  const result = { locales: {}, comments: {}, keys: [], warnings: [], pluralArguments: {} };
  const keys = new Set();
  const prefix = target.keyPrefix ? `${target.keyPrefix}.` : '';
  for (const [locale, file] of Object.entries(findLocaleFiles(root, target.path))) {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
      throw new LocliError(`${file}: invalid JSON (${/** @type {Error} */ (error).message})`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LocliError(`${file}: expected a JSON object of messages`);
    const skipped = [];
    const flat = flatten(data, '', {}, skipped);
    if (skipped.length) result.warnings.push(`${path.basename(file)}: skipped non-text values ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}`);
    const entries = (result.locales[locale] ??= {});
    for (const [rawKey, value] of Object.entries(flat)) {
      const key = prefix + rawKey;
      keys.add(key);
      if (!value.trim()) continue;
      const plural = parseIcuPlural(value);
      if (plural) {
        entries[key] = { value: plural.forms.other, status: 'translated', forms: plural.forms, selector: plural.selector };
        /** @type {Record<string, number>} */ (result.pluralArguments)[key] = plural.selector;
      } else {
        entries[key] = { value, status: 'translated' };
      }
    }
  }
  result.keys = [...keys].sort();
  return result;
}

/** @param {string} text */
function detectIndent(text) {
  const match = /^\{\s*\n([ \t]+)\S/.exec(text);
  return match ? match[1] : '  ';
}

/** @param {any} object */
function isNested(object) {
  return Object.values(object).some((v) => v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Sets the given flat messages into a parsed file, keeping its shape: nested files get nested
 * keys (falling back to a flat dotted key on conflicts), flat files flat keys. Existing key order
 * is kept, new keys are appended. Keys not in `messages` stay untouched.
 * @param {any} data @param {Record<string, string>} messages @param {boolean} nested
 * @returns {number} number of changed messages
 */
export function applyMessages(data, messages, nested) {
  let changed = 0;
  for (const [key, value] of Object.entries(messages)) {
    if (Object.prototype.hasOwnProperty.call(data, key) && typeof data[key] === 'string') {
      if (data[key] !== value) { data[key] = value; changed += 1; }
      continue;
    }
    if (nested) {
      const parts = key.split('.');
      let node = data;
      let ok = true;
      for (const part of parts.slice(0, -1)) {
        if (!Object.prototype.hasOwnProperty.call(node, part)) node[part] = {};
        else if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) { ok = false; break; }
        node = node[part];
      }
      const last = parts[parts.length - 1];
      if (ok && (!Object.prototype.hasOwnProperty.call(node, last) || typeof node[last] === 'string')) {
        if (node[last] !== value) { node[last] = value; changed += 1; }
        continue;
      }
    }
    if (data[key] !== value) { data[key] = value; changed += 1; }
  }
  return changed;
}

/**
 * Writes one locale file from exported messages.
 * @param {string} file @param {Record<string, string>} messages @param {{ nestedDefault: boolean, indent?: string }} style
 * @returns {{ written: boolean, changed: number }}
 */
export function writeJsonFile(file, messages, style) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  let data = {};
  if (text !== null && text.trim()) {
    try { data = JSON.parse(text); } catch (error) {
      throw new LocliError(`${file}: invalid JSON (${/** @type {Error} */ (error).message})`);
    }
  }
  const nested = text !== null && text.trim() ? isNested(data) : style.nestedDefault;
  const changed = applyMessages(data, messages, nested);
  const indent = text ? detectIndent(text) : style.indent ?? '  ';
  const trailing = text === null || text.endsWith('\n') ? '\n' : '';
  const content = JSON.stringify(data, null, indent) + trailing;
  return { written: writeFileIfChanged(file, content), changed };
}

export { isNested };
