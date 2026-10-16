---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(spec)!: a page declares nothing the console does not honour — `isDefault: true` is refused off a record page bound to an object, `template` closes to the registered layouts, and a region the template does not place is refused

Clause-②: yes (narrowing)

**BREAKING (authoring):** two accept sets of `PageSchema` narrow to what the console runs, and the `PageTypeSchema` text stops promising what it does not.

| Writing | Before | Now |
| :--- | :--- | :--- |
| `isDefault: true` on a `home`, `app`, `utility` or `list` page, or on a record page with no `object` | accepted, stored and served; nothing read it | refused at `isDefault` — by `definePage`, `defineStack` (so `os validate` and `os build`, `STACK_SCHEMA_INVALID` 422), the metadata save door (`422 INVALID_METADATA`) and package registration (`SchemaRegistry.installPackage` / `registerItem`, `422 INVALID_METADATA`) |
| `template: 'full-width'` | accepted; drawn exactly as `default` | refused by name: "Page `template: 'full-width'` was removed in @objectstack/spec 18 … Use `template: 'default'`" |
| any other `template` outside `default`, `header-sidebar-main`, `three-column`, `dashboard` (`two-column`, `single-column`, …) | accepted; drawn as the page type's default layout | refused at `template` |
| on a `kind: 'full'` page, a region its template does not place (`left_sidebar`, `right_sidebar`, `content`, …) | accepted; stacked under `main` at full width, its `width` ignored | refused at `regions.N.name`, naming the template's slots and the rename |
| on a `kind: 'full'` page, a second region filling a slot an earlier one fills (two `main` regions; on `dashboard`, a second `header` or `footer`) | accepted; not drawn at all — the console draws the first region of a name and leaves that name out of the rest | refused at `regions.N.name`, naming the region that already fills the slot |

Migration:

- **`isDefault` on a non-record page** → delete it. A page does not choose where an app opens: an app's landing page is its **first navigation item** (by `order`), so to land on the page put its entry first in the app's `navigation`; the root landing follows the app's own `isDefault`. A record page meant as an object's default record page binds that object with `object`.
- **`template: 'full-width'`** → `template: 'default'` (or delete the key — `default` is the default). The page renders exactly as before.
- **A `template` held in a widened `string`** (a shared base object, `{ template: 'default' }` spread into `definePage`) no longer type-checks against the closed set → `template: 'default' as const`.
- **An unregistered template** → one of `default` (header, sidebar, main, aside, footer), `header-sidebar-main` (header, sidebar, main), `three-column` (header, sidebar, main, aside, footer) or `dashboard` (header, footer, and every other region a grid cell).
- **An unplaced region** → name it for the slot it fills: `left_sidebar` → `sidebar`, `right_sidebar` → `aside`, `content` → `main`; or choose `dashboard` when the regions are a grid. Names match case-insensitively, as the console's do. `slotted`, `html` and `react` pages are not judged on region names.
- **A second region for a filled slot** → move its components into the first region of that name, or name it for an unfilled slot. On `dashboard`, two regions of any other one name stay two grid cells and are accepted.

The template set and each template's slots are now published: `PageTemplateSchema`, `PAGE_TEMPLATE_SLOTS` and `PAGE_TEMPLATE_OPEN_GRID` (`@objectstack/spec/ui`), with the two checks `checkPageDefaultPlacement` and `checkPageRegionPlacement` and the one refusal sentence `misplacedDefaultPageRefusal` that the parse and the registry share.

`os migrate meta` lists both as hand edits — the D3 entries `page-is-default-off-record-page-refused` and `page-template-closed-region-unplaced-refused`. No D2 conversion rewrites them: where an app opens, and which slot a region fills, are the author's calls.

**Stored metadata keeps loading.** No conversion touches these shapes and the read path does not refuse them, so a `sys_metadata` page row already stored with a non-record `isDefault: true`, `template: 'full-width'` or an unplaced region is served unchanged and renders as before (a stored row hydrates into the registry without a package, so the registry does not judge it either). Saving such a row again through the metadata API is refused until it is fixed.

The text, without a contract change: `PageTypeSchema`'s docblock and enum comments now say that `home`, `app` and `utility` are the same region layout at three content widths — `home` is not a landing declaration, and `utility` is an ordinary inline page (the console has no floating or docked shell slot for it); `utility` stays a page type, read by the print door and the page-type width. The `print`-on-`utility` refusal no longer calls a utility page "a floating panel".

`@objectstack/objectql`: the registry refuses `isDefault: true` on a non-record page a package registers (`MisplacedDefaultPageError`, `INVALID_METADATA` 422), at the package door and at the package-bound item seam, with the page parse's sentence.

<!-- adr-0087: registered page-is-default-off-record-page-refused, page-template-closed-region-unplaced-refused -->
