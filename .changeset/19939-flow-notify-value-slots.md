---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': patch
---

A `notify` node's computed values are value slots now: `recipients`, the values of `templateData` and `payload`, `sourceObject`, `sourceId` and `actorId` take a CEL value envelope, `{ dialect: 'cel', source: 'record.owner' }`, that the executor evaluates in the run's scope, or a literal written as it is. `recipients` holds one recipient or a list of them, each entry a string or an envelope, and an entry that evaluates to a list adds each of its recipients. The node's link, `actionUrl`, is a text slot like `title`: it renders `{{ }}` holes, `'/crm_case/{{ record.id }}'`. A single-brace `{…}` token at any of these positions is refused at `objectstack validate`, at `registerFlow` and by the executor, naming its CEL spelling (its `{{ }}` spelling at `actionUrl`).

Clause-②: yes (narrowing: a {…} token is refused at notify recipients (the value or a list entry), templateData and payload values, sourceObject, sourceId, actorId and actionUrl, and a templateData or payload value that names a dialect must be a valid CEL value envelope; widening: recipients, sourceObject, sourceId and actorId accept a CEL value envelope they refused, a recipients list accepts envelope entries, and their published JSON Schema and inferred types gain the envelope arm)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused, flow-text-slot-single-brace-refused, flow-text-slot-unbound-dollar-root-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff: its surface widens to a notify node's computed values, and its replacement, reason and acceptance criteria say what a recipient evaluates to, that a list adds each recipient and null none, and why the list token is not rewritten. The two text-slot D3 entries widen their surface to the notify node's actionUrl. No new D3 entry and no D2 conversion: an absent variable dropped a recipient under the template and fails the run under CEL, a list token written as a list entry reached nobody under the template and reaches each recipient as an envelope, and a Date in a link rendered JSON-quoted under the interpolator and as its ISO text under the template engine. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, beside one widening (four positions accept a CEL value envelope), shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 2 makes a computed value whole-field CEL, and Decision 3 deletes the single brace; a link with holes is text. Until now the executor ran each of these positions through the single-brace interpolator, and one of its answers reached nobody: a whole token holding a list, written as an entry of a `recipients` list — `recipients: ['{owners}']` with `owners = ['u1', 'u2']` — was handed to the messaging service as ONE recipient, `'u1,u2'`, and the run reported success. A token holding a record there became the recipient `'[object Object]'`, and so did one in a link or a `sourceId`.

**What changes where a value may be absent.** A recipient envelope that evaluates to `null` or a blank string adds no recipient, as a token that resolved to nothing did, and a node left with none fails, naming the expressions that evaluated to nothing. An absent variable or key fails the run under CEL, naming it, where the template dropped the recipient; guard a field that may be unset, `has(record.assignee) ? record.assignee : null`. A relation hop on a scalar id (`record.account.owner` without the start node's `expand`) fails the evaluation itself, naming the key it could not read, where the template resolved it to nothing. `sourceObject`, `sourceId` and `actorId` must evaluate to a string; `null` leaves the key unset, and a half-specified click-through pair is still dropped. A recipient, or one of `sourceObject` / `sourceId` / `actorId`, that evaluates to anything else — a map, a number — fails the node, naming what it evaluated to.

**What does not change.** A literal at every value slot is written as it is: a recipient string (`'team:ops'`, a user id, an email address) is one recipient, as before, and is not split. `template`, `topic`, `channels` and `severity` are read raw, as before. An explicit `actionUrl` still wins over the link synthesized from `sourceObject` / `sourceId`, and a link that renders no text yields to it, as an empty one did.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `recipients: '{record.owner}'` | `recipients: { dialect: 'cel', source: 'record.owner' }` | an absent `owner` fails the run instead of leaving the node without a recipient |
| `recipients: ['{record.assignee}']` where it may be unset | `recipients: [{ dialect: 'cel', source: 'has(record.assignee) ? record.assignee : null' }]` | none: the `null` is dropped, as the unresolved token was |
| `recipients: ['{owners}']` (a list variable) | `recipients: [{ dialect: 'cel', source: 'owners' }]` | each of its recipients is notified, where the template sent one joined string |
| `recipients: ['{$User.Id}']` | `recipients: [{ dialect: 'cel', source: 'current_user != null ? current_user.id : null' }]` | none: a run with no user adds no recipient |
| `sourceId: '{record.id}'` | `sourceId: { dialect: 'cel', source: 'record.id' }` | an absent id fails the run instead of dropping the link |
| `templateData: { name: '{record.name}' }` | `templateData: { name: { dialect: 'cel', source: 'record.name' } }` | the template gets `null` (a guard's answer) where the key was absent |
| `actionUrl: '/crm_case/{record.id}'` | `actionUrl: '/crm_case/{{ record.id }}'` | a `Date` in the link renders as its ISO text, not JSON-quoted |

**The one-line fix: write each `notify` value position as a CEL value envelope, `{ dialect: 'cel', source: 'record.owner' }`, and double the braces in `actionUrl`.**

**Who is affected, measured.** In this repository, at the base: the showcase example (16 recipient strings, 7 `sourceId`s and 4 links), the todo example (2 recipients and 2 `sourceId`s), the flows guide, the email-templates and common-patterns guides, two dogfood fixtures and test fixtures; all are migrated in this change, and a recipient field that may be unset is guarded. hotcrm at `1d7148bf2d` writes 19 notify nodes in 15 flow files, each with one `{…}` recipient (2 of them `{$User.Id}`), 35 `{…}` `templateData` values and a link with holes; it is on spec 17.7.0, so nothing there moves until it upgrades.

**Newly accepted.** A CEL value envelope at `recipients` (the value, or each entry of a list), `sourceObject`, `sourceId` and `actorId`: their published JSON Schema gains the envelope arm, and so do the inferred `NotifyConfig` types. At a `templateData` or `payload` key an object naming a `dialect` was data before; it is an expression now, evaluated per run, and a malformed one is refused.

**Still accepted, unchanged.** Every literal at these positions. The single-brace dialect keeps resolving where it still lives: a `filter` value, an `http` body. The value-slot retirement's earlier changesets on this line, and the text-slot changeset, list `recipients`, `actionUrl`, `sourceId`, `payload` and `templateData` among those positions; this one supersedes that line.

### The kit

- **The contract.** `NotifyConfigSchema`: `recipients` takes a string, a list of strings and envelopes, or one envelope; `templateData` and `payload` take `FlowValueSlotSchema` per key; `sourceObject`, `sourceId` and `actorId` take a string or an envelope; `actionUrl` refuses a single-brace token through the text-slot judge. Each `describe()` is restated.
- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS` gains six `notify` value rows. `recipients` carries `eachElement`: a list is read entry by entry, at its index (`recipients[1]`). `FLOW_NODE_TEXT_SLOTS` gains `notify.actionUrl`. `NotifyConfigSchema` joins `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`, which carries the markers to the reconciliation ratchet.
- **The executor.** The `notify` node evaluates each envelope through the shared value-slot resolver and renders `actionUrl` through the text renderer; it no longer imports the single-brace interpolator.
- **The lint.** The `flow-double-brace-interpolation` hint names `actionUrl` among the text slots; `objectstack validate` refuses a token at each position through the value-slot and text-slot judges, with no rule change.
- **ADR-0087.** The step-18 D3 entries `flow-value-slot-template-dialect-refused`, `flow-text-slot-single-brace-refused` and `flow-text-slot-unbound-dollar-root-refused` are amended. No key is removed, so there is no tombstone, and there is no D2 conversion.
