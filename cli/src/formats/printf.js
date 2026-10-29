// printf placeholders as stored by locli (iOS style `%@`, `%lld`; Android `%1$s`, `%d`).
// Mirrors localize-backend FormatPlaceholders and AndroidResources.

const PATTERN = /%%|%(?:(\d+)\$)?[-+ #0']*\d*(?:\.\d+)?(hh|h|ll|l|q|z|t|j|L)?([@dDiuUxXoOfFeEgGaAcCsSp])/g;

/**
 * @typedef {{ index: number, type: string, raw: string }} Argument
 */

/**
 * Walks literals and arguments separately (port of FormatPlaceholders.transform).
 * @param {string} text
 * @param {(literal: string) => string} literal
 * @param {(argument: Argument) => string} argument
 */
export function transform(text, literal, argument) {
  let result = '';
  let next = 1;
  let cursor = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    result += literal(text.slice(cursor, start));
    if (match[3] !== undefined) {
      const position = match[1] !== undefined ? Number(match[1]) : undefined;
      result += argument({ index: position ?? next, type: (match[2] ?? '') + match[3], raw: match[0] });
      if (position === undefined) next += 1;
    } else {
      result += literal('%');
    }
    cursor = start + match[0].length;
  }
  return result + literal(text.slice(cursor));
}

/**
 * Argument number → type (`%i` counts as `d`). Throws on conflicting reuse.
 * @param {string} text
 * @returns {Map<number, string>}
 */
export function signature(text) {
  const result = new Map();
  transform(text, (l) => l, (arg) => {
    let type = arg.type;
    if (type.endsWith('i')) type = type.slice(0, -1) + 'd';
    const existing = result.get(arg.index);
    if (existing !== undefined && existing !== type) {
      throw new Error(`placeholder %${arg.index}$ is used as %${existing} and %${type}`);
    }
    result.set(arg.index, type);
    return '';
  });
  return result;
}

/**
 * Stored printf text → Android/Java Formatter text, unescaped (port of AndroidResources.text
 * without the XML escaping). Throws for conversions Android cannot represent.
 * @param {string} text
 */
export function toJavaFormat(text) {
  return transform(text, (l) => l.replaceAll('%', '%%'), (item) => {
    const conversion = item.type.slice(-1);
    let javaType;
    if (conversion === '@') javaType = 's';
    else if (conversion === 'i') javaType = 'd';
    else if ('doxXfeEgGaAcs'.includes(conversion)) javaType = conversion;
    else throw new Error(`Android cannot represent ${item.raw}`);
    const prefix = item.raw.replace(/^%(?:\d+\$)?/, '');
    const modifiers = prefix.slice(0, prefix.length - item.type.length);
    if (modifiers.includes("'")) throw new Error(`Android cannot represent printf grouping flag in ${item.raw}`);
    return `%${item.index}$${modifiers}${javaType}`;
  });
}
