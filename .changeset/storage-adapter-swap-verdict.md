---
'@objectstack/service-storage': patch
'@objectstack/cli': patch
---

**The storage adapter stops being rebuilt and re-pointed on every boot, and the
"files may be unreachable" warning stops firing at a healthy server (#4096).**

Every `os dev` / `os serve` boot printed:

```
WARN StorageServicePlugin: storage adapter swapped (LocalStorageAdapter →
LocalStorageAdapter). Existing files were NOT migrated and may be unreachable
through the new adapter.
```

The warning was telling the truth. `serve` constructed the plugin with
`{ driver: 'local', root }` — and `StorageServicePluginOptions` declares
neither key. Both were dropped silently, so the plugin applied its own
`./storage` default, `OS_STORAGE_ROOT` changed nothing, and uploads landed in a
directory nobody named. The `storage` settings namespace then corrected the root
on its first read (its manifest default is `./.objectstack/data/uploads`),
genuinely moving the backing store — every boot, forever.

Three fixes, because there were three defects:

- **`serve` now passes options the plugin reads** — `{ adapter: 'local',
  local: { rootDir } }`. `OS_STORAGE_ROOT` takes effect, and local uploads land
  under `.objectstack/data/uploads` from the first byte instead of `./storage`.
  Extracted as `resolveStorageCapabilityArg` so the option SHAPE is pinned by
  tests: a mismatch like this type-checks fine and does nothing at runtime.
- **A swap is skipped when nothing changed.** The plugin records what the
  running adapter points at and compares resolved configurations, instead of
  rebuilding whenever the settings namespace held any value at all — which is
  every boot once that namespace has persisted its own defaults.
- **The warning now means what it says.** It fires when the BACKING STORE moved
  (kind change, different root, different bucket/region/endpoint), not merely
  when the adapter object was replaced. A credential rotation swaps the adapter
  so the new key takes effect and logs at info: same bucket, nothing stranded.
  A swap from a caller that resolved no target still warns — ignorance must not
  silence it.

Path spellings are normalised, so the platform writing the same default two ways
(`./.objectstack/data/uploads` in the settings manifest,
`.objectstack/data/uploads` in the CLI) is no longer read as a migration between
a directory and itself.

Verified on `examples/app-todo`: the boot-diagnostics block went from four
warnings to three, with the storage line gone and `./storage` no longer created.
19 unit cases cover the target resolver and the swap/warn split (including the
refusals), 4 plugin-level cases pin what a boot does and says, and 7 pin the CLI
option shape.

`config.storage` authored with the `driver`/`root` dialect is still forwarded
verbatim and still not read by the plugin — the same mismatch one layer up.
Correcting it means deciding whether the plugin accepts that dialect or the
config schema is wrong, so it is filed rather than papered over with a lenient
alias here (AGENTS.md Prime Directive #12).
