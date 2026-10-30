// Command line entry: argument parsing, help, dispatch and exit codes (0 ok, 1 error, 2 usage).
import { createContext } from './context.js';
import { LocliError } from './util.js';
import { VERSION } from './version.js';

/** @typedef {'string' | 'boolean' | 'list'} OptionType */

const COMMON = { 'api-url': 'string', config: 'string', help: 'boolean' };

/** @type {Record<string, { summary: string, usage: string, options: Record<string, OptionType>, details: string }>} */
const COMMANDS = {
  login: {
    summary: 'Sign in through the browser and store a token for this server',
    usage: 'locli login [--api-url URL] [--no-browser]',
    options: { 'no-browser': 'boolean' },
    details: `Prints a URL and a code, opens the browser (not with --no-browser or when CI is set)
and waits until you approve. The token is stored in $XDG_CONFIG_HOME/locli/credentials.json
(default ~/.config/locli/), per server, readable only by you. In CI set LOCLI_TOKEN instead.`,
  },
  logout: { summary: 'Revoke and remove the stored token', usage: 'locli logout [--api-url URL]', options: {}, details: '' },
  whoami: { summary: 'Show the signed-in account', usage: 'locli whoami [--api-url URL] [--json]', options: { json: 'boolean' }, details: '' },
  init: {
    summary: 'Detect text files, write locli.json and agent instructions, create the project',
    usage: 'locli init [--name NAME] [--slug SLUG] [--source LANG] [--target platform:format:path]… [--icon FILE | --no-icon] [--yes] [--no-agent-files]',
    options: { name: 'string', slug: 'string', source: 'string', target: 'list', icon: 'string', 'no-icon': 'boolean', yes: 'boolean', y: 'boolean', 'no-agent-files': 'boolean' },
    details: `Non-interactive unless run in a terminal without --yes. Detects *.xcstrings (ios),
**/src/main/res/values/strings.xml (android) and messages|locales|i18n|lang/{locale}.json (web).
--target overrides detection (repeatable), e.g. web:json:messages/{locale}.json,
android:android-xml:app/src/main/res, ios:xcstrings:App/Localizable.xcstrings,
backend:json:resources/i18n/{locale}.json.
Writes AGENTS.md (block between <!-- locli:start --> and <!-- locli:end -->), adds @AGENTS.md
to an existing CLAUDE.md and installs the skill to .agents/skills/locli (+ .claude/skills/locli).
A project without an icon gets the app's own: the iOS AppIcon, the Android launcher icon or the
web app icon (scaled to 128 px with sips on macOS). --icon FILE sets or replaces it, --no-icon skips it.
Safe to rerun.`,
  },
  push: {
    summary: 'Upload texts locli lacks (never overwrites existing texts)',
    usage: 'locli push [--branch B] [--dry-run] [--target platform] [--allow-text-keys]',
    options: { branch: 'string', 'dry-run': 'boolean', target: 'string', 'allow-text-keys': 'boolean' },
    details: `Creates missing keys and languages and adds missing values; edited texts in locli always
win. New keys from a feature branch join its feature. The branch comes from --branch,
LOCLI_BRANCH/LOCALIZE_BRANCH, CI variables (GITHUB_HEAD_REF, GITHUB_REF_NAME,
CI_COMMIT_REF_NAME, BITRISE_GIT_BRANCH) or git. New keys must be identifiers (lower_snake_case
with a feature prefix, e.g. account_login), not the visible text; --allow-text-keys overrides that
for catalogs keyed by text on purpose.`,
  },
  pull: {
    summary: 'Write the latest approved release into the app files',
    usage: 'locli pull [--draft] [--release NAME] [--target platform]',
    options: { draft: 'boolean', release: 'string', target: 'string' },
    details: `Without a release it fails with a hint (no silent fallback). --draft writes the unapproved
working state for local checks only. Only keys exported by locli are replaced; local-only
keys and other file content stay.`,
  },
  status: { summary: 'Languages, missing texts, open features, unreleased changes', usage: 'locli status [--json]', options: { json: 'boolean' }, details: '' },
  areas: {
    summary: 'List feature areas, or find the area a new feature\'s texts belong to',
    usage: 'locli areas [--feature NAME] [--json]',
    options: { feature: 'string', json: 'boolean' },
    details: `An area is a key's first segment (login_username_label → login); the web app groups
texts by it. --feature login finds an existing area with that name or a synonym (auth, signin,
account …) and says how to name new keys; without a match it proposes a new area, which is
created by the first push of keys with that prefix.`,
  },
  guide: {
    summary: 'Show the translation guide (tone, glossary) and texts that break it',
    usage: 'locli guide [--json] [--set FILE]',
    options: { json: 'boolean', set: 'string' },
    details: `Read this before translating: tone and form of address per language, glossary terms
with their fixed translations, and terms that stay as written (product names).
Lists every translation that doesn't follow the glossary.
--set FILE replaces the guide with a JSON file ({ "tone": { "de": "du" }, "terms": [{ "term": "Pro",
"keep": true }, { "term": "Release", "translations": { "de": "Release" } }] }); the output of
--json is accepted too. Needs the editor role or a write token.`,
  },
  context: {
    summary: 'Show where each key is used in the code, as what, and translations that are too long',
    usage: 'locli context [--key KEY_OR_AREA] [--target platform] [--json]',
    options: { key: 'string', target: 'string', json: 'boolean' },
    details: `Finds every key of locli.json's files in the code (Swift, Kotlin/Java, Android layouts, TS/JS,
Vue, Python, Ruby, Go, PHP …) and the role it has there: toolbar item, tab, button, menu item, screen
title, form field, push notification, email, alert, error message, accessibility label or text.
Constrained roles get a length budget (a toolbar item about 12 characters, at least 1.3 × the source);
translations in the files that exceed it are listed. Read it before translating. push uses the same
scan: it warns about too-long texts and writes "Used as …" context to keys nobody described yet.
Local only; needs no login.`,
  },
  mcp: {
    summary: 'Run the MCP server on stdio (for coding agents)',
    usage: 'locli mcp',
    options: {},
    details: `Tools: locli_status, locli_areas, locli_guide, locli_context, locli_find_texts, locli_add_texts, locli_push, locli_pull.
Uses locli.json from the working directory (or LOCLI_CONFIG). Example client config:
  { "command": "npx", "args": ["-y", "@locli/cli", "mcp"] }`,
  },
};

