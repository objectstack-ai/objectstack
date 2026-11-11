---
'@objectstack/verify': patch
'create-objectstack': patch
---

fix(verify): a passing `os verify` run and a passing starter `pnpm test` no longer print the boot's INFO chatter, the `[Registry] …` lines or warnings about the harness's own secret

Clause-②: no
Metadata-protocol: none

On the blank starter a passing `os verify` printed 626 lines before its verdict: 346 INFO records, 263 `[Registry] …` lines and four better-auth warnings that the harness's secret was short and low-entropy. A failing run still prints its failure: a boot that fails prints the kernel's ERROR record naming the plugin, and the error reaches the caller.

- **`@objectstack/verify`**: `bootStack` boots at `warn` unless `OS_LOG_LEVEL` (or the legacy `LOG_LEVEL`) names another level, the default `objectstack serve` already uses. The ObjectQL registry's `[Registry] …` lines follow the same level unless `OS_REGISTRY_LOG` is set. To see the whole boot log, run with `OS_LOG_LEVEL=info` or `OS_LOG_LEVEL=debug`. The auth signing secret, when `authSecret` is not passed, is 32 random bytes held in the process's memory for its lifetime, instead of a fixed 25-character string; a restart in the same process over the same database file still accepts the sessions it issued.
- **`create-objectstack`**: the starter's `vitest.config.ts` no longer sets `OS_REGISTRY_LOG`, because the booted stack is quiet by default; its comment names `OS_LOG_LEVEL=info pnpm test` for the whole boot log.
