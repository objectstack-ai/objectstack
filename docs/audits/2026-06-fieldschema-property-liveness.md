# Audit: FieldSchema property liveness & necessity

**Date**: 2026-06-15
**Scope**: `packages/spec/src/data/field.zod.ts` — the ~60 core properties of `FieldSchema`.
**Method**: cross-reference each property's **spec definition** against its **consumers** by `file:line`, in two layers — (1) framework runtime (`@objectstack/objectql` engine + validators, `driver-sql` DDL, `@objectstack/rest`, formula/rollup, secret/encryption services) and (2) objectui renderers (`plugin-form`, `plugin-grid`, `fields` widgets, `app-shell` metadata-admin). A property is **LIVE** when at least one layer reads it and changes behavior; **DEAD** when only the spec definition / `*.form.ts` UI hint / lint / tests reference it. Browser observation was deliberately *not* used as the liveness signal — an unreactive UI can't distinguish "property is dead" from "data didn't trigger it".

> This is an evidence catalog intended to seed an ADR (spec hygiene). It makes no decisions; it states what is wired and proposes options.

## Headline

Of ~60 core `FieldSchema` properties, **roughly half are DEAD** — defined in the protocol but consumed by neither the runtime nor the renderers. Authors who set them get **silent no-ops**. There are also **camelCase↔snake_case naming-drift bugs** where a documented property is read under a *different* key, and **nested-config-vs-flat duplication** where the nested object is dead and only flat siblings are read.

| Bucket | Count (approx) | Action |
|---|---|---|
| LIVE & necessary (core) | ~26 | keep |
| LIVE with caveat | 4 | document / complete |
| LIVE but "fake-alive" (naming drift) | 3 | **rename-fix** (normalize keys) |
| DEAD — redundant (superseded by object/dataset-level) | 4 | **remove or wire** |
| DEAD — nested config duplicating live flat props | 3 | **二选一 (pick one)** |
| DEAD — aspirational enhanced-type / governance config | ~20 | **remove or mark experimental** |

---

## 1. "Fake-alive" — naming drift (highest priority; looks valid, silently no-ops)

The spec exports camelCase; the main object-form / widgets read legacy snake_case. Authoring per the protocol fails silently.

| Property (spec) | Read instead as | Net effect | Evidence |
|---|---|---|---|
| `maxLength` / `minLength` | `max_length` / `min_length` | server validation honors camelCase, but the **client form length attrs do not** | `plugin-form/src/ObjectForm.tsx:489-490`; `fields/src/index.tsx:1684,1691` (UI reads snake) vs `objectql/src/validation/record-validator.ts:127,130` (runtime reads camel) |
| `referenceFilters` | `lookup_filters` | lookup dialog filter **entirely dead** as authored | `fields/src/widgets/LookupField.tsx:171` |
| `maxRating` | `max` | dead, and redundant with `max` | `fields/src/widgets/RatingField.tsx:13` |

**Recommendation**: normalize at build time (snake→camel or vice-versa) **or** have renderers accept both keys. Until then these are broken promises. `maxRating` should simply be removed (use `max`).

## 2. Nested config objects vs flat siblings — config dead, duplication

The nested config objects are read by **nobody**; runtime and renderers read flat siblings instead.

| Nested config (DEAD) | What is actually read | Evidence |
|---|---|---|
| `currencyConfig` | flat `currency`, `precision` | `fields/src/widgets/CurrencyField.tsx:40` (flat); no `currencyConfig` consumer |
| `vectorConfig` | flat `dimensions` | `fields/src/widgets/VectorField.tsx` (flat); no `vectorConfig` consumer, no vector-index DDL |
| `fileAttachmentConfig` | flat `multiple`, `accept`, `maxSize` | `fields/src/widgets/FileField.tsx:16`; no config-object consumer, no size/type/virus enforcement in write path |

**Recommendation**: pick one shape per field type. Either delete the nested config from the spec (it misleads) or move consumers onto it. Today setting the nested config is a silent no-op.

## 3. DEAD — redundant field-level flags superseded elsewhere

| Property | Real mechanism | Evidence |
|---|---|---|
| `searchable` (field-level) | object-level `searchable` / view `searchableFields` | no field-level DDL/query consumer; UI hit `react/src/hooks/useRecordSearch.ts:195` is **object**-level |
| `index` (field-level) | object-level `indexes[]` | `driver-sql/src/sql-driver.ts:1252` reads object `indexes[]`; field bool unused |
| `externalId` (field-level) | dataset-level `externalId` | `objectql/.../seed-loader.ts:175` keys upsert off dataset externalId |
| `columnName` | — (broken) | `resolveColumnName` helper in `spec/.../system-names.ts:182` has **zero call sites**; the SQL driver hardcodes column = field key |

