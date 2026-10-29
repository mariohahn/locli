# Errors and what to do

Read this first when the CLI or API fails. The CLI prints API errors as
`HTTP <status> <path>: <reason>`. Fix the cause; do not retry with other credentials,
delete placeholders to silence a check, or approve releases on the user's behalf.

## Authentication and access

| Message | Cause | Action |
| --- | --- | --- |
| `Not logged in. Ask the user to run npx @locli/cli login …` | No stored token for this server and no `LOCLI_TOKEN`. | Ask the user to run `npx @locli/cli login` themselves (browser approval), or to provide `LOCLI_TOKEN` in CI. `init` still writes `locli.json`; rerun it after login. |
| `The locli token was rejected (expired or revoked) …` | 401: token invalid. | Same as above. Never read or print credential files. |
| `The login code expired. Run npx @locli/cli login again.` | The browser approval did not happen within the code's lifetime (`expired_token`). | The user runs `login` again. |
| `The login was denied in the browser.` | The user clicked deny (`access_denied`). | Ask the user whether to log in; do not retry on your own. |
| Older CLI: `Not logged in to <server>; run login or set LOCALIZE_TOKEN` / `Unauthorized at <server>…` | Same causes with the Python wrapper. | The user runs the wrapper's `login`, or CI provides `LOCALIZE_TOKEN`. |
| `Cannot reach <server> …` | Wrong API URL or no network. | Check `--api-url`, `LOCLI_API_URL`, `apiURL` in `locli.json`. |
| `No locli.json found …` / `locli.json: … is required` | Not set up, or invalid config. | Run `npx @locli/cli init` in the repository root, or fix the field named. |
| `403 … Your role (viewer\|editor) does not allow this action.` | Role too low: `pull` needs viewer, `push`/`init` need editor, releases need owner. | Ask a project owner to change the role. |
| `403 This token is read-only.` / `Project tokens cannot perform this action.` | Read token used for writes, or a project token for a user-only action (creating projects, releases). | Use an editor-scoped token or let the user act. |
| `403 Confirm your email address first.` | The account has not confirmed its email, which creating projects needs. | Tell the user to use the link in their confirmation email. |
| `402 The <plan> plan allows N …` | Plan limit for projects, languages, texts or members reached. | Tell the user; they upgrade under Account → Team & Tarif. Do not delete texts or split projects to get around it. |
| `429 Too many requests.` | Rate limit on sign-in or sign-up endpoints. | Wait; do not retry in a loop. |
| `404 Project not found.` | Project does not exist **or** the account is not a member. | Check slug/server and membership before suggesting `init`. |
| `Project "<slug>" not found on <server> …` (older CLI: `Project missing; run init first`) | Slug not visible to this account. | Same check. If the project exists, `init` fails with `409 A project with this slug already exists.`; do not change the slug to work around missing membership. |
| `No release yet. Ask the project owner to approve one …` (older CLI: `HTTP 404 … This project has no release yet.`) on `pull` | No approved release. | Ask the user to approve one, or use `pull --draft` for local checks only. |
| `The <platform> platform is not enabled for project "<slug>", and only a project owner can enable it …` | `push`/`init` needs a platform the project has not enabled; the account is not an owner. | Ask an owner to enable it in the project settings. |
| `Project <slug> uses source language <a>, but locli.json says <b>` / `Remote project uses a different source language …` | Config and project disagree. | Fix `sourceLanguage` in `locli.json`; never change the project's language to match. |

## Texts and placeholders

