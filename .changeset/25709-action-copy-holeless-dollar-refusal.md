---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: `objectstack validate`, `compile` and the publish gate refuse a holeless `${record.*}` `confirmText` and a holeless `${result.*}` `successMessage` on an action, the one action-copy finding that was still a warning (#25709)

Clause-②: no (narrowing: an action's `confirmText` / `successMessage` sentence with no `{{ }}` hole whose tokens are `${record.*}` / `${result.*}` is refused at `objectstack validate`, `compile` and the publish gate instead of saving with a warning)
Metadata-protocol: narrowed

The console's action runner no longer fills `${…}` in an action's copy: a sentence with no `{{ }}` hole is shown as written, `${…}` included (objectui#13476, in the `ui/` tree). The doors kept one `${…}` shape a warning while the runner still filled it: `Delete ${record.name}?` in a `confirmText`, `Invitation sent to ${result.email}` in a `successMessage`. The person reading the dialog or toast now sees that token raw, so the doors refuse it like every other `${…}` token.

**BREAKING — what moves for consumers.**

- FROM: a warning at `objectstack validate` and `compile`, and an entry on the publish gate's `advisories` channel while the action, object or page saved. TO: an error. Both commands fail, and an active `action`, `object` or `page` write answers `422 INVALID_METADATA` with an `expression-invalid` issue located at the key. The item is not stored. The finding no longer ends with "A warning, not a refusal, for now".
- `ACTION_COPY_DOLLAR_TRANSITION_ROOTS` (`@objectstack/spec/ui`) and `dollarOnlyTokenRoots` (`@objectstack/spec/automation`), which reached `main` after `@objectstack/spec@18.1.0` and were never published, are withdrawn before this release. The `confirmText` and `successMessage` describes no longer say the shape is a warning.

**Fix (one line).** Write the hole the finding prescribes: `Delete ${record.name}?` → `Delete {{ record.name }}?`, `Invitation sent to ${result.email}` → `Invitation sent to {{ result.email }}`.

**Unchanged.** The parse: each copy key accepts what it accepted, so a stored row with such a sentence keeps loading until its next save, and that save is judged. Saving as a draft is still allowed. `outcomeMessages` and `ActionSchema.errorMessage` are not in this family. `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.

**Measured before crossing**, by walking every action-copy sentence reachable from each module's exports on this branch's base `38050ced` and through the built `@objectstack/lint`: `examples/app-crm` (2 `successMessage`, 2 `errorMessage`), `app-todo` (1 `confirmText`, 8 `successMessage`), `app-showcase` (6 `confirmText`, 24 `successMessage`), `app-multi-package` (none), `@objectstack/platform-objects` and `@objectstack/plugin-approvals` carry 0 sentences with a `${…}` token and 0 of the holeless shape, and the four example stacks draw 0 copy findings. A planted `Delete ${record.name}?` `confirmText` on each example stack draws the finding.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `objectstack validate`, `compile` and the publish gate of an action copy sentence with no `{{ }}` hole whose tokens are `${record.*}` (in a `confirmText`) or `${result.*}` (in a `successMessage`), which saved with a warning: no authorable key, spelling or stored shape moves, the parse is unchanged, and no stored row is read, rewritten or converted. A stored row whose sentence is refused keeps loading until it is next saved, and the repair is the author's rewrite of the sentence (which root a hole should name is the author's intent), which no ledger entry can derive. The two dropped exports never shipped in a published version. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
