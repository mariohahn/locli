# App Store and Google Play listing texts

Localize can hold the store page copy per language. An owner enables **App Store**
and/or **Google Play** under *Projekt → Einstellungen → Store-Texte*; Localize then
creates the fields below. They are edited on the **Store-Texte** page, not in the
text list, ship with the next release like app texts, and never appear in app
exports (`.xcstrings`, `strings.xml`, web/backend JSON).

| Key | Field | Limit | Required |
| --- | --- | --- | --- |
| `appstore.name` | App name | 30 characters | yes |
| `appstore.subtitle` | Subtitle | 30 characters | no |
| `appstore.promotionalText` | Promotional text (changeable without a new version) | 170 characters | no |
| `appstore.description` | Description, plain text | 4000 characters | yes |
| `appstore.keywords` | Comma-separated search terms | **100 UTF-8 bytes** | yes |
| `appstore.releaseNotes` | What's new (required for updates) | 4000 characters | no |
| `appstore.supportURL` / `appstore.privacyPolicyURL` | URLs | http(s) | yes |
| `appstore.marketingURL` | URL | http(s) | no |
| `googleplay.title` | App name | 30 characters | yes |
| `googleplay.shortDescription` | Short description | 80 characters | yes |
| `googleplay.fullDescription` | Description | 4000 characters | yes |
| `googleplay.releaseNotes` | What's new | 500 characters | no |

- Characters are counted as Unicode code points; umlauts count twice for keywords.
  Over-long texts and invalid URLs are rejected with 422 and block a release.
- No placeholder checks (`100 % gratis` is fine), no plurals, no platform variants.
- These keys are managed: do not rename them, create look-alikes or apply the
  `lower_snake_case` convention to them.
- Keywords are chosen per market, not translated literally; do not repeat the app name.

## Export

```text
GET /api/projects/<projectID>/store/appStore?release=<release-name|latest>
GET /api/projects/<projectID>/store/googlePlay?release=<release-name|latest>
```

```json
{
  "store": "appStore",
  "release": "1.4.0",
  "locales": [
    { "code": "de", "name": "Deutsch", "isBase": true,
      "fields": { "name": "…", "description": "…", "keywords": "…" } }
  ]
}
```

Without `release` it returns the unreleased working state (`"release": null`).
Empty fields are omitted. Localize stores no store credentials and does not upload:
map this JSON to the project's own tooling (fastlane `deliver`/`supply` metadata
folders, Gradle Play Publisher, a script) or copy per field from the page. Map
Localize locale codes to store locales explicitly (e.g. `de` → `de-DE`).
