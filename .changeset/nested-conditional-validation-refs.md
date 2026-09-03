---
'@objectstack/lint': patch
---

Fix `validate-translation-references` reporting a nested `conditional` validation branch's legitimate `_validations` bundle entry as an orphan `translation-target-unknown`, with inverted advice.

The rule built its `_validations` universe with a flat walk of `objects[].validations[]`. A `conditional` rule's `then` / `otherwise` branch is itself a full rule carrying its own `name`, and that branch name — not the wrapper's — is the address `checkConditional` delegates to and `authoredRuleMessage` keys on at runtime (`packages/objectql/src/validation/rule-validator.ts`). The flat walk never saw a branch name, so a correct bundle entry for one was flagged as an orphan, and the finding's own text ("keeps its source locale in every refusal") was the opposite of the truth for that key — acting on the advice (deleting the entry) reintroduced the exact defect it fixed.

The walk now descends into `then` / `otherwise`, mirroring `evaluateRule`'s recursion (a branch may itself be a nested `conditional`, so depth is unbounded). The wrapper's own name stays in the universe, unchanged: its message is structurally unreachable at runtime, but a bundle entry for it is deliberately kept elsewhere so the bundle mirrors the declared rule set 1:1.
