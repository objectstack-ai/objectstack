---
"@objectstack/lint": minor
---

fix(lint)!: `objectstack validate` refuses a blank structural `condition`, the rule `registerFlow` has carried since #17322 (#17495)

<!-- adr-0087: not-required (already-registered flow-edge-condition-evaluated-slot-source-required) this is the AUTHOR-TIME face of the decision that entry already carries — an evaluated slot requires a non-blank `source`, refused with EVALUATED_EXPRESSION_SOURCE_REQUIRED — reached by importing the same schema rather than deriving a second rule. No key is renamed, retired or given a new meaning here, and no stored document needs rewriting that the entry does not already prescribe. ⚠️ That entry's `surface` / `acceptanceCriteria` name only `edges[].condition` and still want widening to `config.condition`; the registry file is in packages/spec, outside this card's surface, and is already filed as #17493. -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition):
`validateStackExpressions` — the pass behind `objectstack validate` — now
reports an `error` for a structural `condition` whose source is blank after
trimming. It reported nothing at all before.

The value was already refused by two of the three doors. `FlowEdgeSchema.condition`
composes `EvaluatedExpressionInputSchema` (#15807), so `'   '` on an edge is
refused at `FlowSchema.parse`; #17322 rebound `AutomationEngine.registerFlow` to
that same rule, so the same value on a node's `config.condition` stops the flow
registering. `objectstack validate` was the door that still said nothing — so an
author got a clean bill, deployed, and the flow never registered: each boot path
in `service-automation`'s plugin wraps `registerFlow` in `try`/`catch`, logs one
`warn` naming the flow, and continues. On a `start` node that key is the
**trigger gate**, so the whole flow is armed by nothing.

FROM → TO, for a build that used to pass and now fails:

```yaml
# FROM — validate said nothing; registerFlow refuses it at boot
nodes:
  - { id: gate,   type: start,    config: { objectName: lead, triggerType: record-after-update, condition: '   ' } }
  - { id: branch, type: decision, config: { condition: { dialect: cel, source: '   ' } } }

# TO — either write the predicate you meant…
nodes:
  - { id: gate,   type: start,    config: { objectName: lead, triggerType: record-after-update, condition: 'record.active == true' } }
  - { id: branch, type: decision, config: { condition: { dialect: cel, source: 'record.rating >= 4' } } }

# …or drop the key. An ABSENT condition is still not a malformed one: a start
# node with no `condition` is an ungated trigger, and that is unchanged.
```

The refusal is the edge door's own sentence, not a second one — the finding
carries `EVALUATED_EXPRESSION_SOURCE_REQUIRED` verbatim, located at the node and
slot the author wrote (`flow 'f' · node 'gate' (start) condition`), because all
three doors now ask one imported schema.

Unchanged, deliberately: the **evaluator**. A condition already stored blank
still answers `false` at run time — #15662's ruling on that half stands. What
moved is that it can no longer be authored past validate.
