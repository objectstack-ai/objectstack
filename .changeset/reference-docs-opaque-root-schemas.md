---
"@objectstack/spec": patch
---

fix(spec): reference pages no longer drop the whole section for a non-object root schema (#7658)

`build-docs.ts` decided which node of a published document it was documenting by
enumerating shapes — `properties`, `enum`, `anyOf`, `oneOf` — and answered "none
of those" with `return ''`. A JSON Schema root is routinely none of those:
`z.string().describe(…)` compiles to a bare scalar, `z.record(…)` to an object
with `additionalProperties` and no `properties`, `z.array(…)` to an array,
`z.intersection(…)` to an `allOf`. Every one of them lost its ENTIRE `## Name`
section — heading included, and with it the `.describe()` prose an author wrote
to be read — while the page's `## TypeScript Usage` block, which is spelled from
the export surface rather than from this function, went on naming the export. The
page read as if it had forgotten to finish rendering an entry it had just
imported.

**Measured on today's tree: 45 published schemas were in that state, 33 of them
carrying a description.** The filed issue counted 22 (`~23`), having scanned only
the bare-scalar spelling; record maps, one array root and one `allOf` are the
same defect through the same line. Regenerating restores all 45 sections — 244
added lines, **zero removed**, so none of the 1533 sections that already rendered
moves. Emitted file count is unchanged at 230: a section rendering as the empty
string never removed a page, so no category's `pages.length` changes and the
`meta.json` emit guard added in #7303 is untouched.

Nothing was failing, which is why this stood for months: `check:docs` compares
generated output to committed output, so a section that never existed stays green
forever, and there is no grep for what is missing.

The renderer moved to `scripts/lib/schema-section.ts` to be pinned directly —
the same extraction, for the same reason, that `lib/format-type.ts` got at #4912.
Its output was the empty string, the one thing grepping emitted `.mdx` cannot
see.

Sections for these shapes now carry the schema's description plus a single
`**Type:**` line, rendered by the same `formatType` that every property row on
the page uses, so a schema's own section and a property typed with it cannot
disagree. Constraints (`pattern`, `minLength`, `minimum`) are deliberately not
spelled: this renderer prints none in any position, and `json-schema/` stays the
authority on them.
