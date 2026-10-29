import { LocliError } from './util.js';
import { resolveToken } from './credentials.js';
import { VERSION } from './version.js';

export const NOT_LOGGED_IN = 'Not logged in. Ask the user to run `npx @locli/cli login` (it opens a browser to approve), or set LOCLI_TOKEN in CI.';
export const TOKEN_REJECTED = 'The locli token was rejected (expired or revoked). Ask the user to run `npx @locli/cli login` again, or set a valid LOCLI_TOKEN in CI.';

/** An HTTP error from the API, printed like the Python CLI: `HTTP <status> <path>: <reason>`. */
export class ApiError extends LocliError {
  /** @param {number} status @param {string} path @param {string} reason */
  constructor(status, path, reason) {
    super(`HTTP ${status} ${path}: ${reason}`);
    this.status = status;
    this.path = path;
    this.reason = reason;
  }
}

/**
 * Minimal JSON client. Never logs or echoes the token.
 */
export class Api {
  /**
   * @param {string} baseURL
   * @param {{ env?: NodeJS.ProcessEnv, token?: string | null, fetch?: typeof fetch }} [options]
   */
  constructor(baseURL, options = {}) {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.env = options.env ?? process.env;
    this.fetch = options.fetch ?? globalThis.fetch;
    /** @type {string | null | undefined} */
    this.explicitToken = options.token;
  }

  get token() {
    if (this.explicitToken !== undefined) return this.explicitToken;
    return resolveToken(this.baseURL, this.env)?.token ?? null;
  }

  /**
   * @param {string} method @param {string} path
   * @param {{ body?: unknown, auth?: boolean, token?: string, raw?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async request(method, path, options = {}) {
    const auth = options.auth ?? true;
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Source': 'cli', 'User-Agent': `locli/${VERSION}` };
    if (auth) {
      const token = options.token ?? this.token;
      if (!token) throw new LocliError(NOT_LOGGED_IN);
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await this.fetch(this.baseURL + path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const cause = /** @type {any} */ (error).cause?.code ?? /** @type {Error} */ (error).message;
      throw new LocliError(`Cannot reach ${this.baseURL} (${cause}). Check the API URL (--api-url, LOCLI_API_URL or apiURL in locli.json) and the network.`);
    }
    const text = await response.text();
    if (!response.ok) {
      let reason = response.statusText || 'request failed';
      try { reason = JSON.parse(text).reason ?? reason; } catch { /* not JSON */ }
      if (response.status === 401 && auth) throw Object.assign(new ApiError(401, path, reason), { message: TOKEN_REJECTED });
      throw new ApiError(response.status, path, reason);
    }
    if (options.raw) return text;
    if (!text) return null;
    try { return JSON.parse(text); } catch {
      throw new LocliError(`Invalid API response from ${path} (not JSON). Is ${this.baseURL} a locli server?`);
    }
  }

  get(/** @type {string} */ path, /** @type {any} */ options) { return this.request('GET', path, options); }
  post(/** @type {string} */ path, /** @type {unknown} */ body, /** @type {any} */ options) { return this.request('POST', path, { ...options, body }); }
  patch(/** @type {string} */ path, /** @type {unknown} */ body, /** @type {any} */ options) { return this.request('PATCH', path, { ...options, body }); }
  put(/** @type {string} */ path, /** @type {unknown} */ body, /** @type {any} */ options) { return this.request('PUT', path, { ...options, body }); }
  delete(/** @type {string} */ path, /** @type {any} */ options) { return this.request('DELETE', path, options); }
}
