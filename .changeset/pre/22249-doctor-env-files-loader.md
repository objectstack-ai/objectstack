---
'@objectstack/cli': patch
---

fix(cli): in the source checkout `os dev` serves, `os doctor`'s `Environment files` row names `os serve` / `os start` as the loaders of the `node_env=production` cascade it reports (#22249)

Clause-②: no

- **What changed.** With an `objectstack.config.ts` that boots as itself (alone, or beside its own compiled `dist/objectstack.json`), the `Environment files` row now says whose `.env*` cascade it resolved. A freshly scaffolded project with no `.env*` file reads ``✓ Environment files    No .env* files here (node_env=production, the cascade `os serve` / `os start` load) — environment read from this process only — no environment input set``. When files are loaded, the row reads ``.env, … (node_env=production), the cascade `os serve` / `os start` load`` where it used to end ``the cascade `os serve` loads``. Before, the no-file form named no loader at all. That left `node_env=production` sitting directly above the `NODE_ENV` row that says `os dev` runs the project as development.
- **What did not change.** Doctor still resolves the cascade exactly as `os serve` does, for `NODE_ENV || 'production'`. So it reads the same `.env*` files and every env-derived verdict, the tenancy-posture refusal among them, is unchanged in every posture. Outside the source checkout, the row is unchanged byte for byte. That covers an artifact-only project, a config beside `OS_ARTIFACT_URL` or beside an `OS_ARTIFACT_PATH` naming another artifact, and a directory with neither. Doctor's exit code is unchanged.
