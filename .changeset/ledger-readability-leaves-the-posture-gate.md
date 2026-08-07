---
'@objectstack/cli': patch
---

`os doctor` reports an unreadable installed-package ledger under EVERY tenancy posture

The three rows that say doctor could not read `.objectstack/installed-packages/`
— the directory could not be enumerated, a file inside it would not parse, or
the package that reads ledgers would not load — were all produced inside the
ADR-0120 D5e unique-scope advisory, whose entry condition is
`postureGatesGlobalUniques(posture)`. That is true only for `isolated` (and its
legacy alias `multi`), so under `single` and `group` the ledger was never read
at all and `os doctor` said nothing about it. `OS_TENANCY_POSTURE` unset
resolves to `single`, so the silent posture was the default one.

Whether an environment's `unique: 'global'` is dangerous IS a posture question,
and that gate is unchanged. Whether a file in the ledger can be read is not: it
is equally true under every posture and means the same thing under every one —
that installed app is dropped at boot, absent from the kernel and from the
console's installed-apps list.

Ledger readability is now its own check, run unconditionally, independent of
both the posture and of whether an `objectstack.config.ts` loaded. The D5e block
keeps the unique-scope judgment alone, consuming the same reading rather than
taking a second one, so one bad ledger produces one row under `isolated` too. An
incomplete reading still withholds `✓ Unique scope` there — that line is a claim
about both halves of the advisory and only one of them ran.

**Report face:** the three readability rows now take the `Installed packages`
name column instead of `Unique scope`, and drop `for installation-wide uniques`
from the message's parenthetical — under `single` and `group` there is no
unique-scope check to name. This supersedes the sentence in the pending
`quiet-ledgers-speak-up` changeset that called it a `Unique scope` warning row.
The `Unique scope` name still exists, under the D5e block, for the unique-scope
verdict alone. A readable ledger prints nothing new under any posture.

This is the diagnostic-command half only. The runtime's own signal — the
`rehydrate()` warning per dropped entry at boot — is unchanged and stays
posture-independent; the two are separate channels for separate moments and
neither substitutes for the other.
