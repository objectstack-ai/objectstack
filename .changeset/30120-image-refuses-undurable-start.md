---
'@objectstack/cli': patch
'@objectstack/service-settings': patch
---

fix(cli): the official image refuses to start on a disk it would lose; every other production `os start` says what it keeps there, and administrators see it in the Console

Clause-②: no
Metadata-protocol: none

- **`@objectstack/cli` (the official image).** With `OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED=true`, which the official image now sets in its `ENV`, `os start` exits 1 unless `OS_DATABASE_URL`, `OS_AUTH_SECRET` and `OS_SECRET_KEY` are all set explicitly (their legacy names count, and so do `--database` / `--auth-secret` and a database the project config declares). It names the missing ones before it writes a database file or a secret, and says how a deployment already running on generated values carries them over: the files in the container's home, and which of them the container holds. An explicit `OS_DATABASE_URL=file:/path/on/a/volume/app.db` passes. A value of the switch that is not `true`/`false`/`1`/`0` is refused rather than read as off. **Upgrading an image deployment that ran on its defaults:** read `auth-secret` and `dev-crypto-key` (and `data/objectstack.db`) out of the old container's `/home/node/.objectstack` and set them before you start the new one.
- **`@objectstack/cli` (every other `os start`).** Unchanged: it keeps booting. In production mode, when it keeps its database, its sign-in secret or its data key on its own disk because nobody set them, it prints a block naming each file and the variable that moves it off that disk, and hands the same facts to the server process on the internal `OS_INTERNAL_DEPLOYMENT_FINDINGS` channel.
- **`@objectstack/service-settings`.** Two routes behind the settings door, for callers holding `manage_platform_settings`: `GET /api/settings/deployment/notice` answers what this production deployment keeps on its own disk (the database file, the generated sign-in secret, the data key file) plus two lower-severity lines (uploads on the local disk; no email service that delivers), and `POST /api/settings/deployment/notice/hide` records an administrator's acknowledgement of exactly what they read as a `config_change` row on `sys_audit_log`. A member is refused `403`, the state is not on the public auth config, a hide is refused `409` where no audit log is mounted or the notice changed since it was read, and outside production mode the notice is empty. No package export is added.
