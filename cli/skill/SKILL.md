---
name: locli
description: "Use when building or changing an app with user-facing text, or when it consumes locli (formerly Localize): adding or renaming user-facing strings (Localizable.xcstrings, strings.xml, web/backend ICU JSON), npx @locli/cli init/login/push/pull/status and its MCP tools, translations, platform variants, identifiers and duplicate-key merges, placeholders, plurals, App Store/Google Play listing texts, releases, and fixing locli errors such as placeholder 422, 403 roles or blocked releases. Not for developing or deploying locli itself."
---

# Using locli in applications

locli (formerly Localize) holds an app's texts per language and platform. Apps get
them through `npx @locli/cli pull` or platform exports, from **approved releases**. This skill covers
consuming locli, not developing or deploying it.

This file and `references/` are the canonical source; global installs only link
here, and `@locli/cli` ships a generated copy named `locli` (installed by `init`). Keep instructions in English; quoted UI labels and examples may stay German.

## Before starting

1. Look for `locli.json` (or an older `Config/localize.json` wrapper), the catalogs and
   localization helpers. Confirm server, project slug, source language and platforms
   instead of guessing them. No config and the app has user-facing text: run
   `npx @locli/cli init` ([CLI](references/cli.md)).
2. Use the app's existing workflow and only the commands in [CLI](references/cli.md).
   With the MCP server connected, prefer its tools (`locli_find_texts`,
   `locli_add_texts`, `locli_push`, `locli_pull`, `locli_status`, `locli_areas`, `locli_guide`).
3. Authentication is the user's: on "Not logged in" ask them to run
   `npx @locli/cli login` (browser approval); CI provides `LOCLI_TOKEN`.
   Never read credential files, print tokens or store them in code or Git.
4. On any CLI or API error, look it up in [errors](references/errors.md) first.

## Common tasks

**Build a feature with texts** ("build the login screen"): first
`npx @locli/cli areas --feature login` (MCP `locli_areas`) to get the existing area to use
or the new one to start ([identifiers](references/identifiers.md#starting-a-feature)); then
add each text as below with that prefix.

**Add or change an app text**
1. Search the catalog and locli (`locli_find_texts`, `status`) for an existing key with the same meaning and
   reuse it. Same wording is not the same meaning ("Open" a file vs. a store).
2. A new key gets a `lower_snake_case` identifier whose first segment is the feature
   area, e.g. `receipt_import_title` ([identifiers](references/identifiers.md)).
   iOS/Android texts use printf; two or more placeholders are numbered (`%1$@`, `%2$lld`).
   Web/backend-only keys use ICU names (`{used} of {limit} seats used`). A count that
   changes grammar becomes a plural ([plurals](references/plurals.md)).
3. Add the entry to the source catalog (`.xcstrings`, `strings.xml`, JSON) with a comment
   saying where the text appears and what each placeholder holds (`.xcstrings`
   `comment`, XML comment), plus every language you can provide; use it through the
   app's accessor. Platform details: integration guides below.
4. `npx @locli/cli push` from the branch you work on; new keys join that branch's
   [feature](references/features.md). An **existing** text is changed in locli,
   because `push` never overwrites it.
5. Tell the user how many texts wait for a release. They approve it; then
   `npx @locli/cli pull`.

**Translate texts or add a language**: read the project's guide first
(`npx @locli/cli guide`, MCP `locli_guide`: tone per language, glossary, terms that stay
as written), then follow [translation](references/translation.md): translate from the
source, check mechanically, back-translate, have another model review, look at the UI.

**Fix an error**: [errors](references/errors.md) lists every CLI/API message with cause and fix.

**Integrate an app or a new platform**: pick the guide from the table below.

**Rename keys or merge two names for the same text**: [merge workflow](references/merge.md).

**App Store / Google Play copy**: [store listings](references/store-listings.md), never the app catalog.

## Rules that always apply

- **One key per meaning, on every platform.** Same identifier on iOS, Android, web
  and backend. Assigning a platform exports the shared text; add a platform variant
  only when its wording must differ. No `_ios`/`_android` suffixes, no dotted copy
  next to an underscore one.
- **A key is an identifier, never the visible text.** `team_seats_used` → "{used} of
  {limit} seats used". The first segment is the feature and becomes the area in locli.
  Keying by the sentence (`t("Projekt wechseln: {name}")`) gives every text its own
  area, breaks renames and review; `push` refuses such new keys (`--allow-text-keys`
  only for catalogs keyed by text on purpose, e.g. SwiftUI `Text("…")`).
- **`lower_snake_case` is a convention.** The server enforces names only for Android,
  so legacy dotted iOS keys still work. Change them only via the merge workflow.
- **Placeholders are the app's contract.** Translations may reorder arguments but
  not drop, add or retype them (`%d` ≠ `%lld`, `{n}` ≠ `{n, number}`). printf counts
  for iOS, Android and texts shared with them; ICU arguments (`{name}`) for web and
  backend variants and for keys assigned only to web/backend, compared by name. A
  key also on iOS keeps printf: `{name}` there is literal text. A 422 means: fix the text.
- **Plurals belong to the key.** Define forms and the integer selector once in
  locli (**Mengenabhängig (Plural)**, **Menge steht in**); each platform gets its
  format and the app must call its plural-aware API with the real count. Never
  hand-code `count == 1` rules.
- **The guide is binding.** Tone per language and glossary terms from `locli guide` apply
  to every translation; *keep* terms stay exactly as written. Fix the glossary issues
  it lists instead of leaving them for review.
- **Releases decide what ships.** `pull` and builds use approved releases; the
  working state is for local checks. Only a project owner approves and publishes.
  Agents never approve or publish; they report what is waiting.

## References

Read only what the task needs.

| Read | When |
| --- | --- |
| [cli](references/cli.md) | `locli.json`, `login`, `init`, `push`, `pull`, `status`, `guide`, MCP tools; what push/pull change |
| [translation](references/translation.md) | Writing or changing any translation: guide, tone, glossary, the four checks |
| [exports](references/exports.md) | Anything beyond the iOS sync: export endpoints, `resolved`, release pinning |
| [errors](references/errors.md) | Any error message or surprising result |
| [identifiers](references/identifiers.md) | Naming a key, areas, checks before creating one |
| [merge](references/merge.md) | Renames, duplicate dotted/underscore keys |
| [features](references/features.md) | Branch grouping, `--branch`, CI variables, cleanup |
| [store-listings](references/store-listings.md) | App Store / Google Play texts and limits |
| [plurals](references/plurals.md) | Any plural work; then the platform's plural guide |

| Platform | Integration | Plurals |
| --- | --- | --- |
| iOS | [Swift package, app and extensions, sync configuration](references/ios-integration.md) | [String Catalog plurals in Swift/SwiftUI](references/ios-plurals.md) |
| Android | [Resource module, Gradle, export ingestion](references/android-integration.md) | [Resource plurals in Kotlin/Compose](references/android-plurals.md) |
| Web | [Catalog module, locale resolution, SSR](references/web-integration.md) | [ICU in frontend code](references/web-plurals.md) |
| Backend | [Catalog artifacts, recipient locales](references/backend-integration.md) | [ICU in server messages](references/backend-plurals.md) |

Names, paths and versions in examples are illustrative; match the actual app.

## Completing a task

Report which catalogs, configuration and accessors changed and which targets were
verified. Keep catalog/syntax checks, builds and runtime checks of languages and
plurals apart. A missing sync pipeline for a platform is a gap to name, not a
reason to claim an unsupported command exists.
