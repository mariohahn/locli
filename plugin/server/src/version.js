import fs from 'node:fs';

/** Package version, read from package.json so it never drifts. */
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
