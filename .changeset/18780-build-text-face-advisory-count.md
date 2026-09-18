---
"@objectstack/cli": patch
---

`os build`'s text face prints every author-time advisory its own summary line counts — the closing `N author-time warning(s) — see above` no longer stands over a shorter list (#18780).

Clause-②: no

`compile.ts` rendered the advisory block at step 3b, inline, straight off the union rule run. Step 3b-ii — the ADR-0130 D4 pass that runs the same rule table once per `packages[]` entry — then appended its survivors to the **same** `ruleAdvisories` binding, and the summary line at the foot of the command counts that binding. So on a multi-package project the count was the complete set and the printed list was the union's alone, and the sentence pointing at it sent the reader back up to find a warning that had never been printed.

Measured at 17.4.0 on `examples/app-multi-package`, exit 0 on every face:

```
os build           3 advisory entries · ⚠ 4 author-time warning(s) — see above
os build --json    warnings: 4                  <- the count was already right
os validate        4 advisory entries           <- since #18769
```

- **The list moves, not the count.** #11529 settled this axis one list over: the summary counts the whole set and the printer NAMES what it withheld, because a count quietly shrunk to match a short list is the false-clean direction — it deletes a finding from the text face of the command that ships while `--json` and `os validate` keep reporting it. The fourth advisory now prints.
- **What an author sees change**: on a stack that declares `packages[]`, the advisory block is rendered after the `Running author-time rules per package (N)...` step line instead of before it, and it now carries the per-package findings — the ones whose `where` reads `package '<id>' — …`. A stack with no `packages[]` is unchanged — measured on a single-package fixture, the before/after captures are 2038 bytes each and differ only in the run's two clocks, `Load time: Nms` and `Build complete (Nms)`: its list was already complete, and the block still precedes every later step line.
- **Still ONE printer call.** The block is deferred to the point where the list is complete rather than printed twice, so the 50-entry cap and its `… and N more … not shown` notice keep judging one list. A second `printAuthoringAdvisories` for the survivors alone would have given the cap a second budget and the notice a second, partial total.
- **The author-time rule FAILURE faces keep their advisories.** A union-level failure exits before the per-package pass runs, so its block is byte-for-byte what it was; the per-package failure face now prints the per-package advisories too, which its own `--json` twin has published since #11772.

No payload key, no exit code and no `--json` byte moves: `warnings` already carried all four, which is how the mismatch was measurable in the first place.
