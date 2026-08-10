---
"@objectstack/console": patch
---

Console (objectui) refreshed to `1b6188d41cbc`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 2 releasing of 2 changesets added across 3 non-merge commits; omitted: 1 commit carrying no changeset (they ship no package code).

- **patch** — Align 43 inline `defaultValue` strings with the `en` pack, and make the call-site gate enforce it (objectui#3810) (objectui `297534b78`)
- **patch** — Fix `objectui init`'s scaffold failing its own `npm run build`, and put the third generator under the real `tsc` gate (objectui `64cda47e7`)

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(data-objectstack): describe the real dependency contract, not a peer one (#3781) (#4127) (objectui `1b6188d41`)

objectui range: `cfeb378b51f1...1b6188d41cbc`
