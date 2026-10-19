---
'@objectstack/formula': patch
---

perf(formula): a CEL evaluation reuses one environment instead of building the stdlib on every call, and compiles reuse the canonical parse environment

Clause-②: no (an internal cache: no accept set moves, no evaluation result moves, no exported signature changes; owes the seat's review of record before the queue)

- **`celEngine.evaluate` reuses one environment.** It used to build a new cel-js `Environment` and register the whole stdlib into it on every call, which objectql's formula fields reach once per row per field. The stdlib now reads `now()`, the timezone and the permission binding of `current_user.can` / `current_user.hasCapability` from a per-evaluation slot. `evaluate` saves the slot, sets it and restores it in a `finally`, so a nested or a thrown evaluation leaves the outer binding as it was. Evaluations also run a bounded per-source cache of parsed programs, keyed on the source after its row-dependent rewrites.
- **`celEngine.compile` reuses the canonical parse environment** that `parseCelToAst` already shares.
- Results, error kinds and error messages are unchanged. `registerStdLib`, `registerPermissionPredicate` and `registerCapabilityPredicate` keep their signatures and their behaviour.
- Measured on one source evaluated 20,000 times: about 142 µs per evaluation before, about 3 µs after. A 25-row read of an object with three formula fields built 78 environments before and builds none after.
