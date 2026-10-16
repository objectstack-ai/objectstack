---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/metadata-core': patch
---

feat(spec)!: retire the view form's `visibleOn` and the page component's `visibility` as keys; their ADR-0089 renames leave the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** ADR-0089 made `visibleWhen` the one conditional-visibility key, and through 17 the old spellings were declared `[DEPRECATED]` keys that the parse folded onto `visibleWhen` without a word: `visibleOn` on a form view's fields and sections, and `visibility` on a page component. At 18 all three positions carry a `retiredKey()` tombstone naming `visibleWhen`, the parse-time fold is gone, and the two ADR-0087 D2 conversions `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` (protocol 15) are retired from the load path (`retiredAfter: '17.7.0'`).

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `visibleOn: "…"` on a form field (`view.form.sections[].fields[]`) | `visibleWhen: "…"` |
| `visibleOn: "…"` on a form section (`view.form.sections[]`) | `visibleWhen: "…"` |
| `visibility: "…"` on a page component (`page.components[]`, slots and nested containers included) | `visibleWhen: "…"` |

**The one-line fix:** rename the key to `visibleWhen`; the CEL predicate is unchanged. Where a node wrote both keys, `visibleWhen` was the one in effect: delete the old key.

**What an author who still writes it sees.** `tsc` fails at a typed authoring site (`FormFieldInput`, `FormSection`, `PageComponent` type the key as retired), and the parse refuses it by name at its own path — `defineStack` throws `STACK_SCHEMA_INVALID` (422), `os validate` / `os build` print the issue, and the metadata save door answers 422:

> `page.components[].visibility` was removed in @objectstack/spec 18 (ADR-0089 D2) — it was the page component's deprecated spelling of the conditional-visibility predicate, which the parse folded into `visibleWhen` until this release. Use `visibleWhen`. Rename the key; the value (a CEL predicate) is unchanged. Where a component writes both, `visibleWhen` is the one that was in effect: delete `visibility`.

**No tool makes the rename.** Both conversions belong to protocol 15, below the migration floor, so `os migrate meta --from 17` applies no edit for either key and `--write` writes none: it prints each written key among the refusals the migrated stack still has, and lists the D3 entry `ui-visibility-alias-keys-retired` as the hand edit.

**Stored metadata needs no edit.** Stored-row rehydration and the artifact-ingestion door inside its window still replay both conversions, so a `sys_metadata` view or page row written with the old key keeps loading with `visibleWhen`. A script that saves a view or page through the metadata API with the old key is refused and needs the same rename.

## The retirement kit

- **Tombstones** on `FormFieldSchema`, `FormSectionSchema` and `PageComponentSchema`; `RETIRED_KEYS_BY_MAJOR[18]`: `ui/FormField:visibleOn`, `ui/FormSection:visibleOn`, `ui/PageComponent:visibility`; the authorable-surface rows read `[RETIRED]`.
- **The fold is gone.** The three shapes are plain closed objects again (no `.transform` pipe): a section's group-reference rule no longer lists `visibleOn` (the tombstone answers it first), and a slotted page node's `type` refusal now arrives at its own path instead of nested in an `invalid_union`.
- **The D3 entry `ui-visibility-alias-keys-retired`**, one for both keys.
- **No deprecation window**, per the project's startup-stage posture.

`@objectstack/lint`: the visibility-predicate rules (`visibility-root-mislayered`, `visibility-bare-identifier`, `visibility-predicate-syntax`) and the predicate-path rules read `visibleWhen` only. Every door runs them on a body the spec parse accepted, which cannot carry either retired key.

`@objectstack/metadata-core`: `detectUnboundFormViewPredicateRoots` reads `visibleWhen` only. Its caller scans an artifact after `applyArtifactForwardConversions`, which renames a legacy `visibleOn` first.

Not part of it: `normalizeVisibleWhen` and `VISIBILITY_ALIAS_KEYS` stay exported (no schema here calls them any more); objectui's renderer reads of the old keys leave on the objectui side.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered ui-visibility-alias-keys-retired -->
