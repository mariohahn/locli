# Integrating Localize with a backend service

## Catalog ownership

Use one service-local localization module or the existing shared backend library
for catalog loading, supported locales, fallback and formatting. Business features
such as emails and notifications consume that API; they should not query Localize
separately for every message.

This describes the **application's backend consuming translations**, not the
implementation or deployment of the Localize service. No particular backend
language or framework is required.

Example service layout:

```text
resources/localization/
└── backend.json
src/localization/
├── catalog-loader
├── locale-resolution
└── message-formatting
```

The extensionless source entries are conceptual responsibilities, not files or SDKs
provided by Localize. Adapt them to the service's actual language and module layout.

## 1. Acquire and package the catalog

Assign server-generated user-facing texts to the Backend platform. Use the backend
export for the intended approved release:

```text
GET /api/projects/<projectID>/export/backend?release=<release-name>
```

The export is JSON grouped by locale. Plain entries are text; plural entries are
ICU MessageFormat templates. Backend-specific variants take precedence over shared
values for their language. The [backend plural reference](backend-plurals.md)
contains the concrete JSON and formatting examples.

Acquire the export through the existing authenticated development/CI or trusted
service integration. Prefer a pinned release name for reproducible service artifacts;
`release=latest` is also available. Omitting `release` requests working state and
must be an explicit development choice.

Package the validated catalog with the service or use its existing versioned
configuration/artifact mechanism. Record the selected release alongside it using
the service's own metadata; the export does not invent a release field in the
locale dictionary. The iOS catalog CLI is not a backend-sync tool.

For the usual bundled-artifact model, load catalogs at startup and serve requests
from memory. If runtime refresh is an explicit product requirement, validate a new
catalog completely before atomically replacing the active version and its caches.
Do not make user-facing formatting depend on a successful live Localize request
for every message.

## 2. Resolve language per recipient

- Use the service's established request/user/recipient language policy and its
  supported locale list. Do not substitute the server process's default locale.
- For background jobs, resolve or carry the intended recipient language according
  to the product's delivery policy; there may be no HTTP request to consult.
- Define the fallback to the catalog's source language for missing locales/keys.
  Keep the resolved message locale with the selected template so plural selection
  follows the actual message's language.
- Resolve region/script tags against the supported catalog keys using the service's
  language policy. Source language comes from configuration/project metadata, not
  the first JSON property. An explicit empty text is distinct from a missing key.
- Never set a mutable global locale per request: concurrent recipients must not
  influence each other's output.

Decide whether an API returns localized prose or stable keys and arguments for a
client to format. Follow the existing contract; do not mix the two implicitly.

## 3. Format and deliver messages

Use an ICU MessageFormat-compatible implementation in the backend language for
plural entries. Verify the actual syntax supported by that library, including
number skeletons if the exported messages contain them. A printf formatter or a
plural-category API alone does not evaluate the complete ICU pattern.

Track whether a key is plain or plural using the service's existing typed metadata,
not by searching its text for braces. `/resolved/backend` can supply the key's
`plural` setting and source-language metadata; use the **same named release** as
the rendered JSON artifact. Its raw values are not themselves rendered ICU output.
See [exports](exports.md).

Expose semantic helpers with typed parameters where the service's style supports
them, such as a receipt-count message taking a recipient locale and numeric count.
Preserve underscore lookup keys and the exported argument contract. See
[backend plurals](backend-plurals.md) for Node.js examples and language-independent
rules; Localize does not supply an SDK for every backend stack.

Respect formatter thread-safety and cache by release, resolved locale and message.
Keep request-specific arguments out of shared mutable formatter state. Apply the
delivery channel's normal escaping/rendering rules after formatting, particularly
for HTML emails. A translation is not automatically trusted HTML or a safe URL.

## 4. Adopt existing texts

Inventory server-generated user-facing strings and current localization helpers.
Migrate feature by feature into the shared module, preserving wording, placeholder
types and delivery behavior. Handle duplicated dotted/underscore identifiers using
the [merge workflow](merge.md). Internal diagnostic logs are not
automatically translation candidates simply because they contain text.

## Verification

- Validate catalog loading and startup behavior with the intended release artifact.
- Build/test with the service's actual commands. Exercise recipient-language
  resolution, missing keys/locales, fallback and delivery-context escaping.
- Check [plural cases](backend-plurals.md#zero-and-verification), including parallel
  requests for different languages and queued notifications.
- If refresh is supported, test invalid catalog rejection, atomic replacement and
  formatter-cache invalidation. A failed refresh must not partially replace the
  active catalog.
