---
'@objectstack/spec': minor
'@objectstack/mcp': patch
'@objectstack/cloud-connection': patch
---

feat(spec)!: a page region named `main` takes only `width: 'full'` — `'small'`, `'medium'` and `'large'` there are refused at publish (#24326)

Clause-②: yes (narrowing)

<!-- adr-0087: registered page-main-region-width-refused, page-main-region-width-removed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention.

`PageRegionSchema.width` is one enum shared by every region, so a `main` region accepted `'small'`, `'medium'` and `'large'`. The console never read them: every layout draws `main` at the width the layout leaves it (the flexible column beside `sidebar` and `aside`; one grid cell on `dashboard`), and the only reader of `main.width` is the page itself, for `'full'`, which lifts the page's max-width cap. A three-column page that asked for a `large` main got the space the two rails left, and every door reported success.

- `PageSchema` now refuses `width: 'small' | 'medium' | 'large'` on a region named `main` (matched case-insensitively, as the console matches it), at `regions.N.width`, on every page kind and template. The message names the region and `'full'` as the one width it takes. The doors are `definePage`, `defineStack` (so `os validate` and `os build`, `STACK_SCHEMA_INVALID` 422) and the metadata save door (422 `INVALID_METADATA`).
- `'full'` on `main` is unchanged, with its page-wide meaning. Every other region accepts the same widths as before.
- The check is exported as `checkPageMainRegionWidth` from `@objectstack/spec/ui`, so a mirror built from `PageSchema.shape` can attach the same rule.
- Data at rest keeps loading: the retired ADR-0087 conversion `page-main-region-width-removed` deletes those widths on read: a stored page row, a compiled artifact inside the window its declared protocol range opens, and a package body registered with its declared range. The page renders exactly as before.
- `@objectstack/mcp` (the Connect an Agent page) and `@objectstack/cloud-connection` (the Cloud Connection page) drop `width: 'large'` from their `main` region. Both render the same.

### Migration: FROM → TO

| Wrote | Write instead |
| :--- | :--- |
| `width: 'small' \| 'medium' \| 'large'` on a region named `main` | drop it; `'full'` stays |

Deleting the key changes nothing on screen. Write `width: 'full'` only when you want a full-bleed page, which drops the page's max-width cap.