**Recommendation**: remove these field-level flags or actually wire them. `columnName` is the most dangerous — it advertises custom physical column names that the driver never honors.

## 4. DEAD — aspirational enhanced-type & governance config (remove or mark experimental)

No consumer in either layer (only spec / `field.form.ts` hints / lint / tests):

- **Code**: `theme`, `lineNumbers` (only `language` is live — `CodeField.tsx:13`)
- **Rating**: `allowHalf` (and `maxRating`, see §1)
- **Location**: `displayMap`, `allowGeocoding`
- **Address**: `addressFormat`
- **Color**: `colorFormat`, `allowAlpha`, `presetColors` (ColorField uses a fixed hex `<input type=color>`)
- **Slider**: `showValue`, `marks` (only `min`/`max`/`step` are live — `SliderField.tsx:12-14,32`)
- **Barcode/QR**: `barcodeFormat`, `qrErrorCorrection`, `displayValue`, `allowScanning`
- **Governance/security**: `encryptionConfig`, `maskingRule`, `auditTrail`, `dataQuality`, `cached`, `dependencies`, `trackFeedHistory`, `caseSensitive`, `writeRequiresMasterRead`
- **Master-detail explicit overrides**: `inlineTitle`, `inlineColumns`, `inlineAmountField`, `relatedList`, `relatedListTitle`, `relatedListColumns` (the **auto-derivation** in `plugin-form/src/deriveMasterDetail.ts` works; the explicit overrides are unread; detail-page related lists come from view metadata, not FieldSchema)

The only working at-rest protection is the separate `type: 'secret'` channel (`objectql/src/engine.ts` `encryptSecretFields`) — `encryptionConfig` is not it.

**Recommendation**: delete from the protocol, or gate behind an explicit `experimental` marker so authors aren't misled. Each is a silent no-op today.

## 5. LIVE with caveats (works, but incompletely)

| Property | Caveat | Evidence |
|---|---|---|
| `unique` | **DDL-only** — emits a UNIQUE constraint but is **not validated on the write path**, so violations surface as raw driver errors | `driver-sql/src/sql-driver.ts:1853`; absent from `record-validator.ts` |
| `precision` | UI display formatting live; **DDL never sizes** — number/currency/percent all map to `table.float()` | `fields/src/widgets/NumberField.tsx:16` (UI) vs `sql-driver.ts:1810` (no sizing). `scale` is even thinner — grid formatting only |
| `reference` | live via `$expand` / cascade / seed in `engine.ts`; **FK DDL reads `reference_to`**, which nothing maps from `reference` → driver-level FK constraints are effectively absent for spec-authored fields | `engine.ts:1672-1675,2218-2219` (live) vs `sql-driver.ts:1835` (reads `reference_to`) |
| `autonumberFormat` | runtime sequence formatting live; the UI `AutoNumberField` ignores it (shows raw value) | `engine.ts:765-767` (runtime) vs `fields/.../AutoNumberField.tsx` (no read) |

## 6. LIVE & necessary (core — keep)

`name`, `label`, `type`, `description`, `required`, `multiple`, `defaultValue`, `min`, `max`, `options`, `deleteBehavior`, `expression`, `summaryOperations`, `requiredWhen`, `readonlyWhen`, `visibleWhen`, `readonly`, `hidden`, `system`, `sortable`, `format`, `language` (code), `step` (slider), `inlineEdit`, and `conditionalRequired` (live only as the deprecated alias of `requiredWhen`; plan removal).

Primary live-consumer hot-spots: `packages/objectql/src/engine.ts`, `packages/objectql/src/validation/record-validator.ts`, `packages/objectql/src/validation/rule-validator.ts`, `packages/plugins/driver-sql/src/sql-driver.ts` (runtime); `objectui` `packages/plugin-form/src/ObjectForm.tsx`, `packages/plugin-grid/src/ObjectGrid.tsx`, `packages/fields/src/index.tsx` + `widgets/*` (renderers).

---

## Proposed follow-up (for an ADR)

1. **Rename-fix the naming drift** (§1) — normalize `maxLength`/`minLength`/`referenceFilters`/`maxRating` so the documented camelCase works. Net user-visible bug fix.
2. **Resolve nested-vs-flat** (§2) — one shape per field type.
3. **Prune or wire** the redundant flags (§3) and aspirational config (§4). Default to prune; anything kept gets an `experimental` marker and a tracking issue.
4. **Complete the caveated four** (§5) — write-path `unique` validation, DDL sizing for `precision`/`scale`, `reference`→`reference_to` mapping (or unify the key), UI honoring `autonumberFormat`.

This audit covers **1 of ~15 metadata types** (the densest). The same method applies to ObjectSchema, ViewSchema, etc.
