// A small, dependency-free XML reader for Android resource files. It keeps source offsets so
// writers can splice single elements and leave everything else byte-for-byte unchanged.

/**
 * @typedef {{ type: 'element', name: string, attributes: Record<string, string>, children: XmlNode[],
 *   start: number, end: number, innerStart: number, innerEnd: number, selfClosing: boolean }} XmlElement
 * @typedef {{ type: 'text', text: string, raw: string, start: number, end: number }} XmlText
 * @typedef {{ type: 'cdata', text: string, start: number, end: number }} XmlCData
 * @typedef {{ type: 'comment', text: string, start: number, end: number }} XmlComment
 * @typedef {XmlElement | XmlText | XmlCData | XmlComment} XmlNode
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} raw */
export function decodeEntities(raw) {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new Error(`Invalid character reference ${whole}`);
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED)) throw new Error(`Unknown XML entity ${whole}`);
    return NAMED[/** @type {keyof typeof NAMED} */ (body)];
  });
}

/**
 * Parses an XML document and returns the root element.
 * @param {string} source
 * @returns {XmlElement}
 */
export function parseXml(source) {
  let i = 0;
  /** @type {XmlElement} */
  const doc = { type: 'element', name: '#document', attributes: {}, children: [], start: 0, end: source.length, innerStart: 0, innerEnd: source.length, selfClosing: false };
  /** @type {XmlElement[]} */
  const stack = [doc];
  const fail = (/** @type {string} */ message) => {
    const line = source.slice(0, i).split('\n').length;
    throw new Error(`XML line ${line}: ${message}`);
  };
  while (i < source.length) {
    const parent = stack[stack.length - 1];
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      if (close < 0) fail('unterminated comment');
      parent.children.push({ type: 'comment', text: source.slice(i + 4, close), start: i, end: close + 3 });
      i = close + 3;
    } else if (source.startsWith('<![CDATA[', i)) {
      const close = source.indexOf(']]>', i + 9);
      if (close < 0) fail('unterminated CDATA section');
      parent.children.push({ type: 'cdata', text: source.slice(i + 9, close), start: i, end: close + 3 });
      i = close + 3;
    } else if (source.startsWith('<?', i)) {
      const close = source.indexOf('?>', i + 2);
      if (close < 0) fail('unterminated processing instruction');
      i = close + 2;
    } else if (source.startsWith('<!', i)) {
      fail('document types are not supported');
    } else if (source.startsWith('</', i)) {
      const close = source.indexOf('>', i);
      if (close < 0) fail('unterminated end tag');
      const name = source.slice(i + 2, close).trim();
      if (parent === doc || parent.name !== name) fail(`unexpected </${name}>`);
      parent.innerEnd = i;
      parent.end = close + 1;
      stack.pop();
      i = close + 1;
    } else if (source[i] === '<') {
      const start = i;
      i += 1;
      const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(source.slice(i, i + 200));
      if (!nameMatch) fail('invalid element name');
      const name = nameMatch[0];
      i += name.length;
      /** @type {Record<string, string>} */
      const attributes = {};
      for (;;) {
        while (/\s/.test(source[i] ?? '')) i += 1;
        if (source.startsWith('/>', i) || source[i] === '>') break;
        const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(source.slice(i));
        if (!attr) fail(`invalid attribute in <${name}>`);
        attributes[attr[1]] = decodeEntities(attr[3] ?? attr[4] ?? '');
        i += attr[0].length;
      }
      const selfClosing = source.startsWith('/>', i);
      i += selfClosing ? 2 : 1;
      /** @type {XmlElement} */
      const element = { type: 'element', name, attributes, children: [], start, end: i, innerStart: i, innerEnd: i, selfClosing };
      parent.children.push(element);
      if (!selfClosing) stack.push(element);
    } else {
      const next = source.indexOf('<', i);
      const end = next < 0 ? source.length : next;
      const raw = source.slice(i, end);
      parent.children.push({ type: 'text', text: decodeEntities(raw), raw, start: i, end });
      i = end;
    }
  }
  if (stack.length > 1) fail(`unclosed <${stack[stack.length - 1].name}>`);
  const root = doc.children.find((node) => node.type === 'element');
  if (!root || root.type !== 'element') throw new Error('XML document has no root element');
  return root;
}

/** @param {string} text */
export function escapeXmlText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @param {string} text */
export function escapeXmlAttribute(text) {
  return escapeXmlText(text).replaceAll('"', '&quot;');
}
