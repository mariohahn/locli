// Android resources: res/values[-qualifier]/strings.xml with <string>, <plurals>, <string-array>.
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, escapeXmlText, escapeXmlAttribute } from './xml.js';
import { toJavaFormat } from './printf.js';

const NON_LOCALE_QUALIFIERS = new Set([
  'car', 'tv', 'port', 'land', 'night', 'notnight', 'desk', 'appliance', 'watch', 'vrheadset', 'television',
  'ldltr', 'ldrtl', 'long', 'notlong', 'round', 'notround', 'small', 'normal', 'large', 'xlarge', 'anydpi', 'nodpi',
]);
const LEGACY = { iw: 'he', in: 'id', ji: 'yi' };
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * `values` → null (default), `values-pt-rBR` → `pt-BR`, `values-b+sr+Latn` → `sr-Latn`,
 * other qualifiers (night, v21, sw600dp …) → undefined.
 * @param {string} dir
 * @returns {string | null | undefined}
 */
export function localeForValuesDir(dir) {
  if (dir === 'values') return null;
  if (!dir.startsWith('values-')) return undefined;
  const qualifier = dir.slice(7);
  if (qualifier.startsWith('b+')) {
    const parts = qualifier.slice(2).split('+');
    if (!/^[a-z]{2,3}$/.test(parts[0]) || parts.some((p) => !/^[A-Za-z0-9]{1,8}$/.test(p))) return undefined;
    parts[0] = LEGACY[/** @type {keyof typeof LEGACY} */ (parts[0])] ?? parts[0];
    return parts.join('-');
  }
  const match = /^([a-z]{2,3})(?:-r([A-Z]{2}))?$/.exec(qualifier);
  if (!match || NON_LOCALE_QUALIFIERS.has(match[1])) return undefined;
  const language = LEGACY[/** @type {keyof typeof LEGACY} */ (match[1])] ?? match[1];
  return match[2] ? `${language}-${match[2]}` : language;
}

/**
 * `pt-BR`/`pt-br` → `values-pt-rBR`, `sr-Latn` → `values-b+sr+Latn`, `de` → `values-de`.
 * @param {string} locale
 */
export function valuesDirForLocale(locale) {
  const parts = locale.replaceAll('_', '-').split('-').filter(Boolean);
  const language = parts[0].toLowerCase();
  if (parts.length === 1) return `values-${language}`;
  if (parts.length === 2 && /^[A-Za-z]{2}$/.test(parts[1])) return `values-${language}-r${parts[1].toUpperCase()}`;
  const rest = parts.slice(1).map((p) => (/^[A-Za-z]{4}$/.test(p) ? p[0].toUpperCase() + p.slice(1).toLowerCase() : /^[A-Za-z]{2}$/.test(p) ? p.toUpperCase() : p));
  return `values-b+${[language, ...rest].join('+')}`;
}

/**
 * Android string escaping rules after XML parsing (like aapt2): quotes keep whitespace,
 * unquoted whitespace collapses and is trimmed, backslash escapes.
 * @param {string} raw
 */
export function unescapeAndroid(raw) {
  let out = '';
  let pending = false;
  let started = false;
  let quoted = false;
  const add = (/** @type {string} */ text) => {
    if (pending && started) out += ' ';
    pending = false;
    started = true;
    out += text;
  };
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '\\') {
      const e = raw[i + 1];
      i += 1;
      if (e === undefined) break;
      if (e === 'n') add('\n');
      else if (e === 't') add('\t');
      else if (e === 'u') {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`invalid unicode escape \\u${hex}`);
        add(String.fromCharCode(parseInt(hex, 16)));
        i += 4;
      } else add(e);
    } else if (c === '"') {
      quoted = !quoted;
      if (quoted && pending && started) { out += ' '; pending = false; }
      started = started || quoted;
    } else if (quoted) {
      add(c);
    } else if (/\s/.test(c)) {
      pending = true;
    } else {
      add(c);
    }
  }
  return out;
}

/**
 * Escapes a value for an Android resource. Quotes only when whitespace would otherwise collapse.
 * @param {string} text already in Java Formatter syntax
 */
export function escapeAndroid(text) {
  let s = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll("'", "\\'")
    .replaceAll('\n', '\\n').replaceAll('\t', '\\t').replaceAll('\r', '\\u000D');
  const needsQuotes = /^\s|\s$|\s\s/.test(s);
  if (!needsQuotes && (s.startsWith('@') || s.startsWith('?'))) s = '\\' + s;
  s = escapeXmlText(s);
  return needsQuotes ? `"${s}"` : s;
}

/**
 * Stored printf value → Android text. Plain sentences without real placeholders stay as they
 * are (Android shows unformatted strings verbatim, so `%` must not become `%%`).
 * @param {string} text
 */
