---
'@objectstack/formula': patch
---

perf(formula): the expression type checks build each typed check environment once per input, not once per call

Clause-②: no
Metadata-protocol: none

The type checks behind the authoring rules (`firstTypeMismatch`, `firstDateTextVerdict` and `firstDateTextCall`) built a new typed CEL environment on every call. Each build clones cel-js's registry and registers the whole stdlib again. The runtime authoring gate runs these checks over every expression in the stack each time a metadata item is published, so the cost grows with the size of the stack, not with the size of the item.

Measured on the showcase: one object publish built 903 environments for 97 distinct inputs. That was about 0.5 s of the publish request on an idle machine. The publish request now takes about 1.0 to 1.3 s on an idle machine, down from 1.6 to 1.8 s.

The environments are now kept per input (scope, date typing and field types), up to 512, least recently used first. The checks only parse and type-check against these environments, so a shared one gives the same verdicts as a fresh one. Nothing changes in what the checks report.
