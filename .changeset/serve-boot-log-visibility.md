---
'@objectstack/cli': patch
---

**`os dev` / `os serve` stop swallowing every plugin boot-phase log line — the
boot-quiet window buffers instead of discarding (#4012).**

`serve` blanks stdout while the kernel boots so the startup banner is readable,
and dropped what it intercepted. `ObjectLogger` routes `debug`/`info`/`warn` to
**stdout** — only `error`/`fatal` go to stderr — so that one line swallowed
every boot-phase `logger.warn` any plugin emits: the ADR-0110 D5
`[action-governance]` inventory, the automation engine's binding warnings,
every degraded-boot notice. `os dev` spawns `serve` with inherited stdio, so a
single drain blinded both entrypoints at every log level, and it inverted the
flag's own promise — the default is `warn` precisely "so flow/hook execution
failures surface (ADR-0032)". Data-phase logging was unaffected, which is why
the hole survived: `--log-level debug` printed thousands of lines with none
from boot.

- The intercepted bytes now land in a line-oriented, bounded `BootLogCapture`
  that classifies each line against `ObjectLogger`'s pretty/text/json
  renderings and retains only records at `warn` or above, so buffer size tracks
  a boot's warnings rather than its chattiness. The startup chatter the window
  exists to hide is still dropped.
- Retained records replay under the banner, beside the automation and seed
  summaries that exist for exactly this reason — and on the two exits that
  never reach the banner: `OS_MIGRATE_AND_EXIT` (a deploy pipeline must not
  lose a degraded-boot warning) and serve's error path, where a boot that died
  is when its warnings matter most.
- `--verbose` / `--log-level debug|info` no longer open the window at all.
  Buffering a stream the operator explicitly asked to watch would be the flag
  defeating itself.

On `examples/app-todo`, `os serve` went from 25 lines with zero WARN among them
to surfacing five boot warnings, including the `[action-governance]` line
naming all eight unbound actions. This closes the loop the D5 inventory
changeset left open: the inventory was already emitted correctly and is now
visible on the platform's own dev loop.
