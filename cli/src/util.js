import fs from 'node:fs';
import path from 'node:path';

/** An error with a user/agent-facing message and an exit code (1 error, 2 usage). */
export class LocliError extends Error {
  /** @param {string} message @param {number} [exitCode] */
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** @param {string} code */
export function normalizeLocale(code) {
  return code.trim().replaceAll('_', '-').toLowerCase();
}

/**
 * Finds the code in `codes` matching `code` case-insensitively.
 * @param {Iterable<string>} codes @param {string} code
 */
export function matchLocale(codes, code) {
  const wanted = normalizeLocale(code);
  for (const candidate of codes) if (normalizeLocale(candidate) === wanted) return candidate;
  return undefined;
}

/** @param {string} value */
export function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** @param {string} code */
export function localeName(code) {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replaceAll('_', '-'));
    if (name && name !== code) return name;
  } catch { /* unknown tag */ }
  return code;
}

/** Writes `content` atomically, only when it differs. Returns true when the file changed. */
export function writeFileIfChanged(/** @type {string} */ file, /** @type {string} */ content) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return false;
  } catch { /* new file */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, content);
  try {
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return true;
}

/**
 * JSON like Python's `json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)`.
 * @param {unknown} value
 */
export function pythonJson(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map((v) => inner + pythonJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints);
    if (!keys.length) return '{}';
    const inner = indent + '  ';
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${pythonJson(record[k], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Python sorts str by code point; JS by UTF-16 unit. @param {string} a @param {string} b */
export function compareCodePoints(a, b) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/** @param {number} n @param {string} one @param {string} [many] */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** A key's area is its first segment, as the web app groups it: account_logout and account.logout → account. */
export const areaOf = (/** @type {string} */ key) => key.split(/[._]/).find((part) => part.trim())?.trim() || key;
