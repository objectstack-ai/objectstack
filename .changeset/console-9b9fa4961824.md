---
"@objectstack/console": minor
---

Console (objectui) refreshed to `9b9fa4961824`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 8 releasing of 10 changesets added across 19 non-merge commits; omitted: 2 release-nothing changesets, 9 commits carrying no changeset (they ship no package code).

- **minor** — fix(fields,plugin-form): stop the inline child grid from collapsing `datetime`/`time` columns onto the `date` control (objectui `1bd6faa61`)
- **patch** — Make the generated temp app pass the strict `tsconfig.json` the generator writes beside it, and gate it with a real `tsc` (objectui `9b9fa4961`)
- **patch** — List row Edit/Delete, bulk delete and related-list CRUD now run the caller's own permission, not just the object's API exposure (objectui#4096) (objectui `aeb8424ba`)
- **patch** — metadata-admin: wire client-side Zod validation for `sharing_rule`, `translation` and `connector` (objectui#3561) (objectui `877385a76`)
- **patch** — `evalRowPredicate`: the fail-closed report now names the engine's failure reason, and the ROW always wins over host scope (objectui#3792, objectui#3796) (objectui `6bb454ac0`)
- **patch** — Move the generator templates' dependency ranges onto the repo's current ones (objectui `c29ceffb8`)
- **patch** — A required field whose `defaultValue` is a runtime token is submittable from a create form (objectui `8497579db`)
- **patch** — `object-grid` publishes the filter key it actually reads: `filter`, singular (objectui#4041) (objectui `9154d9e90`)

**In this console build, declared nowhere** — objectui merged 9 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(console-starter): close the vite alias table over its real import graph (#4103) (objectui `0af9826ab`)
- _(no changeset)_ chore(deps-dev): bump the dev-dependencies group across 1 directory with 7 updates (#4088) (objectui `1592b2124`)
- _(no changeset)_ test(e2e): the console smoke test asserts a boot state the app actually settles in (#4086) (#4095) (objectui `361dfdc01`)
- _(no changeset)_ chore(deps): bump next from 16.2.12 to 16.3.0 (#4094) (objectui `47737ecb3`)
- _(no changeset)_ chore(deps): bump lucide-react from 1.28.0 to 1.29.0 (#4091) (objectui `a49a3a008`)
- _(no changeset)_ chore(deps): bump shiki from 4.3.1 to 4.4.2 (#4090) (objectui `ed5964304`)
- _(no changeset)_ chore(deps): bump maplibre-gl from 6.1.0 to 6.2.0 (#4092) (objectui `9920ae2d3`)
- _(no changeset)_ chore(deps): bump react-hook-form in the react group (#4089) (objectui `49396b524`)
- _(no changeset)_ chore(deps): bump the patch-updates group with 10 updates (#4087) (objectui `d897b74bc`)

objectui range: `8aad9fd50b16...9b9fa4961824`
