# Integrating Localize with iOS apps and extensions

## Recommended resource ownership

For an application with widgets, notification/share extensions or other consumers
of the same texts, prefer a small **shared localization Swift package**:

- One source String Catalog and one Localize sync configuration.
- Public typed accessors for ordinary texts and parameterized/plural texts.
- Resource lookup inside the package using `Bundle.module`.
- The app and each extension link the same library product directly.

Reuse an existing shared localization/resource module if it already meets these
requirements. A single-target application can keep an app-owned catalog; adding a
package is useful for shared ownership, not a requirement imposed by Localize.

There is one maintained catalog in source control, but each built consumer receives
the resources it needs. This is not a shared writable file between running
processes. No App Group, Localize SDK or runtime network connection is required
for bundled strings.

## 1. Package layout

Example application repository:

```text
Application/
├── Config/
│   └── localize.json
├── Scripts/
│   └── localize.sh
├── Packages/
│   └── AppLocalization/
│       ├── Package.swift
│       └── Sources/
│           └── AppLocalization/
│               ├── AppStrings.swift
│               └── Resources/
│                   └── Localizable.xcstrings
├── MyApp/
└── MyWidgetExtension/
```

`Packages/AppLocalization/Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AppLocalization",
    defaultLocalization: "de",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "AppLocalization", targets: ["AppLocalization"])
    ],
    targets: [
        .target(
            name: "AppLocalization",
            resources: [.process("Resources")]
        )
    ]
)
```

Adapt the Swift tools and minimum iOS version to the application. This example
uses Xcode 15+ String Catalog tooling and a German source language.
`defaultLocalization`, the catalog's `sourceLanguage` and Localize configuration
must agree. Use `.process`, not `.copy`, so the Xcode build processes the catalog
into localized resources. Validate through the actual Xcode app/extension build;
a plain `swift build` alone is not proof of String Catalog compilation and embedding.

