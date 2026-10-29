---
'@objectstack/skills': patch
---

docs(skills): the objectui action-block rule teaches `variant: 'danger'` for a destructive action and that `destructive` is the Button primitive's word, refused on an action block

Clause-②: no
Metadata-protocol: none

- **Before.** `rules/protocol.md` taught `action:button` without its `variant`. An agent that wanted a red delete button had only the Button primitive's `destructive` to copy from the React examples, and `variant: 'destructive'` on an action block is refused at save with the rename to `danger`.
- **Now.** The "Actions Are Node Types" rule carries one line: `"variant": "danger"` draws the action block red and asks its `confirmText` question through the destructive confirm button; `destructive` stays the Button primitive's word (`variant="destructive"` in React) and is refused on an action block. Paid in the same file: a provenance sentence about the retired `dataSource` measurement route and a sentence restating the `props` envelope rule, both stated elsewhere in the file, are gone.
- **Eval.** `evals/page-builder.json` gains a case that asks for a destructive delete action: it must spell `action:button`, `"variant": "danger"` and `confirmText`, and fails on `"variant": "destructive"`. The three existing cases are tightened with every assertion kept, and the file's ratchet ceiling moves 560 → 684 tokens, the measured remainder (ruling 2026-10-27, 「A:先削重复,余额按实测提高」).
- No schema, key or behaviour changes.
