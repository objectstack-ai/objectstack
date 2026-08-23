---
"create-objectstack": patch
---

Fix `create-objectstack`'s startup banner hardcoding `◆ Create ObjectStack v6.x`
regardless of the package's real, released version — eleven majors stale, on
the first line of output a newcomer ever sees (#10325). The banner now calls
`readCliVersion()`, the same reader `.version()` already used, instead of a
literal string.

Dropping the real version in without recomputing the box's padding would have
reintroduced the same defect one line later — the border is a fixed run of
`═` computed for the 4-character `v6.x`, and a longer real version (`v17.1.0`
is 7 characters) would push the right border out of alignment (the sibling
bug fixed in #10322, one function away in the same file). The box now derives
its width from the version string's plain length and widens the frame — never
truncates — for a version long enough to need more room; ordinary versions
still render at the historical box size.

No behaviour change beyond the printed banner.
