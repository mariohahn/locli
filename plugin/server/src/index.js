// Programmatic API (the CLI and the MCP server use the same functions).
export { main } from './cli.js';
export { createContext } from './context.js';
export { init } from './commands/init.js';
export { push, planTarget } from './commands/push.js';
export { pull } from './commands/pull.js';
export { status } from './commands/status.js';
export { login, logout, whoami } from './commands/login.js';
export { findTexts, addTexts } from './commands/texts.js';
export { serve as serveMcp, handle as handleMcpMessage, TOOLS } from './mcp.js';
export { VERSION } from './version.js';
