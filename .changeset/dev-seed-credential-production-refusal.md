---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/cli': patch
---

fix(auth)!: a server outside development mode refuses a development seed credential, and `os user set-password` sets a new one on the server

Clause-②: yes (narrowing) — narrowed: on a server whose `NODE_ENV` is not `development`, a password sign-in that submits the development seed password (`admin123`, or the value `OS_SEED_ADMIN_PASSWORD` sets) is refused on every account, and an account the development seed created opens no session while its stored password is still the one it was seeded with. Widened: the `os user set-password` command, the `sys_user.dev_seed_credential` column, and new `@objectstack/plugin-auth` exports `setOperatorPassword`, `findAccountByEmail`, `operatorPasswordRefusal`, `OPERATOR_PASSWORD_MIN_LENGTH`, `OPERATOR_PASSWORD_MAX_LENGTH` and the types `OperatorPasswordResetEngine`, `OperatorPasswordResetOutcome`, `OperatorPasswordResetRefusalReason`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, accepted value or metadata type is added, removed or renamed; a system column is added; nothing stored is rewritten: the moved answer is whether a server outside development mode accepts a development seed credential at sign-in. The one-line fix for a refused account is in the body: set a new password on the server with os user set-password. -->

**BREAKING** for a deployment that serves, outside development mode, a database `os dev` seeded, or any account whose password is the development seed password. Such a sign-in is refused. Set a new password on the server with `os user set-password <email>`; the refusal names the command. A server in development mode (`os dev`) is unchanged.

**The rule: a server outside development mode never accepts a development seed credential.** Development mode is `NODE_ENV=development`, the condition the development seed itself runs under. The rule lives in the auth plugin, so `os start`, `os serve`, the image and a custom host all apply it.

- **The seed password is refused at sign-in, on any account.** A password sign-in with the development seed password answers `403 PERMISSION_DENIED`, and its message names `os user set-password`. It is decided on the submitted password alone, before any account is read, so every address gets the same answer. This covers the seeded admin, the stack's `demoStaff`, any other account on that password, and a database seeded by an earlier release.
- **The accounts the development seed creates are marked.** `os dev`'s admin and each `demoStaff` account carry `sys_user.dev_seed_credential`: a one-way digest of the password hash the seed stored, never the password. The column is never returned on reads, and any password change stops it matching.
- **A marked account still on its seed password opens no session**, on any sign-in door (password, emailed link, one-time code, passkey, social or SSO, impersonation), whatever password it was seeded with, `os dev --admin-password` included. A password check never confirms that seed password: a password sign-in answers it as a wrong password.
- **No password change is offered at sign-in.** Whoever signed in first could perform it. The way out is the operator's reset on the server.

**`os user set-password <email>`** sets the account's password in the project database. It reads the new password from a terminal prompt (twice, not echoed) or from standard input with `--password-stdin`, never from the command line, and takes `--database-url` like the other one-shot commands. It checks that the new password is not a development seed password and is 8 to 128 characters long; the deployment's own password policy and password history are not applied. It writes nothing on a refusal. It deletes the account's outstanding password-reset links and codes from the project database before the new password lands. It clears the account's development seed mark and any sign-in lock, records the change time, and ends every session and revokes every API key of the account, as an administrator's forced reset does. It asks for no password change at the next sign-in. It writes the project database only: a secondary storage the host configures for the auth service is out of its reach, for the reset links and the sessions alike. With one configured, run the command with the server stopped, or restart the server afterwards; a secondary storage kept outside the server process outlives a restart and is cleared of the account's entries by hand.

**Not detected:** a database seeded before this release with a custom seed password carries no mark and no well-known password. Set a new password with `os user set-password` on each account it seeded before serving it outside development mode.

**Not ended at boot:** this release refuses the development seed password and every new session for a seeded account still on it. Sessions and API keys a seeded account was issued before the server left development mode are ended by `os user set-password`; run it on each seeded account before serving the database. Ending them at boot is follow-up #35184.
