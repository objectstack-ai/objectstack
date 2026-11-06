---
'@objectstack/cli': patch
'@objectstack/rest': patch
'create-objectstack': patch
---

fix(cli,rest)!: `os package install` names its server and credential `-u/--url` and `-t/--token`, like `os package export`; the `/meta` read gate's permission refusal is localized

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema, export or stored row changes: a command-line option of one CLI command is renamed, which no metadata, artifact or database row records, so there is nothing for `objectstack migrate meta` to rewrite; the rename is for the person or script typing the command -->

**BREAKING** for a script that runs `os package install` with `-r` or `--runtime`. The option is renamed with no alias, so the old spelling is refused as an unknown flag. Write `-u` / `--url` in its place:

- FROM `os package install -r <url>` / `os package install --runtime <url>` TO `os package install -u <url>` / `os package install --url <url>`.

The value, its default (`http://localhost:3000`) and its environment variable (`OS_RUNTIME_URL`) are unchanged. A script that sets only `OS_RUNTIME_URL` needs no change.

`os package install` also takes `-t` / `--token` (environment variable `OS_RUNTIME_TOKEN`, new): a token the target runtime issued, sent as `Authorization: Bearer`, instead of signing in with `--email` / `--password`. Passing both is refused before any request. These are the spellings `os package export` and the other server-talking commands use.

The scaffold's `AGENTS.md` and blank template README now spell the install command with `--url`.

`@objectstack/rest`: an app, a dashboard or a list view a signed-in caller may not open is still refused `403 PERMISSION_DENIED`, and the sentence is now the operation catalog's `permission_denied` in the caller's locale, the sentence plugin-security's object refusals already use. Opening the Setup app without access in a Chinese console read `You do not have permission to open the 'com.objectstack.setup' app.`; it now reads 「您没有执行此操作的权限，如需访问请联系管理员。」. The sentence no longer carries the item's API name. A deployment's `errors.permission_denied` translation overrides it on the REST door, as it does for those refusals.
