---
'@objectstack/cli': patch
---

`os build` says how many author-time warnings it withheld, instead of stopping
dead at 50

The author-time advisory printer emitted a fixed 50 detailed entries and then
stopped, with nothing in the output saying the list had been cut. Measured on
`objectstack-ai/hotcrm` with the published 17.1.0 CLI: two `objectstack build`
runs over the same tree, before and after a five-warning fix, printed 50
detailed entries each — 184 output lines and 52 warning lines both times —
while the summary line counted 80 and then 75. The two numbers disagreed and
nothing explained why.

The defect is the **silence**, not the cap. Truncated output that carries no
notice is not merely incomplete, it is indistinguishable from complete: an
author who reads the report and sees their file is clean has read a list that
stopped early. Because advisories are ordered by surface (pages, then views,
then flows), a repo whose page warnings alone exceed the cap keeps every `view`
and `flow` advisory permanently invisible — and fixing warnings then makes new
ones *appear*, which reads as a regression caused by the fix.

The cap stays, and over it the output now names the exact remainder:

```
  ⚠ … and 30 more author-time warning(s) not shown (50 of 80) — re-run with --json for the full list
```

At or under the cap no such line appears, and the detail entries themselves are
byte-for-byte what they were. The pointer is `--json`, which already publishes
the whole set under `warnings` — an existing complete-output path rather than a
new flag. No new verbosity tier, no paging, no configuration surface.

`os validate` was checked at the same time and does **not** truncate its
advisory list: it prints every warning it collected. Only the `build`/`compile`
printer had the cap.
