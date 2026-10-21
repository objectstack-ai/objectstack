---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

feat(spec)!: a list's `addRecord` block says what renders — `enabled` is required, `position` defaults to `top`, and `mode` / `formView` are retired

Clause-②: yes (narrowing)

<!-- adr-0087: registered add-record-mode-form-view-removed, add-record-enabled-defaulted, add-record-mode-form-view-retired, add-record-enabled-required -->

**BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes, and in 18.x under the standing rule for breaking narrowings: an ADR-0087 conversion carries every body that parsed under 18.0, so no stored row or built artifact is refused.

`AddRecordConfigSchema` — the `addRecord` block on a list view, an object's or a view container's `listViews`, a list page's `interfaceConfig` and a page `list-view` node — declared defaults the renderer never applied (`enabled` `true`, `position` `bottom`, `mode` `inline`) and two keys no renderer read. The list's Add button is drawn only for an explicit `enabled: true`, an absent `position` renders at the top, and every Add opens the object's create form. The block now says exactly that:

- **`enabled` is REQUIRED, with no default.** `addRecord: {}` is refused at parse (`os validate`, `os build`, the save doors) with a prescription naming the key, instead of drawing nothing.
- **`position` defaults to `top`**, where the renderer has always placed an absent position. Values stay `top` / `bottom` / `both`. No screen moves.
- **`mode` and `formView` are `retiredKey()` tombstones** (ADR-0049 enforce-or-remove): authoring either is a `tsc` error and a parse error carrying the prescription. The create form is chosen by convention instead: the create entry opens `formViews.create` when the object's view container declares it, else `form` (or `formViews.default`). How that form opens stays the renderer's.

### FROM → TO

| before | after |
| --- | --- |
| `addRecord: {}` (parsed as `enabled: true`, drew nothing) | refused: write `addRecord: { enabled: true }` |
| `addRecord: { position: 'bottom' }` | refused: write `addRecord: { enabled: true, position: 'bottom' }` |
| `addRecord: { enabled: true }` (parsed `position: 'bottom'`) | parses as `position: 'top'`, where it always rendered |
| `addRecord: { enabled: true, mode: 'form' }` (any `mode`) | `addRecord: { enabled: true }` |
| `addRecord: { enabled: true, formView: 'create' }` | `addRecord: { enabled: true }`, with the form declared as `formViews.create` on the object's view container |

**The one-line fix:** delete `mode` and `formView`, and write `enabled: true` (or `enabled: false`) on every `addRecord` block. `os migrate meta --from 17` lists the edits for existing metadata sources; `--write` applies the ones it can prove, and you apply the rest by hand.

### The ADR-0087 disposition

- D2 `add-record-mode-form-view-removed` strips `mode` and `formView` from every `addRecord` block it reaches (`stack.views[]` in all three persisted spellings, `objects[].listViews.*`, `pages[].interfaceConfig` and every page `list-view` node), with a notice per key. Lossless in pixels: no renderer read either key.
- D2 `add-record-enabled-defaulted` writes `enabled: true`, the default the 18.0 spec declared, onto a block that omits `enabled`, with a notice. Measured before choosing it: no producer in this repository (the showcase's two blocks, the lint fixture) or in objectui's Studio design surface writes `addRecord` without `enabled`, so the conversion carries the narrowing with a zero measured population. **One visible consequence, stated:** a stored block that omitted `enabled` drew no Add button, because the renderer read the raw body; converted, it draws the button its declaration always promised. To keep a list without one, write `enabled: false` or drop the block. An explicit `enabled` value is never touched.
- Both are retired from the load path: a live author is refused at parse and taught; stored rows, built artifacts inside their declared-floor window and `os migrate meta --from 17` replay them.
- `RETIRED_KEYS_BY_MAJOR[18]` gains `ui/AddRecordConfig:mode` and `ui/AddRecordConfig:formView`; the D3 entries are `add-record-mode-form-view-retired` and `add-record-enabled-required`; the default moves (`enabled` `true` → none, `position` `bottom` → `top`) are declared in `DEFAULT_CHANGES_BY_MAJOR[18]`.

### Also in this change

- The Studio view form and page form offer exactly `enabled` and `position` for `addRecord`.
- `@objectstack/lint`: `os explain list-view-field-unknown` no longer names `addRecord.formView` as a position another rule checks.
- The showcase's two `addRecord` blocks and the docs (`ui/create-vs-edit-form`, `ui/views`) drop `mode` / `formView` and state the create-form convention.
