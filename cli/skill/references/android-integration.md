# Integrating Localize with Android

## Resource ownership

For an Android application with multiple feature modules or other consumers of
the same texts, prefer one shared **Android library resource module**, for example
`:localization`. Reuse an existing resource/design-independent localization module
when appropriate. A single-module app can keep resources in its app module.

This must be an Android resource-owning module, not a plain Kotlin/JVM module:
Android's build tools generate the `R` identifiers and compile localized resources.
Keep one maintained set of XML resources rather than editable copies in each feature.

## 1. Module structure and dependencies

Example layout:

```text
Application/
├── settings.gradle.kts
├── app/
├── feature-orders/
└── localization/
    ├── build.gradle.kts
    └── src/main/res/
        ├── values/localize.xml
        └── values-de/localize.xml
```

Register the module in the existing Gradle settings:

```kotlin
include(":localization")
```

In `localization/build.gradle.kts`, use the project's configured Android library
plugin and SDK conventions. This is the relevant configuration, not a standalone
replacement for the project's Gradle setup:

```kotlin
plugins {
    id("com.android.library")
}

android {
    namespace = "com.example.localization"
    // Apply compileSdk/minSdk and other required settings from project conventions.
}
```

Every module that directly consumes these resources needs the dependency:

```kotlin
dependencies {
    implementation(project(":localization"))
}
```

Use `com.example.localization.R` for the module's resources, particularly with
non-transitive `R` classes. Namespace/product names are project-specific; do not
copy the example package name into an unrelated application's existing conventions.

## 2. Obtain the Android export

Assign the keys to Android in Localize and select an approved release in the export
UI or use the existing authenticated build integration with:

```text
GET /api/projects/<projectID>/export/android?release=<release-name>
```

`release=latest` is available; pinning a release name gives a reproducible
application build. The older `localize-ios.py` script does not synchronize Android
resources.

**Preferred:** an `android-xml` target in `locli.json` (`path` = the module's `res/`
directory, optional `file`, e.g. `localize.xml`). `npx @locli/cli push` uploads the
source strings, plurals and arrays; `npx @locli/cli pull` writes every language into
`values-<qualifier>/` from `resolved/android`, with escaping and printf conversion
([CLI](cli.md)). The manual export below is for builds without the CLI.

Place the XML in the resource-owning module, for example
`localization/src/main/res/values/localize.xml`. Preserve its resource names and
escaping; one resource identifier must not be defined twice in the same configuration.
The base values directory must contain the application's intended default texts.

**Limitation of the raw export:** Direct Android XML export returns the project's source
language only. The `values-de` directory in the layout illustrates Android's locale
structure, not an additional language downloaded automatically by this endpoint.
Use `npx @locli/cli pull` or the application's existing locale-aware resource generator
for other languages. If neither exists, that integration is still required before claiming multi-language
Android sync is complete. Do not copy one language into another directory or invent
an unsupported locale flag.

For a custom generator, an existing all-locale source is:

```text
GET /api/projects/<projectID>/resolved/android?release=<release-name>
```

It provides effective Android values for every available locale, including plural
forms, array items and the selector. This is **format-neutral data**, not generated
XML. A generator still needs locale-to-resource-directory mapping, printf-to-Java
format conversion, Android/XML escaping, category handling and resource compilation
tests. Preserve the exported identifier and distinguish missing values from explicit
empty values. If the project has no such generator, record the gap rather than
claiming the XML endpoint downloaded every language. See the
[exports](exports.md).

## 3. Consume resources

For ordinary text:

```kotlin
import com.example.localization.R

val label = context.getString(R.string.account_login)
```

In Compose, use `stringResource` for ordinary strings. For plurals use
`getQuantityString` / `pluralStringResource` and supply the numeric quantity and
format arguments, as shown in [Android plurals](android-plurals.md). String arrays
use `getStringArray`; they are not plural forms.

Use a context/resources instance reflecting the application's selected language.
Do not cache localized results forever across locale changes. App widgets using
RemoteViews or Glance can consume the same resources, but must perform lookup in
their own execution context; sharing a module does not itself share a custom
language-preference implementation.

## 4. Migrate existing resource copies

Reconcile duplicate app/feature resources before moving them into the shared
module. Preserve identifiers, translations and plural forms. Update imports and
resource references, remove obsolete duplicate definitions, and build all consumers.
Use the [merge workflow](merge.md) for dotted/underscore
counterparts; never create Android-specific copies merely to get underscore names.

Export acquisition belongs in the existing authorized development/CI workflow.
Do not package a Localize access token into the APK/AAB or fetch authenticated
catalogs from Localize for each UI lookup. Bundled text normally ships with the app.

## Verification

- Build the resource module and every consuming target with the project's actual
  Gradle tasks; resource compilation must succeed, including plural formatting.
- Check default and supported app languages on device/emulator, including widgets
  and language changes. Confirm fallback when a locale lacks a value.
- Verify no conflicting resource definitions or stale module imports remain.
- Exercise [plural runtime cases](android-plurals.md#zero-and-verification) and
  inspect the resource diff/release used by the build.
