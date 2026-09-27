---
'@objectstack/metadata-core': patch
---

docs(metadata-core): the `item-key-discriminators` module docblock quoted a spec sentence that no longer exists and that the contract denies ("best match") (#19592)

Clause-②: no — no accept set moves, no published payload key changes, no
export is added or removed. The corrected prose ships as TSDoc in
`@objectstack/metadata-core`'s `dist/index.d.ts` and `dist/index.d.cts` (the
package publishes `dist`), which is why this is a changeset rather than
`skip-changeset`.

The module docblock of `packages/metadata-core/src/item-key-discriminators.ts`
put a sentence inside quotation marks and attributed it to
`EmailTemplateDefinitionSchema` in `packages/spec/src/system/email-template.zod.ts`:
that the service "picks the best match for the recipient's locale". That
sentence occurs nowhere in `packages/spec/src` today, and it states the opposite
of the contract: `SendTemplateInput.template` in
`packages/spec/src/contracts/email-service.ts` says there is no "best match" and
no language-subtag folding.

The docblock now cites the spec by file and symbol instead of quoting it. It
says the `locale` key is the second half of the bundle key, that resolution is
exact, and that `SendTemplateInput.locale` holds the ladder: the named tag matched
exactly, then the literal `en-US`, then, only for a call that named no locale and
only when the bundle has no `en-US` row, the bundle's lowest locale tag. The one
quotation left in the docblock ("is resolved by `(name, locale)`", from the
schema's header) still exists verbatim in the spec.

No behaviour changes: the edit is prose. `ITEM_KEY_DISCRIMINATORS`,
`readDiscriminatorValue`, `itemDiscriminator` and the `en-US` canonical are
untouched.
