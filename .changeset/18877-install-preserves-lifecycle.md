---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

Installing a package no longer reverts an operator's most recent enable/disable. The install contract is now 「缺省 = 保持,有旗 = 设置」: an install that was not asked to move the lifecycle state does not move it (#18877).

`SchemaRegistry.initialDisabledPackageIds` is a boot hydration input — filled once, before any registration, from the durable disable file, and never updated by `enablePackage` / `disablePackage`. It was nevertheless consulted by every `installPackage` call, so once an id was in the boot seed set, every re-install within that boot re-landed it DISABLED whatever the operator had most recently done. Since the durable write started following the row the door returns (#18752), that stopped being memory-only:

```text
boot 1   operator disables the package                → disk lists the id
boot 2   seeded from disk; the package installs disabled
         PATCH /packages/:id/enable                   → 200, registry true, disk CLEARED
         install(m, { overwrite: true })   (no flag)  → the seed still listed the id
                                                      → row disabled, disk written DISABLED
boot 3   the operator's enable is gone, with no error anywhere
```

Reachable with nothing exotic: disable → restart → enable in Studio → an SDK upgrade with `overwrite`.

- **`installPackage` reads the ROW first.** An existing row keeps its own `enabled`, `status` and `statusChangedAt`; the boot seed decides only for an id that has no row yet (boot hydration and a genuinely fresh install). A fresh id the seed never named still lands enabled, the declared default.
- **`enableOnInstall` now sets the state in BOTH directions.** `true` ⇒ `enablePackage`, `false` ⇒ `disablePackage`, and an ABSENT flag makes no lifecycle call at all — previously only `false` was read, and the `true` case was carried by the re-install restamping every row enabled. The bare (unwrapped) body form still honours nothing: no schema declares the key there.
- **`DELETE /packages/:id` clears both records.** The id leaves the boot seed set with its row, and its durable disable entry is cleared, so the next install of that id is a fresh install. Previously the durable record was immortal — a delete left a disable behind that named a package that no longer existed.
- ⚠️ **Behaviour change for a flag-absent re-install of an EXISTING row.** It used to return the package to the declared default (enabled); it now preserves what the row says. An upgrade flow that relied on a re-install to clear a disable must now send `enableOnInstall: true` — the same key, the same door, now honoured in that direction. A fresh install is unaffected.

Maintainer decision batch #157 item 5, letter C. Item 4 of that ruling re-rules the #18058 F1 pin 「flag-absent re-install clears the durable disable」 to 「preserves」; F1b stands unchanged.

Clause-②: no
