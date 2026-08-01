---
'@objectstack/spec': patch
---

The protection-envelope invariant test was hollow — it silently skipped 24 of 25 registered types. Fixed, and it immediately found 8 undeclared envelopes instead of 1.

The check shipped in the previous change asserted two things about every registered metadata type: that it does not *reject* the ADR-0010 envelope its loader stamps (the hard-422 case), and that it does not *strip* it (the silent-loss case). The reject half worked — it found `hook` and `datasource` on its first run.

The strip half did not. It probed each schema with one generic body and asked whether `_packageId` survived; a type whose required fields that body did not satisfy failed for unrelated reasons and the assertion returned early. **24 of the 25 types took that early return.** Only `field` was ever actually checked, and the suite reported green.

That is the campaign's own subject matter — a success signal covering an omission — reproduced inside the instrument built to detect it, one change after the ledger recorded the same lesson about the strictness gate's non-recursive directory walk. A check that skips is indistinguishable from a check that passes.

**The declaration side is now structural.** It walks the schema — unwrapping `lazy` / `pipe` / `optional` / `default` and expanding unions — and asks whether any resolved object shape declares the key. That answer does not require constructing a valid instance, so it cannot skip. Two guards keep it honest: a type whose shape the walker cannot resolve is a hard failure (the walker going quiet is exactly when this test would otherwise stop covering something), and the debt list carries a reverse pin that fails when an entry is fixed, so the list cannot outlive the debt it tracks.

**What it found:** 8 registered types do not declare the envelope, not 1 — `action`, `book`, `field`, `job`, `mapping`, `page`, `translation`, `validation`. `job` and `book` are closed here, leaving 6 on the list. Each is protection metadata lost on every round-trip today, and a hard 422 the day its schema is closed.
