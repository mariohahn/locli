# Integrating Localize with a web application

## Catalog ownership

Keep one localization module containing the exported catalogs, the application's
locale/fallback policy and its text accessors. Components should use that module
or the project's established i18n framework rather than fetching or formatting
Localize entries independently.

If multiple frontend packages share translations, reuse an existing workspace
localization package where appropriate. Localize does not require a particular
framework or provide an automatic web-sync command in its iOS CLI.

Example layout:

```text
src/localization/
├── catalogs/
│   └── web.json
├── locale.ts
└── messages.ts
```

## Keys in code are identifiers

Components look texts up by identifier, never by the visible sentence:

```ts
t("team_seats_used", { used, limit })   // en.json: "team_seats_used": "{used} of {limit} seats used"
t("Projekt wechseln: {name}")            // wrong: the sentence is the key
```

With next-intl or i18next the same applies to `useTranslations("team")("seats_used")`
when the namespace maps to the key prefix. If an existing app keys by text, assign
identifiers before the first `push` (see [identifiers](identifiers.md)); `push`
refuses new text-like keys.

## Values in web texts

Web and backend texts name their values the ICU way: `"{used} of {limit} seats used"`,
`"{n, number} files"`. locli shows them as value chips and checks every translation
against the base text by name (order is free); a missing or extra name is a 422 and
blocks the release. Apostrophe-quoted `'{literal}'` is text. This applies to keys
assigned only to web/backend and to web/backend variants; a key that is also on iOS
or Android keeps printf placeholders. Plural forms still use `count` and `argN`
([web plurals](web-plurals.md)).

## 1. Acquire an approved catalog

Assign the keys to Web. Download the web export for the intended release or use
the application's existing authorized build integration:

```text
GET /api/projects/<projectID>/export/web?release=<release-name>
```

`release=latest` requests the latest approved release; an explicit release name
is preferable for reproducible builds. Without `release`, this endpoint provides
working state, which should be an explicit development choice.

The JSON is organized by locale, for example:

```json
{
  "en": {
    "account_login": "Sign in",
    "receipt_count": "{count, plural, one {# receipt} other {# receipts}}"
  },
  "de": {
    "account_login": "Anmelden",
    "receipt_count": "{count, plural, one {# Beleg} other {# Belege}}"
  }
}
```

Store the validated artifact in the application/workspace, or serve locale chunks
through the existing public asset pipeline. Authenticated export acquisition belongs
in development/CI or a trusted server; a browser must not receive a Localize access
token. Exported client-facing translation text itself can be a public asset.

The iOS CLI has no web sync; a download/build task is application integration.

## 2. Configure the locale and formatter

- Reuse the project's existing supported-locale and language-switching mechanism.
- Select the message from the correct locale catalog. Define an explicit fallback
  to the configured source language when that entry is absent; do not silently
  treat raw identifiers as translated text.
- Preserve the **resolved message locale** with the message. An English fallback
  must use English plural rules even when the requested language was different.
- Map negotiated locale tags to the supported catalog keys explicitly, including
  region/script variants where used. Do not assume `en-US` and `en` are identical
  catalog keys. Obtain the source language from configuration or project metadata,
  not the first key in the JSON object.
- Treat an absent entry and an explicitly empty value separately; a blanket
  truthiness fallback such as `value || fallback` can undo intentional blank text.
- Enable ICU MessageFormat support for plural entries. Some i18n frameworks need
  an ICU adapter; a generic interpolation helper is not automatically compatible.
- Plain values and plural templates are not interchangeable. The exporter does
  not promise that every non-plural printf value has become an ICU template.

Keep format kind in the application's existing typed/catalog metadata rather than
guessing from a brace or percent sign in the visible text. If that metadata needs
to be obtained from Localize, `/resolved/web` provides each key's `plural` setting;
pair it with the rendered export from the **same named release**. The structured
response itself still contains raw formats. See
[exports](exports.md).

See [web plurals](web-plurals.md) for exact argument names and formatter examples.
Use stable underscore keys in code, e.g. `account_login` and `receipt_count`.
Typed wrappers or generated key types can live here if the project already uses
them; Localize's current CLI does not generate TypeScript accessors.

## 3. Use the module from UI code

Expose the project's usual text/formatting API from this module and pass numeric
counts and correctly typed arguments. Render translated results as text, not as
untrusted HTML. Rich-text support, if required, must use the framework's explicit
safe rendering mechanism rather than arbitrary HTML injection.

Recompute labels when the locale or arguments change. Cache compiled messages by
locale, message and catalog version, rather than caching formatted strings without
their arguments. Load only the needed locale chunks if the application's asset
strategy requires it.

For SSR, resolve the request locale on the server and provide the same locale and
catalog version to the browser. Do not independently choose a conflicting browser
locale on initial hydration. The user's later language change can follow the
application's existing navigation/state workflow.

## 4. Move existing translations deliberately

Reconcile catalogs and identifiers before replacing the existing source. Preserve
platform-specific wording and custom message contracts. A dot-to-underscore rename
must update call sites and generated types as well as the catalog; see
[renaming and merging](merge.md). Remove stale catalog copies
after the consumers have moved so a fallback cannot hide an obsolete key.

## Verification

- Check catalog shape, expected release, supported locales and fallback policy.
- Build/typecheck with the application's actual tooling and exercise both client
  rendering and SSR when present.
- Test language switching, missing translations, interpolation, escaping and
  [plural cases](web-plurals.md#zero-and-verification).
- Confirm application bundles/public assets contain translation data but no
  Localize credentials, and catalog updates invalidate stale formatter caches.
