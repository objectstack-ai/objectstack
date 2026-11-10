---
'@objectstack/cli': patch
'@objectstack/verify': patch
---

fix(verify): `os verify` loads the project's `.env*` files as `os dev` does, and fails a run whose boot drops a seed record

Clause-②: yes
Metadata-protocol: none

`os dev`, `os serve`, `os start` and `os migrate` load the project's `.env*` files before anything reads the environment; `os verify` did not, so a value an app pins in its `.env` was missing from verify's boot alone. The showcase pins its home currency there (`OS_LOCALIZATION_CURRENCY=USD`): verify's boot had none, refused every seeded invoice and the lines under them (26 seed records), and still printed `✓ verify passed` and exited 0.

- `os verify` now loads the app's `.env*` files first, from the directory holding its config, with the files `os dev` reads (the development mode), through the same loader `os serve` and `os migrate` use. A variable already exported in the shell still wins. Everything that reads the environment sees them, the tenancy posture included: a project whose `.env` asks for a walled posture now verifies under it, as `os serve` serves under it.
- The run judges the boot's seed from the kernel's own records. Every record the seed dropped, every reference field it dropped from a written record and every marketplace install that came up empty counts as a runtime failure, so such a run ends `✗ verify FAILED` with exit 1, and the seed line names the count. A seed still writing when the wait ends, or one that settled without reporting an outcome, counts once: the run cannot say whether its rows landed. A boot that ran no inline seed on purpose (a multi-tenant boot replays it per organization) is reported as not judged and counts nothing.
- `os verify --json` carries the judgement as a new top-level `seed` field (`status`, `suppressed`, `inFlight`, `sources`, `totals`, `hardFailures`), and `hardFailures` includes it. `@objectstack/verify` exports `readSeedOutcome`, `judgeSeedOutcome`, `formatSeedReport`, `DEFAULT_SEED_SETTLE_TIMEOUT_MS` and the `SeedReport`, `SeedSourceReport` and `SeedStatus` types.

**The remedy** for a run this turns red: the `[Seeder]` warnings in the same run name each dropped record and why the engine refused it. Fix the seed or the setting it needs (for a home-currency refusal, `OS_LOCALIZATION_CURRENCY` in the project's `.env`), then verify again.
