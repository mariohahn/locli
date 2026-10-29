// Inverse of the server's ICU plural export (PluralRules.icuMessage): a top-level
// `{count, plural, one {# receipt} other {# receipts}}` becomes printf forms + selector.

const CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const SYNTAX = '{}#|\'';

/**
 * Splits ICU text into tokens, resolving apostrophe quoting (DOUBLE_OPTIONAL mode).
 * @param {string} text
 * @returns {{ type: 'literal' | 'open' | 'close' | 'hash', text: string }[] | null}
 */
function tokenize(text) {
  /** @type {{ type: 'literal' | 'open' | 'close' | 'hash', text: string }[]} */
  const tokens = [];
  const literal = (/** @type {string} */ s) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === 'literal') last.text += s; else tokens.push({ type: 'literal', text: s });
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") {
      if (text[i + 1] === "'") { literal("'"); i += 1; continue; }
      if (i + 1 < text.length && SYNTAX.includes(text[i + 1])) {
        let j = i + 1;
        let quoted = '';
        for (; j < text.length; j += 1) {
          if (text[j] === "'") {
            if (text[j + 1] === "'") { quoted += "'"; j += 1; continue; }
            break;
          }
          quoted += text[j];
        }
        literal(quoted);
        i = j;
        continue;
      }
      literal("'");
    } else if (c === '{') tokens.push({ type: 'open', text: c });
    else if (c === '}') tokens.push({ type: 'close', text: c });
    else if (c === '#') tokens.push({ type: 'hash', text: c });
    else literal(c);
  }
  return tokens;
}

/**
 * @param {string} message
 * @returns {{ forms: Record<string, string>, selector: number } | null} null when the message is
 *   not a single top-level plural the server can represent; such messages are sent as plain text.
 */
export function parseIcuPlural(message) {
  const head = /^\s*\{\s*count\s*,\s*plural\s*,/.exec(message);
  if (!head || !message.trimEnd().endsWith('}')) return null;
  const tokens = tokenize(message.trim().slice(head[0].trim().length, -1));
  if (!tokens) return null;
  /** @type {Record<string, { kind: 'text' | 'hash' | 'arg', text?: string, arg?: number, spec?: string }[]>} */
  const cases = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type !== 'literal') return null;
    const selectorText = t.text.trim();
    if (!selectorText) { i += 1; continue; }
    if (!/^(=0|zero|one|two|few|many|other)$/.test(selectorText)) return null;
    if (tokens[i + 1]?.type !== 'open') return null;
    i += 2;
    /** @type {{ kind: 'text' | 'hash' | 'arg', text?: string, arg?: number, spec?: string }[]} */
    const body = [];
    for (;;) {
      const token = tokens[i];
      if (!token) return null;
      if (token.type === 'close') { i += 1; break; }
      if (token.type === 'literal') body.push({ kind: 'text', text: token.text });
      else if (token.type === 'hash') body.push({ kind: 'hash' });
      else {
        // {argN} | {argN, number, ::precision-integer group-off} | {argN, number, ::.00 group-off}
        const inner = tokens[i + 1];
        if (inner?.type !== 'literal' || tokens[i + 2]?.type !== 'close') return null;
        const match = /^\s*arg(\d+)\s*(?:,\s*number\s*,\s*::\s*(precision-integer|\.0+)\s+group-off\s*)?$/.exec(inner.text);
        if (!match) return null;
        body.push({ kind: 'arg', arg: Number(match[1]), spec: match[2] });
        i += 2;
      }
      i += 1;
    }
    const category = selectorText === '=0' ? 'zero' : selectorText;
    if (category in cases && selectorText === 'zero') { /* `=0 {x} zero {x}` pair */ }
    cases[category] = body;
  }
  if (!cases.other || !Object.keys(cases).every((c) => CATEGORIES.has(c))) return null;
  const used = new Set();
  for (const body of Object.values(cases)) for (const part of body) if (part.kind === 'arg') used.add(part.arg);
  let selector = 1;
  while (used.has(selector)) selector += 1;
  const positional = used.size > 0;
  /** @type {Record<string, string>} */
  const forms = {};
  for (const [category, body] of Object.entries(cases)) {
    forms[category] = body.map((part) => {
      if (part.kind === 'text') return /** @type {string} */ (part.text).replaceAll('%', '%%');
      if (part.kind === 'hash') return positional ? `%${selector}$lld` : '%lld';
      if (!part.spec) return `%${part.arg}$@`;
      if (part.spec === 'precision-integer') return `%${part.arg}$lld`;
      const digits = part.spec.length - 1;
      return digits === 6 ? `%${part.arg}$f` : `%${part.arg}$.${digits}f`;
    }).join('');
  }
  return { forms, selector };
}
