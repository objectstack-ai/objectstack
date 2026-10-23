---
"@objectstack/console": patch
---

Console (objectui) refreshed to `0d12e95361b2`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 2 releasing of 3 changesets added across 5 non-merge commits; omitted: 1 release-nothing changeset, 2 commits carrying no changeset (they ship no package code).

- **minor** — An approver who is not an administrator sees the whole approval request page again: its fields, its decision panel with the decisions they may take, and its Timeline (objectui#133… (objectui `0d12e9536`)
- **patch** — Setup → Datasources offers "Sync objects" only on a datasource that can be synced (objectui#13318). (objectui `b8fa2237d`)

**In this console build, declared nowhere** — objectui merged 2 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ fix(pin): the missing-entry remedy builds with declarations whatever OS_SKIP_DTS is exported (#13325) (objectui `74ebad095`)
- _(no changeset)_ fix(hooks): port subst_end() into guard-main-checkout-bash (objectstack 7e40e8a03 and 338297e46) (#13320) (objectui `1aa88519a`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `cd14d8eeffe1...0d12e95361b2`
