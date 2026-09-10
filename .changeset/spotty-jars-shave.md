---
'@objectstack/cli': patch
---

`os validate` and `os lint` now judge the same stack `os build` judges when a project declares its metadata only in `packages[]`.

A project in the ADR-0130 D4 artifact shape — every definition inside `packages[]`, no collections at the top level — was handed to the author-time rule table as an **empty stack** by both commands, so all 44 rules reported nothing and both exited 0 having read none of the project. `os build` folds the packages back in first (`authoringRuleUnionStack`) and refuses the same stack. Two of the three authoring gates were certifying an unread project as clean, and `os validate` is the check an author runs before shipping.

Both commands now hand the rule table the stack that same helper returns — one fold, shared with `os build`, not a second implementation. It is a rule **input** only: neither command's output, `--json` payload nor `os lint`'s metadata score changes, and a stack that still carries its top-level collections is returned by identity, so single-package projects are unaffected by construction.

⚠️ **A project that was silently passing may now fail.** That is the defect surfacing, not a new rule: the finding was always there and `os build` was always reporting it. Run `os build` on the same tree to see the identical diagnostic.
