---
---

fix(spec): the liveness gate checks the reverse direction — a ledger row that outlived its schema property now fails CI instead of rotting silently. Gate-only (`packages/spec/scripts/`, not published), so this releases nothing.
