---
'@objectstack/cli': patch
---

`os build`, `os validate` and `os init` say how many diagnostics they withheld

Nine more renders across the three authoring commands cut their list at a fixed
cap and printed nothing saying so — the `--strict-body` refusal list, the
author-time rule failures, the undeclared-authoring-key findings, the
access-matrix drift, the package-doc errors, and both halves of `os init`'s
scaffold self-test. The defect is the **silence**, not the cap: truncated
output that carries no notice is indistinguishable from complete output, so an
author who reads it and sees no further problems has read a list that stopped
early. Two of them even stated the true total in their own header and then
showed fewer rows, so the report gave two numbers that disagreed and explained
neither.

On the gating lists it also undoes the thing `os validate` went out of its way
to provide. Its own comment records why every failing rule reports at once:
"the command used to exit at the first failing gate, so an author with three
unrelated problems fixed them in three round trips and could not see how deep
the hole went". Past the cap that is exactly what came back, one cap-width at a
time, with each round of fixes revealing a new batch that reads as fresh
breakage.

Every cap stays. Over it the output now names the exact remainder:

```
  ⚠ … and 30 more author-time rule failure(s) not shown (50 of 80) — re-run with --json for the full list
```

**The pointer is verified per site, and two notices deliberately omit it.**
`--json` publishes each of these lists at the very exit whose text face carries
the notice, so re-running really does return the complete set. `os init`
declares no `--json` flag at all, so both of its notices state the remainder
and name no remedy — a notice whose remedy does not work is worse than a silent
cut, because it sends the author down a path that returns the same truncated
view.

At or under a cap, nothing new is printed and the rendering is byte-for-byte
what it was.
