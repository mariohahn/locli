# Features (Git branches)

A feature groups the texts a Git branch introduced. It is a label for overview and
filtering only: it does not approve, block or ship anything. Releases stay the only
way texts reach apps.

## How keys get a feature

- `push`/`init` detects the catalog repository's branch (`git rev-parse --abbrev-ref HEAD`).
  CI checks out a detached HEAD, so these variables win, in order: `LOCALIZE_BRANCH`,
  `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, `CI_COMMIT_REF_NAME`, `BITRISE_GIT_BRANCH`.
  `--branch <name>` overrides everything.
- Keys **created** by a push from a feature branch join that branch's feature, named
  from the branch (`feature/belege-import` → "Belege Import"; renameable in Localize).
  Existing keys keep their origin. New keys pushed after a merge reopen the feature.
- A push from `main`/`master` never creates a feature. It reports every catalog key;
  a feature becomes **merged** once its texts appear there.
- Keys of a feature that the latest catalog no longer contains (branch while open,
  main once merged) are listed as "nicht mehr im Code" for cleanup, e.g. after a rename.
- Keys created in the web app can be assigned to an open feature when created.

## API

| Call | Purpose |
| --- | --- |
| `POST /api/projects/<id>/translations/import` with `branch` | New keys join the branch's feature; the response contains `feature`. |
| `POST /api/projects/<id>/features/sync` `{branch, keys}` | Sent by the CLI after `push` with all catalog keys; returns `feature` and newly `merged` features. |
| `PATCH /api/projects/<id>/features/<featureID>` `{title}` | Rename. |
| `POST /api/projects/<id>/features/<featureID>/cleanup` | Delete the texts no longer in the code. |
| `DELETE /api/projects/<id>/features/<featureID>[?keys=delete]` | Remove the feature (texts stay) or discard it with its texts. |

`GET /api/projects/<id>` lists `features`; keys carry `featureID`.

## Agent rules

- Push from the branch you are working on; do not pass `--branch main` from a feature
  branch, which would skip the grouping (and merge detection relies on real main pushes).
- Cleanup and discarding delete texts in every language: leave both to the user.
