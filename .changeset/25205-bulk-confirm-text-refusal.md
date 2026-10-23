---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: `objectstack validate`, `compile` and the publish gate refuse a bulk action's `confirmText` hole over an unbound root, a single-brace token, a hole holding logic and a blank sentence (#25205)

Clause-②: no (narrowing: a bulk action's `confirmText` that names an unbound root, carries a single-brace token, holds logic in a hole or is blank is refused at `objectstack validate`, `compile` and the publish gate; it ships now under the amended 「甲」, #6015 `6303865025`)
Metadata-protocol: narrowed

A list-view bulk action's `confirmText` is an ADR-0032 `template` slot over a closed scope, `count` and the def's params by name (#24798). `validateStackExpressions`, the rule all three doors run, judges each one through `closedScopeTemplateRefusal`, then compiles it as a template. Its findings were warnings. They are now errors, as the flow text slots' findings are. This supersedes the warning-only behaviour described for the same pass earlier in this release line; the finding no longer ends with "A warning, not a refusal".

**BREAKING — what moves for consumers.**

- FROM: a warning at `objectstack validate` and `compile`, and an entry on the publish gate's `advisories` channel while the view or object saved. TO: an error. Both commands fail, and an active `view` or `object` write answers `422 INVALID_METADATA` with an `expression-invalid` issue located at `bulkActionDefs[N] confirmText`. The item is not stored. This covers `saveMetaItem` in publish mode (Studio, REST `/meta`, MCP) and the promotion of a draft (`publishMetaItem`).
- The four refused texts: a hole over a root the def does not bind (`{{ owner }}` when the def binds `count` and `tier`), a single-brace `{x}` token, a hole holding logic or naming an unknown formatter (`{{ count * 2 }}`, `{{ count | shout }}`), and a blank sentence (`''`).

**Fix (one line).** Write the hole over `count` or one of the def's params (`{{ count }}`, `{{ tier }}`), double a single-brace token as the finding prescribes, move logic out of the hole, or remove a blank `confirmText` so the default sentence shows.

**Unchanged.**

- The parse. `bulkActionDefs[].confirmText` accepts what it accepted, a blank string included (its second union arm stays). The boot load and the read path judge a stored view with this parse, so a stored view carrying such a sentence keeps loading and serving until it is next saved, and that save is judged. Saving as a draft is still allowed; publishing the draft is judged.
- A sentence with no finding draws nothing at any door, in either form (the bare string or the `{ dialect: 'template', source }` envelope).
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No public export, signature or schema shape moves. The `confirmText` describe now says the texts are refused.
- Measured before crossing, through the built `@objectstack/lint` at `925fd0772c`: 0 in-repo producers carry such a sentence. The 6 bulk defs with a `confirmText` in `examples/app-showcase` (`project.view.ts`) draw 0 findings, against 1 for a planted unbound hole. HotCRM at `1e71d5e` declares 3 bulk `confirmText` sentences on `account.view.ts` (`{{count}}`, and `{{tier}}` on the def whose param is `tier`), all over bound roots: 0 findings. Its other 9 of the 12 are translations of those 3 in its locale bundles, which this pass does not read.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `objectstack validate`, `compile` and the publish gate of a bulk action `confirmText` naming an unbound root, carrying a single-brace token, holding logic in a hole, or blank: no authorable key, spelling, export or stored shape moves, the parse is unchanged, and no stored row is read, rewritten or converted. A stored view whose sentence is refused keeps loading until it is next saved, and the repair is the author's rewrite of the sentence (which root a hole should name is the author's intent), which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
