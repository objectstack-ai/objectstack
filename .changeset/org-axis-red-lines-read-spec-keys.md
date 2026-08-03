---
"@objectstack/lint": minor
---

fix(lint): `validateOrgAxisRedLines` reads the sharing-rule keys the spec declares — the ADR-0105 D6 red lines fired on nothing before (#4984)

The two ADR-0105 D6 red lines are declared `error` and gate `os validate` /
`os build` / `os lint`. On the sharing-rule path neither of them could fire.

`validateOrgAxisRedLines` read `rule.criteria ?? rule.filter` and
`rule.sharedTo ?? rule.recipient`. `SharingRuleSchema` is `.strict()` and its
declared keys are `condition` and `sharedWith`; all four names it was reading
exist only as **rejected aliases** in `sharingRuleUnknownKeyError`, the
prescription attached to the refusal message. The rule runs on the post-parse
stack (`input: 'parsed'`), so for every spec-valid stack those four properties
were `undefined`, `JSON.stringify(undefined ?? '')` was `'""'`, and the
`parent_organization_id` test was constantly false.

**This is a behaviour change: the rule previously never triggered.** Both red
lines are now live on the sharing-rule path:

| Authored shape | Before | After |
|:--|:--|:--|
| `condition` reading `parent_organization_id` | passed | `error` `org-axis-permission-inheritance` at `sharingRules[i].condition` |
| `sharedWith` reading `parent_organization_id` | passed | `error` `org-axis-permission-inheritance` at `sharingRules[i].sharedWith` |
| `sharedWith: { type: 'business_unit' }` on a `tenancy.enabled: false` object | passed | `error` `org-axis-cross-org-bu-grant` at `sharingRules[i].sharedWith` |

A stack that ships today keeps building unless it contains one of those three —
the shapes D6 forbids and the gate was meant to have been refusing all along.
The rejected aliases are deliberately **not** read: a rule spelling `criteria`
or `sharedTo` is refused by the schema's own parse with the canonical key
named, and a consumer must not tolerate what the producer's contract rejects.

`condition` is an `ExpressionInput`, so all three of its shapes are scanned —
the authored bare string, the parsed `{ dialect, source }` envelope, and the
compiled `{ dialect, ast }` form.

The rule's own tests were the reason this survived review: their fixtures used
the same rejected aliases, so the suite was green while the gate was dead. Every
sharing-rule fixture now goes through `SharingRuleSchema` before the lint sees
it, and every object fixture through `ObjectSchema` — a fixture that drifts from
the spec surface fails at the fixture instead of silently exercising a shape no
author can write.
