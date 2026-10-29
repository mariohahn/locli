#!/usr/bin/env node
import { main } from '../src/cli.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  process.stderr.write(`locli needs Node.js 18 or newer (found ${process.versions.node}).\n`);
  process.exit(1);
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