const HELP = `locli ${VERSION} — put your app's user-facing texts into locli (https://locli.dev)

Usage: npx @locli/cli <command> [options]

Commands:
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(8)} ${c.summary}`).join('\n')}

Options for every command:
  --api-url URL   Server (default: LOCLI_API_URL, locli.json apiURL, https://locli.dev)
  --config FILE   Path to locli.json (default: LOCLI_CONFIG or the nearest locli.json)
  --help          Help for a command
  --version       Print the version

Workflow: add new keys in your source-language file -> locli push -> a project owner
approves a release in locli -> locli pull. Run "locli <command> --help" for details.`;

/**
 * @param {string[]} argv @param {Record<string, OptionType>} spec
 * @returns {Record<string, any>}
 */
export function parseArgs(argv, spec) {
  const all = { ...COMMON, ...spec };
  /** @type {Record<string, any>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-') || arg === '-') throw new LocliError(`Unexpected argument: ${arg}`, 2);
    const body = arg.replace(/^--?/, '');
    const eq = body.indexOf('=');
    const name = eq >= 0 ? body.slice(0, eq) : body;
    const type = all[/** @type {keyof typeof all} */ (name)];
    if (!type) throw new LocliError(`Unknown option: ${arg.split('=')[0]}`, 2);
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (type === 'boolean') {
      if (eq >= 0) throw new LocliError(`--${name} takes no value`, 2);
      flags[camel] = true;
      continue;
    }
    const value = eq >= 0 ? body.slice(eq + 1) : argv[++i];
    if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new LocliError(`--${name} needs a value`, 2);
    if (type === 'list') (flags[camel] ??= []).push(value); else flags[camel] = value;
  }
  return flags;
}

/**
 * Runs the CLI. Returns the exit code.
 * @param {string[]} argv @param {Partial<import('./context.js').Context>} [overrides]
 */
export async function main(argv, overrides = {}) {
  const ctx = createContext(overrides);
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    const topic = command === 'help' ? rest[0] : undefined;
    if (topic && COMMANDS[topic]) printCommandHelp(ctx, topic); else ctx.out(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') { ctx.out(VERSION); return 0; }
  const definition = COMMANDS[command];
  if (!definition) { ctx.info(`Unknown command: ${command}\n\n${HELP}`); return 2; }
  try {
    const flags = parseArgs(rest, definition.options);
    if (flags.help) { printCommandHelp(ctx, command); return 0; }
    if (flags.y) flags.yes = true;
    if (flags.noBrowser) flags.browser = false;
    if (flags.noAgentFiles) flags.agentFiles = false;
    if (flags.noIcon) flags.icon = false;
    switch (command) {
      case 'login': await (await import('./commands/login.js')).login(ctx, flags); break;
      case 'logout': await (await import('./commands/login.js')).logout(ctx, flags); break;
      case 'whoami': await (await import('./commands/login.js')).whoami(ctx, flags); break;
      case 'init': await (await import('./commands/init.js')).init(ctx, flags); break;
      case 'push': await (await import('./commands/push.js')).push(ctx, flags); break;
      case 'pull': await (await import('./commands/pull.js')).pull(ctx, flags); break;
      case 'status': await (await import('./commands/status.js')).status(ctx, flags); break;
      case 'areas': await (await import('./commands/areas.js')).areas(ctx, flags); break;
      case 'guide': await (await import('./commands/guide.js')).guide(ctx, flags); break;
      case 'context': await (await import('./commands/context.js')).context(ctx, flags); break;
      case 'mcp': await (await import('./mcp.js')).serve(overrides); break;
      default: break;
    }
    return 0;
  } catch (error) {
    if (error instanceof LocliError) {
      ctx.info(`locli ${command} failed: ${error.message}`);
      if (error.exitCode === 2) ctx.info(`Usage: ${definition.usage}`);
      return error.exitCode;
    }
    ctx.info(`locli ${command} failed: ${/** @type {Error} */ (error)?.stack ?? error}`);
    return 1;
  }
}

/** @param {import('./context.js').Context} ctx @param {string} name */
function printCommandHelp(ctx, name) {
  const c = COMMANDS[name];
  ctx.out(`${c.summary}\n\nUsage: ${c.usage}${c.details ? `\n\n${c.details}` : ''}\n\nCommon options: --api-url URL, --config FILE, --help`);
}