export function androidText(text) {
  // "50% off" would otherwise read as the space-flagged conversion "% o".
  const real = /%(?:\d+\$)?[-+#0']*\d*(?:\.\d+)?(?:hh|h|ll|l|q|z|t|j|L)?[@dDiuUxXoOfFeEgGaAcCsSp]/.test(text.replaceAll('%%', ''));
  return real ? toJavaFormat(text) : text;
}

/**
 * @param {import('./xml.js').XmlNode[]} nodes
 * @param {{ markup: boolean }} state
 */
function rawContent(nodes, state) {
  let raw = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'cdata') raw += node.text;
    else if (node.type === 'element') {
      if (node.name !== 'xliff:g') state.markup = true;
      raw += rawContent(node.children, state);
    }
  }
  return raw;
}

/**
 * @typedef {{ name: string, kind: 'string' | 'plurals' | 'array', value?: string, forms?: Record<string, string>,
 *   items?: string[], comment?: string, element: import('./xml.js').XmlElement, markup: boolean, translatable: boolean }} AndroidResource
 */

/**
 * Parses one resources file.
 * @param {string} source
 * @returns {{ resources: AndroidResource[], root: import('./xml.js').XmlElement, warnings: string[] }}
 */
export function parseAndroidResources(source) {
  const root = parseXml(source);
  if (root.name !== 'resources') throw new Error('Android resource files need a <resources> root');
  /** @type {AndroidResource[]} */
  const resources = [];
  const warnings = [];
  let comment;
  for (const node of root.children) {
    if (node.type === 'comment') { comment = node.text.trim(); continue; }
    if (node.type !== 'element') { if (node.type === 'text' && node.text.trim()) comment = undefined; continue; }
    const name = node.attributes.name;
    const translatable = node.attributes.translatable !== 'false';
    const state = { markup: false };
    if (node.name === 'string' && name) {
      const raw = rawContent(node.children, state);
      resources.push({ name, kind: 'string', value: unescapeAndroid(raw), comment, element: node, markup: state.markup, translatable });
    } else if (node.name === 'plurals' && name) {
      /** @type {Record<string, string>} */
      const forms = {};
      for (const item of node.children) {
        if (item.type !== 'element' || item.name !== 'item') continue;
        const quantity = item.attributes.quantity;
        if (!CATEGORIES.includes(quantity)) { warnings.push(`${name}: unknown plural quantity "${quantity}"`); continue; }
        forms[quantity] = unescapeAndroid(rawContent(item.children, state));
      }
      resources.push({ name, kind: 'plurals', forms, value: forms.other, comment, element: node, markup: state.markup, translatable });
    } else if (node.name === 'string-array' && name) {
      const items = node.children.filter((item) => item.type === 'element' && item.name === 'item')
        .map((item) => unescapeAndroid(rawContent(/** @type {import('./xml.js').XmlElement} */ (item).children, state)));
      resources.push({ name, kind: 'array', items, comment, element: node, markup: state.markup, translatable });
    }
    comment = undefined;
  }
  return { resources, root, warnings };
}

/**
 * Reads every locale of a `res` directory.
 * @param {string} resDir
 * @param {{ sourceLanguage: string, file?: string }} options
 * @returns {import('./model.js').LocalTexts}
 */
