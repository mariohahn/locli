// `locli mcp`: a stdio MCP server (JSON-RPC 2.0, newline-delimited). Logs go to stderr only.
import readline from 'node:readline';
import { createContext } from './context.js';
import { status } from './commands/status.js';
import { push } from './commands/push.js';
import { pull } from './commands/pull.js';
import { findTexts, addTexts } from './commands/texts.js';
import { guide } from './commands/guide.js';
import { areas } from './commands/areas.js';
import { context } from './commands/context.js';
import { VERSION } from './version.js';

export const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED = [PROTOCOL_VERSION, '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `locli manages this app's user-facing texts. When you build a feature, call locli_areas with the feature's name first: it tells you the existing area to use
(or the new one to start) so its keys group together. Before adding a text, call locli_find_texts to reuse a key with the same meaning.
Before translating, call locli_guide: follow its tone per language and glossary, and fix every glossary issue it lists.
Call locli_context too: it says where each key is used (toolbar item, button, title, push notification …) and how long its text may be.
New texts: add them to the app's source-language file and call locli_push (or call locli_add_texts directly). Existing texts are never overwritten;
they are changed in locli. New texts reach the app only after a project owner approves a release; then call locli_pull. Never approve releases yourself.
If a tool says "Not logged in", ask the user to run \`npx @locli/cli login\`.`;

const platforms = { type: 'array', items: { type: 'string', enum: ['ios', 'android', 'web', 'backend'] } };

export const TOOLS = [
  {
    name: 'locli_status',
    title: 'locli status',
    description: 'Project overview from locli.json: languages, missing texts per language, open Git features and whether unreleased changes wait for release approval. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'locli_areas',
    title: 'Feature areas',
    description: 'The project\'s feature areas (a key\'s first segment, e.g. login in login_username_label) with key counts and examples. With feature="login" it returns the existing area to use (by name or synonym such as auth/signin) or proposes a new one, which the first push of keys with that prefix creates. Call it when you start building a feature. Read-only.',
    inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'The feature you are building, e.g. "login" or "receipt import".' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'locli_guide',
    title: 'Translation guide',
    description: 'The project\'s translation guide: tone and form of address per language, glossary terms with their required translation, terms that stay as written (keep), and every current translation that breaks the glossary. Read it before translating. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'locli_context',
    title: 'Where texts are used',
    description: 'Scans the app\'s code for every key in locli.json\'s files: where it is used (file:line), as what (toolbar item, tab, button, menu item, screen title, form field, push notification, email, alert, error message, accessibility label, text) and its length budget in characters. Lists translations in the files that exceed their budget and keys not found in the code. Call it before translating and fix every too-long text (shorter wording, or a layout that wraps). Local, read-only.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Only this key, or every key of this area (e.g. "auth").' }, target: { type: 'string', description: 'Only this platform.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'locli_find_texts',
    title: 'Find existing texts',
    description: 'Search existing keys, translator comments and values (case-insensitive, all words must match). Call this before creating a key so a text with the same meaning is reused. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words from the text or key, e.g. "sign in" or "receipt_count".' },
        locale: { type: 'string', description: 'Only search and show this language, e.g. "de".' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'locli_add_texts',
    title: 'Add texts',
    description: 'Create missing keys and values in locli. Never overwrites: values that already exist are reported as skipped (change them in locli instead). Use lower_snake_case keys whose first segment is the feature area and always give a comment saying where the text appears and what each placeholder holds. Placeholders are printf style (%@, %lld, %1$@) for iOS/Android, ICU names ({used}, {n, number}) for keys used only on web/backend; give plural texts as forms with "other". New keys join the current Git branch\'s feature. Prefer adding the text to the app\'s source file and calling locli_push when the app has one.',
    inputSchema: {
      type: 'object',
      properties: {
        texts: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Identifier, e.g. receipt_import_title.' },
              comment: { type: 'string', description: 'Context for translators: where the text appears, what placeholders hold.' },
              values: { type: 'object', additionalProperties: { type: 'string' }, description: 'Language code → text, e.g. {"en": "Import receipts"}.' },
              forms: {
                type: 'object',
                description: 'Plural texts: language code → CLDR category → text, e.g. {"en": {"one": "%lld receipt", "other": "%lld receipts"}}.',
                additionalProperties: { type: 'object', properties: { zero: { type: 'string' }, one: { type: 'string' }, two: { type: 'string' }, few: { type: 'string' }, many: { type: 'string' }, other: { type: 'string' } }, required: ['other'], additionalProperties: false },
              },
              pluralArgument: { type: 'integer', minimum: 1, maximum: 20, description: 'Plural texts: number of the integer argument that selects the form (default: first integer).' },
              platforms: { ...platforms, description: 'Platforms that use the key (default: the targets in locli.json).' },
            },
            required: ['key'],
            additionalProperties: false,
          },
        },
        branch: { type: 'string', description: 'Git branch for feature grouping (default: detected).' },
        dryRun: { type: 'boolean', description: 'Only report what would be added.' },
      },
      required: ['texts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'locli_push',
    title: 'Push new texts',
    description: 'Upload texts from the app files in locli.json that locli lacks (new keys, missing languages). Never overwrites existing texts. Reports how many texts wait for a release.',
    inputSchema: { type: 'object', properties: { dryRun: { type: 'boolean', description: 'Only print the plan.' }, target: { type: 'string', description: 'Only this platform (ios, android, web, backend).' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'locli_pull',
    title: 'Pull approved texts',
    description: 'Write the latest approved release into the app files from locli.json. Replaces the released keys\' texts in those files; local-only keys stay. draft=true writes the unapproved working state for local checks only.',
    inputSchema: { type: 'object', properties: { draft: { type: 'boolean' }, target: { type: 'string', description: 'Only this platform.' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

/**
 * Runs one tool and returns MCP content.
 * @param {string} name @param {any} args @param {Partial<import('./context.js').Context>} [overrides]
 */
export async function callTool(name, args = {}, overrides = {}) {
  /** @type {string[]} */
  const lines = [];
  const ctx = createContext({
    out: (line) => lines.push(line),
    info: (line) => process.stderr.write(line + '\n'),
    warn: (line) => lines.push(`warning: ${line}`),
    interactive: false,
    ...overrides,
  });
  try {
    let structured;
    if (name === 'locli_status') structured = await status(ctx, { json: true });
    else if (name === 'locli_guide') structured = await guide(ctx, { json: true });
    else if (name === 'locli_context') structured = await context(ctx, { json: true, key: args.key, target: args.target });
    else if (name === 'locli_areas') structured = await areas(ctx, { json: true, feature: args.feature });
    else if (name === 'locli_find_texts') {
      const result = await findTexts(ctx, { query: args.query, locale: args.locale });
      structured = result;
      if (!result.total) lines.push(`No existing text matches "${args.query}". A new key is fine.`);
      else {
        lines.push(`${result.total} match${result.total === 1 ? '' : 'es'}${result.total > result.matches.length ? ` (showing ${result.matches.length})` : ''}:`);
        for (const m of result.matches) {
          lines.push(`- ${m.key} [${m.platforms.join(', ')}]${m.plural ? ' (plural)' : ''}${m.comment ? ` — ${m.comment}` : ''}`);
          for (const [code, value] of Object.entries(m.values)) lines.push(`    ${code}: ${value}`);
        }
      }
    } else if (name === 'locli_add_texts') {
      structured = await addTexts(ctx, { texts: args.texts, branch: args.branch, dryRun: args.dryRun });
      if (args.dryRun) lines.push(`Would add ${structured.added.length} texts (${structured.created.length} new keys); ${structured.skipped.length} already exist.`);
      for (const w of structured.warnings) lines.push(`warning: ${w}`);
    } else if (name === 'locli_push') structured = await push(ctx, { dryRun: args.dryRun, target: args.target });
    else if (name === 'locli_pull') structured = await pull(ctx, { draft: args.draft, target: args.target });
    else return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
    const text = name === 'locli_status' || name === 'locli_guide' || name === 'locli_areas' || name === 'locli_context' ? JSON.stringify(structured, null, 2) : lines.join('\n') || 'Done.';
    return { content: [{ type: 'text', text }], isError: false };
  } catch (error) {
    lines.push(/** @type {Error} */ (error).message);
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
  }
}

/**
 * Handles one JSON-RPC message; returns the response or null for notifications.
 * @param {any} message @param {Partial<import('./context.js').Context>} [overrides]
 */
export async function handle(message, overrides) {
  const { id, method, params } = message ?? {};
  const isRequest = id !== undefined && id !== null;
  const reply = (/** @type {any} */ result) => ({ jsonrpc: '2.0', id, result });
  const fail = (/** @type {number} */ code, /** @type {string} */ msg) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: msg } });
  if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return isRequest ? fail(-32600, 'Invalid request') : null;
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled …
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return reply({
        protocolVersion: SUPPORTED.includes(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'locli', title: 'locli', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      return reply(await callTool(name, params?.arguments ?? {}, overrides));
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}

/** Serves MCP on stdin/stdout until stdin closes. */
export function serve(/** @type {Partial<import('./context.js').Context>} */ overrides = {}) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (/** @type {any} */ response) => process.stdout.write(JSON.stringify(response) + '\n');
  process.stderr.write(`locli MCP server ${VERSION} ready (stdio)\n`);
  let pending = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    // Requests run in order; a slow push does not interleave with the next call's output.
    pending = pending.then(async () => {
      const messages = Array.isArray(message) ? message : [message];
      const responses = (await Promise.all(messages.map((m) => handle(m, overrides).catch((error) => ({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }))))).filter(Boolean);
      if (responses.length) send(Array.isArray(message) ? responses : responses[0]);
    });
  });
  return new Promise((resolve) => rl.on('close', () => pending.then(resolve)));
}
