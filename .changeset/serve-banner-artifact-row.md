---
"@objectstack/cli": patch
---

fix(cli): `os serve`'s ready banner no longer names a config file that was not read (#8978)

On an `OS_ARTIFACT_URL` boot (#8368) the `objectstack.config.ts` in cwd is
deliberately never executed — the boot diagnostics say so — but the ready
banner's `Config:` row still printed it, because `relativeConfig` was derived
from `args.config` before the artifact-fallback branch was decided and handed
to `printServerReady` unconditionally. The plain artifact-fallback path (no
config authored, booting from the `<cwd>/dist/objectstack.json` convention or
`OS_ARTIFACT_PATH`) had the same defect one level worse: the row named a
config file that does not exist on disk at all.

The banner is the surface an operator reads to answer "what is this container
actually running" — naming what did NOT boot points them at the wrong app.

`serve` now reports the resolved artifact's already-redacted `display` string
in an `Artifact: … (OS_ARTIFACT_URL)` row when `OS_ARTIFACT_URL` pinned one,
omits the row on the other artifact-fallback paths (no safely-redacted value
is in hand there), and reports the authored config exactly as before on the
ordinary config-boot path.
