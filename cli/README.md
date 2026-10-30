# @locli/cli

Put your app's user-facing texts into [locli](https://locli.dev): push new texts,
let a project owner approve a release, pull the approved translations. Built for
coding agents, works for any stack: iOS String Catalogs, Android `strings.xml`, and
JSON for web and backend. Node 18+, no dependencies.

```sh
npx @locli/cli init
```

`init` detects your text files and writes:

- `locli.json` with the project slug, source language and one target per catalog
- a locli block in `AGENTS.md` (and `@AGENTS.md` in an existing `CLAUDE.md`)
- the locli agent skill in `.agents/skills/locli/` (linked from `.claude/skills/locli/`)

When you are logged in, `init` also creates the project with its languages and
platforms. It is safe to rerun.

## Login

```sh
npx @locli/cli login
```

`login` opens the browser. You sign in, or create a free account, and approve the CLI.
The token is stored per server in `~/.config/locli/credentials.json`, readable only by
you. In CI, set `LOCLI_TOKEN` instead. `whoami` shows the account; `logout` revokes the
token.

## Workflow

1. Add new keys to the source-language file, e.g. `receipt_import_title` with a comment.
2. `npx @locli/cli push` uploads only what locli lacks. It never overwrites existing
   texts. New keys from a Git feature branch are grouped as a feature.
3. A project owner approves a release in the locli web app.
4. `npx @locli/cli pull` writes the latest approved release into your files.

## `locli.json`

```json
{
  "project": "example-app",
  "sourceLanguage": "en",
  "targets": [
    { "platform": "ios", "format": "xcstrings", "path": "App/Localizable.xcstrings" },
    { "platform": "android", "format": "android-xml", "path": "app/src/main/res" },
    { "platform": "web", "format": "json", "path": "messages/{locale}.json" }
  ]
}
```

Every target has `platform` (`ios`, `android`, `web` or `backend`), `format` and
`path`. Paths are relative to `locli.json`.

- Android targets take an optional `file`; the default is `strings.xml`.
- JSON targets need `{locale}` in the path and take an optional `keyPrefix`.
- `apiURL` is optional; the default is `https://locli.dev`.

The JSON schema is shipped as `@locli/cli/schema/locli.json`.

## Commands

| Command | Effect |
| --- | --- |
| `login [--no-browser]` / `logout` / `whoami [--json]` | Approve the CLI in the browser; revoke the token; show the account |
| `init [--name] [--slug] [--source LANG] [--target platform:format:path]… [--icon FILE \| --no-icon] [--yes] [--no-agent-files]` | Detect catalogs, write the config and agent files, create the project and give it the app's icon |
| `push [--dry-run] [--branch B] [--target platform]` | Upload missing keys and values; never overwrites |
| `pull [--draft] [--release NAME] [--target platform]` | Write the latest approved (or named) release |
| `status [--json]` | Show languages, missing translations, open features, unreleased changes and glossary issues |
| `areas [--feature NAME] [--json]` | List feature areas, or find the area a new feature's texts belong to |
| `context [--key KEY_OR_AREA] [--json]` | Where each key is used in the code, as what (toolbar item, button, push notification …), and translations too long for it |
| `guide [--json] [--set FILE]` | Show the translation guide (tone, glossary) and the texts that break it; `--set` replaces it |
| `mcp` | Start the MCP server on stdio |

Every command takes `--api-url`, `--config` and `--help`. Exit codes: 0 ok, 1 error,
2 usage error.

Environment variables:

- `LOCLI_TOKEN`: the API token in CI.
- `LOCLI_API_URL`: the server.
- `LOCLI_CONFIG`: the path to `locli.json`.
- `LOCLI_BRANCH`: overrides the detected branch.

## MCP server

The MCP server provides eight tools:

- `locli_status`
- `locli_areas`
- `locli_guide`
- `locli_context`
- `locli_find_texts`
- `locli_add_texts`
- `locli_push`
- `locli_pull`

Claude Code: install the plugin (skill and MCP server in one), or add only the MCP server:

```sh
/plugin marketplace add mariohahn/locli
/plugin install locli@locli
claude mcp add --scope project locli -- npx -y @locli/cli mcp
```

Cursor (`.cursor/mcp.json`) and other clients that use `mcpServers`:

```json
{ "mcpServers": { "locli": { "command": "npx", "args": ["-y", "@locli/cli", "mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.locli]
command = "npx"
args = ["-y", "@locli/cli", "mcp"]
```

## Known limits

- Android strings with markup (`<b>`, `<a>` …) are skipped on push and left alone on pull.
- JSON: only a top-level ICU plural on `count` or `argN` becomes a plural key. Other
  ICU messages are pushed as plain text.
- JSON: non-string values are skipped with a warning.

Agent guide: https://locli.dev/docs/agents.md · License: MIT