| Message | Cause | Action |
| --- | --- | --- |
| `422 <key> (<scope>[, <category>]): Platzhalter passen nicht zum Ausgangstext: erwartet %1$@, %2$lld, gefunden …` | A translation's arguments differ from **Localize's** base-language text (not the local catalog). Numbers and types must match exactly: `%d` ≠ `%lld`, `%@` ≠ `%s`; `%i` = `%d`. Plural forms compare with the base form of the same category, else `other`. | Fix the translation (or the base text first). During `push` the failing language is not imported. |
| `422 <key> (<scope>): Werte passen nicht zum Ausgangstext: es fehlt {limit}` / `… {x} gibt es im Ausgangstext nicht` / `… hat eine andere Art` | A web/backend text's ICU arguments differ from the base text's by name or kind (`{n}` vs `{n, number}`). Order is free. | Use exactly the base text's `{names}`; rename in the base first if the code changed. |
| `422 <n> Platzhalter-Fehler, z. B. …` when publishing | Release blocked by mismatches. | Fix the listed texts; the user publishes afterwards. |
| `warning: <n> texts in your files break the translation guide's glossary: <key> (<lang>): “Pro” must stay “Pro”.` / `… “sign in” should be “anmelden” or “melde dich an”.` | `push` (also with `--dry-run`) checks the files before uploading; `guide`/`status` list texts already in locli. A glossary term of the source text is missing in the translation (whole words; *keep* terms case-sensitive). A warning, never a block. | Fix it in the files before the real push. A correct inflected form: rephrase with the glossary form, or ask the user to add the form to the term with `|`. Already in locli: change it there. |
| `400 Glossary term “<x>” appears twice.` / `… longer than 80 characters.` | `guide --set` with an invalid guide. | One entry per term (case-insensitive), short terms only. |
| `This locli server has no translation guide yet.` | Older server. | Use the tone of the existing texts; the rest of the workflow still applies. |
| `400 <key> ist nicht mengenabhängig; Pluralformen sind hier nicht möglich.` | Forms sent for a plain key. | Enable **Mengenabhängig (Plural)** in Localize first. |
| `409 <key>: imported plural selector differs from the existing key.` | Catalog selects the plural by another argument than Localize. | Align the selector (**Menge steht in**) or the catalog. |
| `400 Enable this platform in project settings first.` | Platform not enabled for the project (Backend is off by default). | Ask an owner to enable it under project settings. |
| `400 Assign this platform to the key before adding an override.` | Variant for an unassigned platform. | Assign the platform to the key, then add the variant. |

## Identifiers

| Message | Cause | Action |
| --- | --- | --- |
| `409 A key with this identifier already exists.` | Duplicate identifier. | Reuse the existing key; see [identifiers and merging](identifiers.md). |
| `422 <key>: Android requires a key containing only letters, digits and underscores…` | Dotted or otherwise invalid name assigned to Android. | Use the `lower_snake_case` identifier; rename deliberately. |
| `422 <platform>: <a> and <b> both export as <name>.` | Two keys collide in one platform's export. | Merge or rename one of them. |
| `400 A key has one identifier for all platforms…` | Per-platform names were sent. | Use one identifier; different meanings need separate keys. |

## Releases (owner, signed-in user only)

| Message | Meaning |
| --- | --- |
| `422 Noch <n> Einträge ohne Freigabe…` | Changed texts still need review approval in the release page. |
| `409 Keine Änderungen seit Release <name>.` | Nothing to publish. |
| `409 Release <name> already exists.` / `400 Release name must be 1–40 characters.` | Choose another name. |
| `409 Ein Text wurde inzwischen geändert…` | The reviewed state is stale; reload the comparison. |

Agents do not publish or approve releases. Tell the user how many texts wait for a
release and that they approve it in Localize (**Release vorbereiten**).

## Exports and catalog sync

| Message | Cause | Action |
| --- | --- | --- |
| `422 A .strings file cannot represent plural forms…` | Plural keys in a `.strings` export. | Use `?format=xcstrings`. |
| CLI `device variations and nested substitutions are not supported` / `only one plural substitution is supported` | Unsupported String Catalog structure. | Rephrase into one selector; do not flatten silently. |
| CLI `conflicting plural selectors across languages` | Languages use different arguments as selector. | Make every language select by the same argument. |
| CLI `Refusing an empty catalog or a changed source language` | Release would wipe or change the catalog language. | Check project, slug and source language; do not force. |
| `422 <Store> <Feld>: höchstens <n> Zeichen/Bytes …` | Store text too long (keywords count UTF-8 bytes). | Shorten; see [store listings](store-listings.md). |

## Symptoms without an error

| Symptom | Check |
| --- | --- |
| `push` did not change an edited text | Expected: add-only. Edit in Localize, release, then `pull`. |
| Change missing after `pull` | Not yet in an approved release; `pull --draft` shows the working state. |
| Local edits disappeared after `pull` | `pull` replaces each released key's languages with the release. Push or edit in Localize first. |
| Large formatting-only catalog diff after `pull` | The CLI rewrites the file sorted with two-space indentation; commit it once. |
| Key missing from an export | Platform assignment, selected release, language, variant. Store texts never appear in app exports. |
| Plural not recognized in the app | Key has plural forms and an integer selector, the platform export contains them, the app calls its plural-aware API. |
| App works but extension shows keys | Extension's own package dependency and bundle; see [iOS integration](ios-integration.md). |
