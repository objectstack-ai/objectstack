---
"@objectstack/cli": minor
---

`os serve` now announces **`objectstack:seed-settled`** on its existing ipc channel when this boot's seeding has come to rest, and `os dev` forwards it to its own parent process when one holds the channel. A script that spawns a dev server can finally wait for the boot to finish without reading the child's output.

`✓ Server is ready` is true about the HTTP server and says nothing about the app. Seeding races a soft budget (`OS_INLINE_SEED_BUDGET_MS`, default 8s) and past it finishes in the background, so the banner can be a minute ahead of the seed's own result — measured downstream at **82 seconds of silence after the banner, then 120 `ERROR` lines**. The same command on the same corpus settles before the banner on a machine where the seed fits its budget, so the defect is invisible on exactly the boxes that would have caught it. Everything that distinguishes the two cases arrives on the child's inherited stdio, and reading that costs the boot its TTY.

- **The producer is not new.** `@objectstack/runtime` already declares every seed source and settles it at the moment its boot-time write is done, publishing the tally under `@objectstack/spec`'s `seed-settlement` contract. This is the hop outward: the CLI subscribes to two hooks the kernel already fires and reads a snapshot it already publishes. No service is registered and no tally is mutated — the contract is read-only by design.
- **Sent once, and never before `objectstack:listening`.** Seeding that settles during `runtime.start()` is latched and released after the bound port is published, so a parent that waits for the listening message and only then listens for the settle cannot miss it.
- ⛔ **Keyed on `inFlight`, not `pending`.** Multi-tenant replay and `skipSeedData` register a seed source and deliberately never run it, keeping `pending` above zero for the life of the process. A `pending`-keyed message would never be sent on those boots, and its absence would be indistinguishable from a boot still writing — the same ambiguity this closes, one level up. Those boots get the message with `suppressed` reasons attached instead, so a consumer can say *why* no rows landed.
- **Failure settles too.** A seed that failed has still come to rest; withholding there would recreate the hang. `ok` is a verdict on the per-source counts the boot recorded, and the message carries those counts.
- **The over-budget banner no longer omits seeding.** `Seeds:` is fed by outcomes recorded when a load *finishes*, so past the budget the row was ABSENT and the transcript was byte-identical to an app that declares no seeds — which is how the defect hid. It now reads `pending — N sources still writing`, with a line saying seeding continues in the background; suppressed sources are named rather than reported as pending.

⛔ An ipc channel is **not** made a requirement of either command: `process.send` is undefined under an ordinary terminal boot, both sends are no-ops there, and no byte of that transcript changes. Nothing in the existing `objectstack:listening` publication moves.

Note that `os dev` consumes `objectstack:listening` itself (it is how the bound-port readout and the MCP connect hint learn the real port) and relays only `objectstack:seed-settled`. Spawn `os serve` directly to receive both in one place.
