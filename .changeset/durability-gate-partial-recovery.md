---
---

chore(scripts): the durability log-level gate no longer excuses a catch that only PARTIALLY rethrows

`check:durability-log-level` skipped any guarded `catch` containing a `throw`.
That is right when the catch propagates on every path — the failure reaches the
caller and nothing is being degraded. It is wrong for a catch that **recovers on
one branch and rethrows on the other**: the rethrow says nothing about the
branch that returns a substitute value, and that branch is a degradation like
any other.

Found while closing
[#4998](https://github.com/objectstack-ai/objectstack/issues/4998), whose seam
(`writeRecoveringSummary`: recover `ERR_SUMMARY_RECOMPUTE`, rethrow everything
else) has exactly that shape. Registering its callee in
`DURABILITY_CRITICAL_CALLEES` produced a ledger entry that could never fire —
protection that reads as real and enforces nothing, which is worse than none.
Measured against the repo, the tightened rule changes the verdict on no existing
seam (11 seams, all still loud or rethrowing) and needs no baseline entry.
