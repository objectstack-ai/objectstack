---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: `objectstack validate`, `compile` and the publish gate refuse an action's `confirmText` / `successMessage` / `errorMessage` that is blank, names an unbound root, carries a single-brace token, holds logic in a hole, or carries a `${…}` token the runner shows raw (#25680)

Clause-②: no (narrowing: an action's copy sentence that is blank, holes an unbound root, carries a single-brace or raw-shown `${…}` token, or holds logic in a hole is refused at `objectstack validate`, `compile` and the publish gate; it ships now under the amended 「甲」, #6015 `6303865025`, as #25205 did for the bulk slot)
Metadata-protocol: narrowed
Ruling-ref: `6365736632` (on #24814, the refusal half); triage `6386348015`

An action's person-facing copy is an ADR-0032 `template` slot over the roots the console's runner binds (#24814): `confirmText` over `record` (and `params` beside static values), `successMessage` over `result` and `record`, `errorMessage` over none. That covers a page action row (`action:button`, `action:icon`, an `action:group` / `action:menu` member), a page component's inline `properties.action`, and a registered action (`stack.actions[]`, an object's `actions[]`). `validateStackExpressions`, the rule all three doors run, judges each sentence through `closedScopeTemplateRefusal`, then compiles it as a template. Its findings were warnings. They are now errors. This supersedes the warning-only behaviour #24814 described earlier in this release line; a refused finding no longer ends with "A warning, not a refusal".

**BREAKING — what moves for consumers.**

- FROM: a warning at `objectstack validate` and `compile`, and an entry on the publish gate's `advisories` channel while the action, object or page saved. TO: an error. Both commands fail, and an active `action`, `object` or `page` write answers `422 INVALID_METADATA` with an `expression-invalid` issue located at the key (`page 'P'.regions[0].components[1] (action:button) · confirmText`, `stack · action 'A' successMessage`, `… successMessage.zh-CN` for one value of a locale map). The item is not stored. This covers `saveMetaItem` in publish mode (Studio, REST `/meta`, MCP) and the promotion of a draft (`publishMetaItem`).
- The refused texts: a blank sentence (`''`, `'  '`); a hole over a root the key does not bind (`{{ result.name }}` in a `confirmText`, any hole in an `errorMessage`); a single-brace `{x}` token; a hole holding logic or naming an unknown formatter (`{{ record.count * 2 }}`, `{{ result.email | shout }}`); and a `${…}` token the runner shows as written — one in an `errorMessage`, one in a sentence that also has a `{{ }}` hole or a `{x}` token, one over `params` in a `confirmText`, or one over any root but `result` in a `successMessage`.

**Fix (one line).** Write the hole the finding prescribes (`Delete ${record.name}?` → `Delete {{ record.name }}?`), name a root the key binds, double a single-brace token, move logic out of the hole, or remove a blank key so the runner's default shows.

**The holeless `${…}` sentence too.** `${record.*}` in a `confirmText` and `${result.*}` in a `successMessage`, in a sentence with no `{{ }}` hole and no other token, is refused as well: the console's runner shows it as written. Its own entry in this release says so (#25709).

**Unchanged.**

- The parse. Each copy key accepts what it accepted, a blank string included (the slot's blank-string arm stays). The boot load and the read path judge a stored row with this parse, so a stored page or action carrying a refused sentence keeps loading and serving until it is next saved, and that save is judged. Saving as a draft is still allowed; publishing the draft is judged.
- `ActionSchema.errorMessage` and `outcomeMessages` are not in this family and draw nothing.
- A sentence with no finding draws nothing at any door, in any form (the bare string, the `{ dialect: 'template', source }` envelope, an inline locale map).
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No schema shape moves, and `@objectstack/spec` adds no export. The three copy describes now say the texts are refused.
- Measured before crossing, through the built `@objectstack/lint` at `6021b5e837`: 0 in-repo producers carry such a sentence. `examples/app-crm`, `app-showcase` (23 registered `successMessage`s, 29 pages), `app-todo` (2 `confirmText`, 16 `successMessage`) and `app-multi-package`, `@objectstack/platform-objects` (12 `confirmText`, 48 `successMessage`) and `@objectstack/plugin-approvals` (9 `successMessage`) draw 0 findings, against 1 for a planted unbound hole. HotCRM at `a4b3560` declares 1 action `confirmText` and 19 action `successMessage`s; judged through the same built pass, all 20 draw 0 findings, against an error for a planted `{count}`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `objectstack validate`, `compile` and the publish gate of an action copy sentence (`confirmText`, `successMessage`, a page row's `errorMessage`) that is blank, names an unbound root, carries a single-brace or raw-shown `${…}` token, or holds logic in a hole: no authorable key, spelling or stored shape moves, the parse is unchanged, and no stored row is read, rewritten or converted. A stored row whose sentence is refused keeps loading until it is next saved, and the repair is the author's rewrite of the sentence (which root a hole should name is the author's intent), which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
