---
'@objectstack/skills': patch
---

docs(skills): objectstack-data, -automation and -platform teach ownership queues and assignment rules (ADR-0142 phase 2), one eval each

Clause-②: no
Metadata-protocol: none

- **Before.** The `queue` and `assignment_rule` metadata types, the `queues` / `assignmentRules` stack keys, the reserved `queue` column, the claim / release / move verbs, the `queue` sharing recipient and the `queue` approver type shipped in the spec and the docs, but no published skill taught them — `objectstack-platform` listed the two keys without a sentence, and no eval exercised any of it. An agent authoring an app from the skills could route an ownerless record only by hand-rolling it: a per-record picklist, a round-robin counter field, or a hook that picks an owner.
- **Now.** `objectstack-data` gains *Ownership queues — park a record for a team to claim* (the injected `queue` column, a compiled `defineQueue` example, claim / release / move in one sentence each) and `rules/security.md` the `queue` sharing recipient and the `current_user.queues` placeholder; `objectstack-automation` gains *Assignment rules — route a new record to a queue or a person* (a compiled `defineAssignmentRule` example with `criteria`, `assignTo: { type: 'queue' }`, `strategy` and `load`, and the `queue` approver pointer); `objectstack-platform` says what `queues` and `assignmentRules` are and that both need `sharing` in `requires`. One eval per skill asserts the declared shape and refuses the hand-rolled alternatives.
- Every file stays at or under its token ceiling: the new text is paid for by folding sentences the same skill's `rules/**` and `references/**` already hold, and by tightening existing eval model answers. No ceiling moves, no frontmatter changes, no schema, key or behaviour changes.
