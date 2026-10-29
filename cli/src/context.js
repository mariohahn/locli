import { findConfig, loadConfig, resolveApiURL } from './config.js';
import { Api } from './http.js';

/**
 * Everything a command needs from the outside world, so the MCP server and tests can capture
 * output and swap the network.
 * @typedef {object} Context
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env
 * @property {(line: string) => void} out results (stdout in the CLI)
 * @property {(line: string) => void} info progress and notes (stderr in the CLI)
 * @property {(line: string) => void} warn
 * @property {typeof fetch} [fetch]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(url: string) => void} [openBrowser]
 * @property {boolean} [interactive]
 */

/** @param {Partial<Context>} [overrides] @returns {Context} */
export function createContext(overrides = {}) {
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (line) => process.stdout.write(line + '\n'),
    info: (line) => process.stderr.write(line + '\n'),
    warn: (line) => process.stderr.write(`warning: ${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ...overrides,
  };
}

/**
 * Loads locli.json and builds the API client.
 * @param {Context} ctx @param {{ config?: string, apiUrl?: string }} flags
 */
export function openConfig(ctx, flags) {
  const loaded = loadConfig(findConfig(ctx.cwd, ctx.env, flags.config));
  const apiURL = resolveApiURL(flags, ctx.env, loaded.data);
  const api = new Api(apiURL, { env: ctx.env, fetch: ctx.fetch });
  return { loaded, config: loaded.data, apiURL, api };
}
