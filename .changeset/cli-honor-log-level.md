---
"@objectstack/cli": patch
---

fix(cli): honor OS_LOG_LEVEL / --log-level instead of hardcoding the kernel logger to `silent` (#1533)

`os serve` / `os start` built the runtime kernel with a hardcoded `{ level: 'silent' }` logger, suppressing every plugin `logger.warn` / `logger.error`. A record-change flow whose condition or node faulted (surfaced via `logger.warn` in `plugin-trigger-record-change`) produced zero operator-visible output — the flow simply had no effect — undercutting ADR-0032's "fail loudly" promise when run via the CLI.

The kernel logger level is now resolved from `--verbose` (→ `debug`) → `--log-level <level>` → `$OS_LOG_LEVEL` / `$LOG_LEVEL` → default `warn`. Defaulting to `warn` surfaces flow/hook execution-failure warnings and automation-engine errors out of the box, while the existing boot-quiet window still suppresses info-level startup chatter. Pass `--log-level silent` (or `OS_LOG_LEVEL=silent`) to restore the previous fully-quiet behavior. `start` and `dev` gain a matching `--log-level` flag and forward it (plus the existing `--verbose`) to the spawned `serve`.