Place the catalog inside the target's declared resources. For a new package, the
complete [plural catalog example](ios-plurals.md#complete-basic-catalog-example)
provides `receipt_count`. Add `account_login` as an ordinary entry with, for example,
German "Anmelden" and English "Sign in". Existing projects should move their actual
catalog, preserving translations, comments and plural structures.

## 2. Public typed accessors

Keep `Bundle.module` usage in the package target; it is generated for that target
and is not the application's or extension's main bundle.

`Sources/AppLocalization/AppStrings.swift`:

```swift
import Foundation

public enum AppStrings {
    public static var accountLogin: String {
        String(
            localized: "account_login",
            bundle: .module,
            comment: "Button that starts sign-in"
        )
    }

    public static func receiptCount(_ count: Int64) -> String {
        let format = String(
            localized: "receipt_count",
            bundle: .module,
            comment: "Number of receipts in the overview"
        )
        return String.localizedStringWithFormat(format, count)
    }
}
```

The Swift member may use camelCase, while the **catalog lookup identifier remains
`lower_snake_case`**. Preserve literal lookup keys so Xcode extraction can see them.
Prefer the project's existing generated accessor system when it correctly supports
package bundles and plural formats. Configure its input to this same catalog;
Localize's CLI does not generate Swift accessors itself.

Expose semantic functions with typed arguments rather than requiring each target
to assemble format strings or know the bundle location. `%lld` is supplied with
`Int64`; additional arguments must preserve the positions and types documented in
[iOS plurals](ios-plurals.md#multiple-arguments-and-quantity-selection).

Keep the package extension-safe: Foundation and resources are sufficient for these
helpers. It should not depend on the host app, `UIApplication.shared`, app-only
services or authentication/networking merely to resolve a string.

Use computed properties/functions rather than caching localized strings in global
constants. These examples use Foundation's language selection; a SwiftUI-only
`environment(\.locale, ...)` override does not change them automatically. If the
app supports an explicit in-app language preference, use its existing language-aware
lookup/formatting mechanism inside the package and verify the extension's language
selection too. Persisting a custom preference across processes is a separate concern
from sharing the package's resources.

## 3. Link every consuming target

In Xcode, add the local package at `Packages/AppLocalization`, then add the
**AppLocalization product** to:

1. The application target.
2. Each widget, share or notification extension that uses its strings.
3. Any other target or shared feature package directly importing the module.

Use the equivalent dependency declarations if the project is generated by Tuist,
XcodeGen or another existing project generator. Adding the dependency to the app
alone does not make it available to separately compiled extension code.

In both app views and widget/extension views:

```swift
import AppLocalization
import SwiftUI

struct ReceiptSummary: View {
    let count: Int64

    var body: some View {
        VStack {
            Text(verbatim: AppStrings.accountLogin)
            Text(verbatim: AppStrings.receiptCount(count))
        }
    }
}
```

The result is already localized; render it verbatim. Do not replace the accessor
with `Text("receipt_count")`, which defaults to a different bundle and supplies no
quantity, or `Text("receipt_count \(count)")`, which creates a different lookup key.

Ensure the app and extension declare the intended supported languages and
development language, not only the package. Inspect Xcode localization settings and,
where needed, `CFBundleLocalizations` / `CFBundleDevelopmentRegion`. Test language
selection in both built targets instead of assuming a package resource automatically
advertises all languages for every host.

Bundle metadata is separate: target-owned `InfoPlist.strings`, display names and
permission descriptions may need to remain in their respective application or
extension bundles because the OS reads them there. Moving these into a package
catalog does not redirect the OS lookup. Apple-defined metadata keys are also not
application identifiers to rename into snake_case.

## 4. Point Localize at the package catalog

**The existing sync script needs no implementation change for a local Swift
package.** It already reads `catalog` from the configuration and resolves it
relative to that file. Change the configured path; `push` and `pull` keep working
with the same commands. Keep the existing wrapper unchanged when it already points
to the correct configuration. The Swift-side change is resource ownership and
bundle-aware lookup, not a different sync protocol.

For the directory layout above, `Config/localize.json` contains:

```json
{
  "apiURL": "https://localize-backend.fly.dev",
  "name": "Example App",
  "slug": "example-app",
  "sourceLanguage": "de",
  "locales": { "de": "German", "en": "English" },
  "catalog": "../Packages/AppLocalization/Sources/AppLocalization/Resources/Localizable.xcstrings"
}
```

The path is relative to `Config/localize.json`. Both app and extensions consume
the iOS export from the same Localize project; an extension is not a new platform.
Do not invent a `widget` platform or separate identifier copies for the same text.
Widget-specific concepts can have their own semantic keys, e.g. `widget_empty_title`,
in the same catalog.

With `@locli/cli`, the same applies to `locli.json`: point the `ios` target's `path`
at the package catalog (relative to `locli.json`), e.g.
`{ "platform": "ios", "format": "xcstrings", "path": "Packages/AppLocalization/Sources/AppLocalization/Resources/Localizable.xcstrings" }`,
and run `npx @locli/cli push` / `pull`. New apps use this instead of a wrapper.

Older apps: reuse the existing `Scripts/localize.sh`. Such a wrapper typically calls
an explicitly configured Localize checkout:

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${LOCALIZE_ROOT:?Set LOCALIZE_ROOT to the Localize checkout}"
exec python3 "$LOCALIZE_ROOT/scripts/localize-ios.py" \
  "${1:-pull}" --config "$SCRIPT_DIR/../Config/localize.json" "${@:2}"
```

Run it from the application repository as documented in [CLI](cli.md).
Synchronization updates this single source catalog. Run it before the Xcode build,
not independently from both targets' parallel build phases. CI should pull an
approved release using its existing secret configuration; do not put `login` or
credential prompts inside a package/plugin or an extension build.

## 5. Moving an existing app-owned catalog

1. Find all catalog owners, copies, lookup helpers and app/extension call sites.
   Reuse an appropriate shared module if one already exists.
2. Move the canonical catalog into the resource target, preserving all data. If
   app and extension copies differ, reconcile them before deleting either copy;
   use the [merge workflow](merge.md) for name conflicts.
3. Update Localize's configured path and any accessor generator input.
4. Change callers to the package accessors or the project's equivalent package-aware
   API. Remove obsolete target membership/build-phase copies after all lookups have
   moved; otherwise a stale main-bundle copy may mask a wrong lookup.
5. Handle OS-owned metadata separately, as described above.
6. Build and run every consumer before considering the migration complete.

## Verification

- The configured catalog path resolves to the package's resource file. Source
  language and package default localization match.
- The app and extension both compile with their own direct package dependency.
  Inspect their built products to confirm the expected processed resources are
  present; do not hard-code SwiftPM's generated resource-bundle filename in code.
- Run ordinary strings and plural counts 0, 1, 2 and a larger value in at least
  two languages. Check both the app and an independently launched widget/extension,
  including when the host app is not running.
- Missing lookup keys must not appear as UI text. A working host-app lookup is
  insufficient evidence for an extension's resource wiring.
- Review the catalog diff after `pull`; repeated synchronization must not create
  app/extension duplicates or bring back dotted identifiers.
- Use the application's existing Xcode schemes/build/test commands. A package-only
  compile or JSON validation does not replace target-level runtime verification.
