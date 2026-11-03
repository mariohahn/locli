# Exports and API endpoints

For anything the [iOS CLI](cli.md) does not cover. Endpoints need an authenticated
integration (development, CI or a trusted server, never a browser or app binary) and
use the project **ID**, not the slug. URL-encode release names.

`?release=<name>` exports a frozen release, `?release=latest` the newest one, no
parameter the unapproved working state. Prefer a pinned name for reproducible builds.

| Need | Endpoint | Notes |
| --- | --- | --- |
| iOS catalog | `GET /api/projects/<id>/export/ios?format=xcstrings&release=…` | All languages and plurals. `.strings` (no `format`) is base language only and rejects plurals. Draft values carry state `needs_review`. |
| Android XML | `GET /api/projects/<id>/export/android?release=…` | `<string>`, `<plurals>`, `<string-array>`, **source language only**. Other `values-<locale>` need a generator. |
| Web / backend JSON | `GET /api/projects/<id>/export/web\|backend?release=…` | One object keyed by locale code; plural entries are ICU messages. The app owns fallback and formatting. |
| Any platform, structured | `GET /api/projects/<id>/resolved/<platform>?release=…` | Every locale's effective values (variants already applied), `identifier`, `valueKind`, `plural.argument`, `forms`, `items`. Raw printf formats: a generator converts and escapes. The basis for multi-language Android. |
| Store listing texts | `GET /api/projects/<id>/store/appStore\|googlePlay?release=…` | See [store listings](store-listings.md). |

- When combining `resolved` metadata with a rendered export, request the **same
  explicit release name** for both; two `latest` calls can straddle a new release.
- Locale-keyed JSON does not declare the source language: take it from the project
  or the structured response.
- Only keys assigned to the platform are exported; store texts never are.
- The CLI does not generate Swift/TypeScript accessors or multi-language Android
  XML, and there is no history-preserving merge endpoint ([merge workflow](merge.md)).
  Name such gaps instead of implying they exist.

Platform consumption: [iOS](ios-integration.md), [Android](android-integration.md),
[web](web-integration.md), [backend](backend-integration.md).
