// Where a key is used in the code and as what (toolbar item, button, title, push notification …), so
// translators and agents know how much room a text has. Works on any stack: a key is found as a quoted
// literal (t("auth_title"), Text("auth_title"), I18n.t('auth.title')) or an Android resource reference
// (@string/auth_title, R.string.auth_title), and the role comes from the code around it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Roles from the most to the least constrained. `max` is the length budget in characters for a source
 * text of up to max/1.3 characters; roles without `max` wrap or aren't shown, so they have no budget.
 * @typedef {{ id: string, label: string, hint: string, max?: number }} Role
 * @type {Role[]}
 */
export const ROLES = [
  { id: 'toolbar', label: 'toolbar item', hint: 'one or two words', max: 12 },
  { id: 'tab', label: 'tab', hint: 'one word', max: 12 },
  { id: 'button', label: 'button', hint: 'a short verb phrase', max: 20 },
  { id: 'menu', label: 'menu item', hint: 'a few words', max: 24 },
  { id: 'title', label: 'screen title', hint: 'a short noun phrase, no period', max: 24 },
  { id: 'field', label: 'form field label or placeholder', hint: 'a few words', max: 28 },
  { id: 'notification', label: 'push notification', hint: 'the lock screen cuts it after about two lines' },
  { id: 'email', label: 'email text', hint: 'a subject stays under about 60 characters' },
  { id: 'alert', label: 'alert or dialog', hint: 'a short title, the message may wrap' },
  { id: 'error', label: 'error message', hint: 'a full sentence that says what to do' },
  { id: 'accessibility', label: 'accessibility label', hint: 'read aloud, not shown; describe, don\'t abbreviate' },
  { id: 'text', label: 'text', hint: 'may wrap' },
];
const BY_ID = new Map(ROLES.map((role) => [role.id, role]));

/**
 * Patterns per role. A pattern only counts when it encloses the key: between the match and the key no
 * bracket or tag closes that it didn't open (see `encloses`). Component names may carry a prefix, so
 * <JumpButton>, PrimaryButton( and UIButton are buttons.
 * @type {[string, RegExp][]}
 */
