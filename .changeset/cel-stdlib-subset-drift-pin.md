---
"@objectstack/formula": patch
---

Pin `CEL_STDLIB_FUNCTIONS` to the real CEL `Environment` as a declared subset

The exported catalog advertises 35 function names while the evaluation
environment resolves 72, and nothing asserted the relationship between them. A
new drift pin (`cel-stdlib-drift.test.ts`) reads the authoritative environment
through `Environment.getDefinitions()` and holds three directions: every
advertised name is registered **and bare-callable**; every bare-callable
function `registerStdLib` adds is advertised; and the bare-callable built-ins
deliberately withheld (`bytes`, `dyn`, `type`, `uint`) are exactly a declared
list, so a cel-js upgrade cannot add one unnoticed.

The catalog's contents are unchanged. Its docblock now records the measured
decomposition of the 72 and states the membership rule that makes the gap
deliberate rather than stale: 33 of the 72 are callable only on a receiver
(`s.split(',')`), and every consumer spends an entry as a bare call.
