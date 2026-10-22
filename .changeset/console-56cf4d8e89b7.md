---
"@objectstack/console": patch
---

Console (objectui) refreshed to `56cf4d8e89b7`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 16 releasing of 18 changesets added across 19 non-merge commits; omitted: 2 release-nothing changesets, 1 commit carrying no changeset (they ship no package code).

- **minor** — The record page heading draws a `nameField` that declares a widget with a read face of its own through that face, the one the field's list column draws (objectui#13216). A record… (objectui `8701f1e76`)
- **patch** — The Import Wizard sends a CSV file to the import door as CSV text (objectui#13315). When you import a `.csv`, `.tsv` or `.txt` file, the request is now `format: 'csv'` with the ro… (objectui `56cf4d8e8`)
- **patch** — The console home blocks `hero`, `stat`, `usage-bar`, `checklist` and `tile-grid` register under the `app-shell` namespace, so the console no longer logs a "without a namespace is… (objectui `7e9708e63`)
- **patch** — The `/data` page's generated filter bar now offers single-value relation fields (`lookup`, `master_detail` and `user`) beside the picklist fields (objectui#13310). A relation chip… (objectui `78bd6d732`)
- **patch** — The Position preview lists the permission sets a position declares in `permissionSets` (ADR-0131 D4), by machine name in declared order. The "positions don't grant data access on… (objectui `279425409`)
- **patch** — The console line for a visibility predicate that cannot be evaluated, on a gate that withholds what it gates, no longer says "a navigation entry" was withheld. The same line is pr… (objectui `601c406dd`)
- **patch** — A page node whose declared `visibleWhen` / `visible` / `visibleOn` predicate cannot be evaluated (over the CEL bounds, a type error, an unbound root, a missing function) is no lon… (objectui `3aafc0d53`)
- **patch** — A password or secret input now tells the browser what it is for (objectui#13295). (objectui `813c3d973`)
- **patch** — Settings pages: a `url`, `email`, `phone` or `color` value that misses the format its type declares now blocks Save (objectui#13287). No request goes out, the row is marked inline… (objectui `0093b2c82`)
- **patch** — A `page:tabs` item whose `visibleWhen` faults on evaluation is no longer drawn (objectui#13286). (objectui `7c405b73a`)
- **patch** — The inline-edit save bar shows an object-level rule's refusal as the rule's own message, without a field label (objectui#13292). (objectui `f66973232`)
- **patch** — data-table: with row numbers on, the header's select-all checkbox, each row's checkbox and the row number now share one centre line in the leading column (objectui#13293). (objectui `c8f8b10ad`)
- **patch** — data-table / VirtualGrid: selecting a cell's text no longer opens the record or starts an inline edit, and Ctrl/Cmd+C copies the selected text instead of the whole cell value. A p… (objectui `fbb4b23bf`)
- **patch** — The Approvals Inbox opens a request on the page the platform serves for it, and its side sheet is gone (objectui#12484). (objectui `a91f6bbb1`)
- **patch** — The package dialog's Dependencies row is now an author-facing editor (objectui#13278). It used to be the spec form's raw JSON box under the developer hint "widget object-fields —… (objectui `53dea27af`)
- **patch** — The app's report index (`/apps/APP/reports`) and the ⌘K palette's report list now include the reports a module contributes to the app's navigation (`navigationContributions`), not… (objectui `9e1bff63a`)

**In this console build, declared nowhere** — objectui merged 1 commit in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared it, so it appears in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ chore: release packages (#11600) (objectui `3aa2f5261`)

Metadata-protocol: none (the console refresh changes no key, value or type a metadata author writes)

objectui range: `cf153eb2e535...56cf4d8e89b7`
