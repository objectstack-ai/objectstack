---
"@objectstack/console": patch
---

Console (objectui) refreshed to `6fb31dcc9954`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 7 releasing of 7 changesets added across 7 non-merge commits.

- **patch** — `BulkActionDef.confirmText`'s template envelope types `source` as optional, as `@objectstack/spec`'s `Expression` does, and so does its zod twin (objectstack#25438). (objectui `6fb31dcc9`)
- **patch** — The import wizard now opens its mapping step with the object's saved mapping applied when the object ships exactly one that the target accepts (objectui#13343). Before, the step a… (objectui `d019aaae3`)
- **patch** — `AppShell` now draws one `main` landmark. `SidebarInset` already renders a `<main>`, and the content element inside it was a second `<main>`, so every console page (Setup record p… (objectui `8cf3a86eb`)
- **patch** — Setup's metadata deletes and the related list's row delete now ask in the console's in-app confirm dialog and name what goes (objectui#13333). (objectui `404ccae0d`)
- **patch** — A sidebar navigation group now opens on first view unless it declares `expanded: false` (or the legacy `defaultOpen: false`), however many entries it holds (objectui#13336). (objectui `fb25620e3`)
- **patch** — Console toasts no longer cover the page header's actions (objectui#13340). With no drawer open the toaster now sits top-centre, just below the console's top bar, instead of in the… (objectui `4603b8c4e`)
- **patch** — Publish from Home no longer reports a `defineCapability` declaration as a capability that resolves nowhere (objectui#7611). (objectui `f2f4b7dc3`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `1d178e06ac5e...6fb31dcc9954`