const RULES = [
  ['accessibility', /accessibilityLabel|accessibilityHint|accessibilityValue|contentDescription|aria-label|aria-description|\balt\s*=|setContentDescription/g],
  ['toolbar', /ToolbarItem|\.toolbar\b|UIBarButtonItem|showAsAction|<\w*Toolbar\b|\bactions\s*[=:]\s*[{[]|navigationItem\.(right|left)BarButtonItem/g],
  ['tab', /\.tabItem|UITabBarItem|NavigationBarItem|BottomNavigationItem|\bTab\s*\(|<\w*Tabs?\b|role=["']tab["']|TabsTrigger|tabBarLabel/g],
  ['notification', /UNMutableNotificationContent|NotificationCompat|setContentTitle|setContentText|\bapns\b|\bfcm\b|sendPush|pushNotification|webpush|new Notification\(/gi],
  ['email', /\bsubject\s*[:=]|sendMail|sendEmail|mailer|Mailer|\.deliver|EmailMessage|MimeMessage/g],
  ['alert', /\.alert\s*\(|UIAlertController|AlertDialog|confirmationDialog|\bconfirm\s*\(|window\.alert|Snackbar|<\w*Toast\b|\btoast\s*[.(]|<\w*Dialog\b/g],
  ['menu', /\bMenu\s*[{(]|<\w*Menu\b|\w*MenuItem\b|contextMenu|<option\b|<item\b[^>]*android:title/g],
  ['title', /navigationTitle|navigationBarTitle|navigationItem\.title|TopAppBar|setTitle\s*\(\s*(?:R\.string|getString|NSLocalizedString|String\(localized)|<h[1-3]\b|document\.title|<title>|\b(?:title|heading)\s*=\s*\{|\b(?:title|heading)\s*:\s*(?:t|i18n|intl|NSLocalizedString|String\(localized)\b/g],
  ['field', /\w*TextField\b|SecureField|TextEditor|placeholder|android:hint|\bhint\s*=|<label\b|<\w*Input\b|<\w*Field\b|<input\b|<textarea\b|labelText/g],
  ['button', /\w*Button\s*[({]|<\w*Button\b|<button\b|setTitle\s*\([^)]*for:|NavigationLink|\bLink\s*\(|<\w*Link\b|<a\b/g],
  ['error', /throw\b|\b\w*Error\s*\(|Abort\s*\(|HTTPException|\braise\b|\babort\s*\(|\bstatus\s*\(\s*[45]\d\d|BadRequest|reject\s*\(|errorMessage|\berror\s*[:=]/g],
  ['text', /\bText\s*\(|<\w*Text\b|TextView|UILabel|<p\b|<span\b|<\w*Typography\b|\bLabel\s*\(|android:text|\b(?:text|description|subtitle|message|body)\s*=\s*\{|\b(?:text|description|subtitle|message)\s*:\s*(?:t|i18n|intl)\b/g],
];

/** Backend files often say what they send in their path: mail/, notifications/, errors.py. */
const PATH_RULES = /** @type {[string, RegExp][]} */ ([
  ['email', /(^|[/_.-])(mail|mails|email|emails|mailer|mailers)([/_.-]|$)/i],
  ['notification', /(^|[/_.-])(push|notifications?|apns|fcm)([/_.-]|$)/i],
  ['error', /(^|[/_.-])(errors?|exceptions?)([/_.-]|$)/i],
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'out', '.next', '.nuxt', '.svelte-kit', 'Pods', 'Carthage', 'DerivedData',
  '.build', '.swiftpm', '.gradle', 'vendor', 'coverage', '.turbo', '.expo', 'target', '.venv', 'venv', '__pycache__', '.idea', 'tmp',
  '.agents', '.claude', 'backups']);
const CODE = /\.(swift|m|mm|kt|kts|java|ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|html|py|rb|go|php|cs|ex|exs|dart|erb|haml|slim|leaf|hbs|mustache|twig|jinja2?)$/;
const TEST = /(^|\/)(tests?|__tests__|spec|specs|[A-Za-z]*Tests|androidTest|e2e)\/|\.(test|spec)\.[a-z]+$|Tests?\.(swift|kt|java)$/;
const MAX_FILE = 512 * 1024;
const MAX_FILES = 20000;
const MAX_LINE = 1000;

/** A source file worth scanning: code, or Android layout/menu/navigation XML (not the strings files). */
function isSource(/** @type {string} */ relative) {
  if (TEST.test(relative)) return false;
  if (relative.endsWith('.xml')) return /(^|\/)res\/(layout|menu|navigation|xml)[^/]*\//.test(relative);
  return CODE.test(relative);
}

/**
 * The source files under root: from git when root is in a repository (so .gitignore'd build output
 * stays out), else by walking the tree.
 * @param {string} root @returns {string[]} paths relative to root, with /
 */
export function sourceFiles(root) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status === 0) {
    return listed.stdout.split('\0').filter((file) => file && isSource(file)
      && !file.split('/').some((part) => SKIP_DIRS.has(part) || part.startsWith('.') || part.endsWith('.xcassets'))).slice(0, MAX_FILES).sort();
  }
  return walkFiles(root);
}

/** @param {string} root */
function walkFiles(root) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.') && !entry.name.endsWith('.xcassets')) walk(full);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isFile() && isSource(relative)) files.push(relative);
    }
  };
  walk(root);
  return files.sort();
}

/** Quoted literals and Android resource references on one line. */
const LITERAL = /"((?:[^"\\\n]|\\.){1,200})"|'((?:[^'\\\n]|\\.){1,200})'|`([^`$\n]{1,200})`|(?:@string\/|@plurals\/|R\.string\.|R\.plurals\.|R\.array\.|Res\.string\.)([A-Za-z_][A-Za-z0-9_]*)/g;

/** Containers decide the room a text has: a Button inside a ToolbarItem is a toolbar item. */
const CONTAINERS = new Set(['toolbar', 'tab', 'menu', 'notification', 'email', 'alert']);

const STRINGS = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`/g;

/**
 * Whether the code from a pattern up to the key still encloses the key: what the pattern opened
 * (a bracket, a tag) is still open, so a finished <MenuItem>…</MenuItem> or title={…} before the key is
 * a sibling, not a parent. Swift's trailing closure (`ToolbarItem(…) {`) stays open. A bare attribute
 * (`android:hint="@string/x"`) encloses the value right after its `=`.
 * @param {string} code from the pattern match to the key @param {number} matchLength
 */
function encloses(code, matchLength) {
  const stripped = code.replace(STRINGS, '""');
  let depth = 0;
  let opened = false;
  for (const token of stripped.matchAll(/<\/|\/>|<[A-Za-z]|[{([]|[})\]]/g)) {
    depth += token[0] === '</' || token[0] === '/>' || '})]'.includes(token[0]) ? -1 : 1;
    if (depth < 0) return false;
    if (depth > 0) opened = true;
    else if (opened && !/^\s*\{/.test(stripped.slice(/** @type {number} */ (token.index) + token[0].length))) return false;
  }
  return depth > 0 || (!opened && /^[\s=:]*$/.test(code.slice(matchLength)));
}

/**
 * The role of the usage at column `column` of line `at`: an accessibility label around the key wins,
 * then the nearest enclosing container (toolbar, tab, menu …) on the line or up to four lines above,
 * then the nearest enclosing element (button, title, field …), then what the file's path says.
 */
export function roleAt(/** @type {string[]} */ lines, /** @type {number} */ at, /** @type {string} */ file, column = lines[at]?.length ?? 0) {
  const first = Math.max(0, at - 4);
  const window = [...lines.slice(first, at), lines[at].slice(0, column)].join('\n');
  const lineStart = window.length - column;
  /** @param {(id: string) => boolean} which @param {boolean} sameLineOnly */
  const nearest = (which, sameLineOnly) => {
    let best = /** @type {{ id: string, at: number } | null} */ (null);
    for (const [id, pattern] of RULES) {
      if (!which(id)) continue;
      for (const match of window.matchAll(pattern)) {
        const index = /** @type {number} */ (match.index);
        if (sameLineOnly && index < lineStart) continue;
        if (!encloses(window.slice(index), match[0].length)) continue;
        if (!best || index > best.at) best = { id, at: index };
      }
    }
    return best?.id ?? null;
  };
  return nearest((id) => id === 'accessibility', true)
    ?? nearest((id) => CONTAINERS.has(id), false)
    ?? nearest((id) => !CONTAINERS.has(id) && id !== 'accessibility', true)
    ?? PATH_RULES.find(([, pattern]) => pattern.test(file))?.[0]
    ?? nearest((id) => !CONTAINERS.has(id) && id !== 'accessibility', false);
}

/**
 * Finds every use of `keys` in the source files under `root`.
 * @param {string} root @param {Iterable<string>} keys
 * @returns {Map<string, { file: string, line: number, role: string | null }[]>}
 */
export function scanUsages(root, keys) {
  const wanted = new Set(keys);
  /** @type {Map<string, { file: string, line: number, role: string | null }[]>} */
  const found = new Map();
  if (!wanted.size) return found;
  for (const file of sourceFiles(root)) {
    let source;
    try {
      const full = path.join(root, file);
      if (fs.statSync(full).size > MAX_FILE) continue;
      source = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    const lines = source.split('\n');
    for (let at = 0; at < lines.length; at += 1) {
      if (lines[at].length > MAX_LINE) continue; // minified or generated
      for (const match of lines[at].matchAll(LITERAL)) {
        // android:text="@string/x" is a quoted literal holding a resource reference.
        const raw = (match[1] ?? match[2] ?? match[3] ?? match[4]).replace(/^@\+?(?:string|plurals|array)\//, '');
        const key = wanted.has(raw) ? raw : raw.includes('\\') && wanted.has(unescape(raw)) ? unescape(raw) : null;
        if (!key) continue;
        const list = found.get(key) ?? [];
        if (!list.some((u) => u.file === file && u.line === at + 1)) list.push({ file, line: at + 1, role: roleAt(lines, at, file, match.index) });
        found.set(key, list);
      }
    }
  }
  return found;
}

const unescape = (/** @type {string} */ text) => text.replace(/\\(.)/g, '$1');

/**
 * One key's context: its most constrained role across all uses and the length budget for that role.
 * @param {{ file: string, line: number, role: string | null }[]} uses @param {string} [source] the source-language text
 */
export function keyContext(uses, source = '') {
  const roles = [...new Set(uses.map((u) => u.role).filter(Boolean))];
  const role = ROLES.find((r) => roles.includes(r.id)) ?? null;
  const length = [...(source ?? '')].length;
  const maxChars = role?.max ? Math.max(role.max, Math.ceil(length * 1.3)) : null;
  return { role: role?.id ?? null, label: role?.label ?? null, hint: role?.hint ?? null, roles, maxChars, uses };
}

/**
 * The translator comment push writes for keys nobody described yet. It starts with "Used as" so a
 * later push can refresh it when the code changes, while comments people wrote stay untouched.
 * @param {ReturnType<typeof keyContext>} context
 */
export function autoComment(context) {
  if (!context.role) return null;
  const role = /** @type {Role} */ (BY_ID.get(context.role));
  const article = /^[aeiou]/i.test(role.label) ? 'an' : 'a';
  return `Used as ${article} ${role.label}: ${role.hint}${context.maxChars ? `, at most about ${context.maxChars} characters` : ''}.`;
}

export const isAutoComment = (/** @type {string | null | undefined} */ comment) => /^Used as an? /.test(comment ?? '');

/** @param {string | null} role */
export const roleOf = (role) => (role ? BY_ID.get(role) ?? null : null);
