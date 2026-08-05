---
'@objectstack/cli': patch
---

fix(cli): `OS_STORAGE_ROOT` now actually takes effect — renamed to `OS_STORAGE_LOCAL_ROOT`, the name the settings service reads (#4968)

The CLI and the settings service spelled the local storage root differently.
The CLI wrote its own invented name, `OS_STORAGE_ROOT`; the settings service
derives the env name for the same value from the namespace it owns —
`envKeyOf('storage', 'local_root')` = `OS_STORAGE_LOCAL_ROOT` — and nothing in
the repo ever set that. So the two channels never met: `os serve` constructed a
local adapter at the root the operator named, `StorageServicePlugin` re-resolved
from settings at `kernel:ready`, found only the manifest's **schema default**,
and swapped the adapter to `./.objectstack/data/uploads`.

`OS_STORAGE_ROOT` therefore took effect for exactly one value — the one that
happens to equal that default — which is why plain `pnpm dev` never showed it.
Every other value was constructed and then discarded:

- **Production**: `OS_STORAGE_ROOT=/srv/uploads` was ignored and uploads landed
  under the process cwd. An operator following `backup-restore.mdx` backed up an
  empty directory.
- **`dev --fresh`**: the tempdir was documented to own all state for the run;
  uploads actually went to the project cwd and survived process exit.
- Every clean boot logged a data-loss-grade "adapter swapped … existing files
  were NOT migrated" warning. That warning was **accurate** — the swap really
  happened — and is untouched here. It stops firing because the swap stops.

The fix is at the producer, not as a tolerant read in the consumer: `dev.ts`
publishes `OS_STORAGE_LOCAL_ROOT`, and `serve.ts` resolves the root through one
channel (`resolveStorageLocalRootEnv`), shared with `os migrate`'s storage
bootstrap so the CLI materialises bytes exactly where the server would.

`OS_STORAGE_ROOT` keeps working for **one release** via
`readEnvWithDeprecation('OS_STORAGE_LOCAL_ROOT', 'OS_STORAGE_ROOT')`, warning
once per process, and is then removed. When the legacy name supplies the value
it is also stamped onto the canonical name, because the settings service only
ever looks up `OS_STORAGE_LOCAL_ROOT` — without the stamp a deployment on the
old spelling would keep the original defect in full.

Storage settings now resolve `source: 'env'` at the value the adapter was built
with, so Setup → Settings → File Storage shows the directory actually in use.
No change to `packages/services/service-storage` — the swap predicate is correct
and stays as is.
