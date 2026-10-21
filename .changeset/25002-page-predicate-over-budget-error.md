---
'@objectstack/lint': minor
---

fix(lint)!: `os build`, `os validate`, `os lint` and the page save door refuse a page component props CEL slot over the platform's parse bounds (#25002)

Clause-②: no (narrowing: a page component props CEL slot over the platform parse bounds is refused at `os build` and the page door; it ships now under the amended 「甲」, #6015 `6303865025`)

A CEL source over `DEFAULT_LIMITS` (`maxAstNodes` 256, `maxDepth`, `maxListElements`) does not parse anywhere on the platform. It faults on every evaluation, and the console fails open, so the element it was written to gate draws for everyone. `page-predicate-over-budget` (`validatePagePredicateBounds`) finds such a source in the CEL slots declared inside a page component's `properties` bag: a `page:tabs` item `visibleWhen`, an `object-form` section or inline field `visibleWhen` / `readonlyWhen` / `requiredWhen`, `record:alert` `visible`, and the `visible` / `disabled` of the `action:*` blocks. The finding was a warning. It is now an error, and its authoring-rules entry moves from the advisory tier to the gating tier. This supersedes the warning-only behaviour described for the same rule earlier in this release line; its message no longer says "A future major release refuses it."

**BREAKING — what moves for consumers.**

- FROM: a warning at `os validate`, `os build` and `os lint`, and an entry on the page save door's `advisories` channel while the page saved. TO: an error. The three commands fail, and an active page write answers `422 INVALID_METADATA` with a `page-predicate-over-budget` issue located at the slot and naming the bound it overruns. The page is not stored. This covers `saveMetaItem` in publish mode (Studio, REST `/meta`, MCP) and the promotion of a draft (`publishMetaItem`).
- The page door answers `INVALID_METADATA`, its existing author-time refusal envelope, not `VALIDATION_ERROR`.

**Fix (one line).** Shrink the predicate (collapse an `||` chain into one `in ['a', 'b', …]` test), or precompute the heavy part into a formula or roll-up field on the object and test that one field.

**Unchanged.**

- A within-bounds source draws nothing at any door.
- The component node's own `visibleWhen` keeps its existing verdict (`visibility-predicate-over-budget`), and this rule does not report it twice.
- Stored pages are not migrated and are not refused on read. A stored page with such a slot keeps loading and serving until it is next saved, and that save is judged. Saving a page as a draft is still allowed; publishing the draft is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No public export or signature moves; `PagePredicateBoundsFinding.severity` is now `'error'`.
- Measured before crossing, through the built `@objectstack/lint`: 0 in-repo producers carry such a slot. Every page module under `examples/` and `packages/` (30 files, 65 page values) draws 0 findings, and so do the `app-crm`, `app-multi-package` and `app-todo` composed stacks. A literal scan of 9,919 tracked source files (13,840 string literals of 120+ characters) finds 0 sources over the bounds, and HotCRM at `c8a7a70` (611 files) finds 0. A planted 78-term control is found by both instruments.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build`, `os validate`, `os lint` and the page save door of a page component props CEL slot whose source overruns the platform's parse bounds: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored page whose slot is refused keeps loading until it is next saved, and the repair is the author's rewrite of the predicate (shrinking it, or precomputing it into a formula or roll-up field), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