export function readAndroid(resDir, { sourceLanguage, file = 'strings.xml' }) {
  /** @type {import('./model.js').LocalTexts} */
  const result = { locales: {}, comments: {}, keys: [], warnings: [], kinds: {} };
  if (!fs.existsSync(resDir)) throw new Error(`Android res directory not found: ${resDir}`);
  const dirs = fs.readdirSync(resDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const keys = new Set();
  for (const dir of dirs) {
    const locale = localeForValuesDir(dir);
    if (locale === undefined) continue;
    const filePath = path.join(resDir, dir, file);
    if (!fs.existsSync(filePath)) continue;
    const code = locale ?? sourceLanguage;
    let parsed;
    try { parsed = parseAndroidResources(fs.readFileSync(filePath, 'utf8')); } catch (error) {
      throw new Error(`${path.relative(process.cwd(), filePath)}: ${/** @type {Error} */ (error).message}`);
    }
    result.warnings.push(...parsed.warnings.map((w) => `${dir}/${file}: ${w}`));
    const entries = (result.locales[code] ??= {});
    for (const resource of parsed.resources) {
      if (!resource.translatable) continue;
      if (resource.markup) { result.warnings.push(`${dir}/${file}: ${resource.name} contains markup (<b>, <a> …); skipped, keep it Android-only`); continue; }
      keys.add(resource.name);
      result.kinds[resource.name] = resource.kind;
      if (resource.comment && locale === null) result.comments[resource.name] = resource.comment;
      if (resource.kind === 'string') {
        if (!resource.value?.trim()) continue;
        entries[resource.name] = { value: resource.value, status: 'translated' };
      } else if (resource.kind === 'plurals') {
        const forms = Object.fromEntries(Object.entries(resource.forms ?? {}).filter(([, t]) => t.trim()));
        if (!forms.other) { result.warnings.push(`${dir}/${file}: ${resource.name} has no quantity="other"; skipped`); continue; }
        entries[resource.name] = { value: forms.other, status: 'translated', forms };
      } else {
        if (!resource.items?.length) continue;
        entries[resource.name] = { value: JSON.stringify(resource.items), status: 'translated', items: resource.items };
      }
    }
  }
  result.keys = [...keys].sort();
  return result;
}

/** @param {string} source @param {number} index */
function lineIndent(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const prefix = source.slice(lineStart, index);
  return /^[ \t]*$/.test(prefix) ? prefix : null;
}

/**
 * @typedef {{ name: string, kind: 'string' | 'plurals' | 'array', value?: string, forms?: Record<string, string>, items?: string[] }} AndroidOutput
 */

/** @param {AndroidOutput} entry @param {string} indent @param {string} unit */
function render(entry, indent, unit) {
  const name = escapeXmlAttribute(entry.name);
  if (entry.kind === 'plurals') {
    const items = CATEGORIES.filter((c) => entry.forms?.[c] !== undefined)
      .map((c) => `${indent}${unit}<item quantity="${c}">${escapeAndroid(androidText(/** @type {string} */ (entry.forms?.[c])))}</item>`);
    return [`<plurals name="${name}">`, ...items, `${indent}</plurals>`].join('\n');
  }
  if (entry.kind === 'array') {
    const items = (entry.items ?? []).map((item) => `${indent}${unit}<item>${escapeAndroid(androidText(item))}</item>`);
    return [`<string-array name="${name}">`, ...items, `${indent}</string-array>`].join('\n');
  }
  return `<string name="${name}">${escapeAndroid(androidText(entry.value ?? ''))}</string>`;
}

/** @param {AndroidOutput} entry @param {AndroidResource} existing */
function unchanged(entry, existing) {
  if (entry.kind !== existing.kind) return false;
  if (entry.kind === 'string') return androidText(entry.value ?? '') === existing.value;
  if (entry.kind === 'array') return JSON.stringify((entry.items ?? []).map(androidText)) === JSON.stringify(existing.items);
  const a = Object.fromEntries(Object.entries(entry.forms ?? {}).map(([k, v]) => [k, androidText(v)]));
  const b = existing.forms ?? {};
  return CATEGORIES.every((c) => a[c] === b[c]);
}

/**
 * Writes the given resources into an existing file (or a new one), touching only those
 * elements whose value changed. Other entries, comments and formatting stay as they are.
 * @param {string | null} source
 * @param {AndroidOutput[]} entries
 * @returns {{ content: string, warnings: string[], changed: number }}
 */
export function mergeAndroidResources(source, entries) {
  const warnings = [];
  if (source === null || !source.trim()) {
    const unit = '    ';
    const body = entries.map((entry) => `${unit}${render(entry, unit, unit)}`).join('\n');
    return { content: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}${body ? '\n' : ''}</resources>\n`, warnings, changed: entries.length };
  }
  const { resources, root } = parseAndroidResources(source);
  const byName = new Map(resources.map((r) => [r.name, r]));
  const first = root.children.find((n) => n.type === 'element');
  const unit = (first && lineIndent(source, first.start)) || '    ';
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  const appended = [];
  let changed = 0;
  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing) {
      if (existing.markup) { warnings.push(`${entry.name}: contains markup; left unchanged`); continue; }
      if (!existing.translatable) continue;
      if (unchanged(entry, existing)) continue;
      const indent = lineIndent(source, existing.element.start) ?? unit;
      edits.push({ start: existing.element.start, end: existing.element.end, text: render(entry, indent, unit) });
      changed += 1;
    } else {
      appended.push(`${unit}${render(entry, unit, unit)}`);
      changed += 1;
    }
  }
  if (appended.length) {
    const at = root.innerEnd;
    const before = source.slice(0, at);
    const trimmedEnd = before.replace(/[ \t]*$/, '');
    const lead = trimmedEnd.endsWith('\n') ? '' : '\n';
    edits.push({ start: trimmedEnd.length, end: at, text: `${lead}${appended.join('\n')}\n` });
  }
  let content = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
  }
  return { content, warnings, changed };
}

export { CATEGORIES };
