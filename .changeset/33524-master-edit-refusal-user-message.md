---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
---

fix(plugin-security, spec): the master-detail write refusal tells its user which master record needs their access, in their language

Clause-②: no
Metadata-protocol: none

A write of a `controlled_by_parent` detail (create, edit, delete and the other write verbs) refused because the caller lacks edit access on its master record (or read access, on a detail that declares `writeRequiresMasterRead`) now carries a `userMessage`. It names the master object's label: the deployment's translation in the caller's language, else the declared label. The caller's language is the request locale, else the workspace default, else English. The console shows a refusal's `userMessage` in place of its generic "You don't have permission to save this record.", so a user creating a billing milestone under a contract they can read but not edit now reads that the missing access is on the contract.

The sentences are new keys in the operation-message catalog (en, zh-CN, ja-JP, es-ES): `errors.master_record_edit_denied` and `errors.master_record_read_denied`, with `{{master}}`, and their `_opaque` forms, which name no master. The opaque forms answer a writer who cannot read the master reference (the refusal names no master to them) and a master object with no label. A deployment overrides any of the four with a `translation` item under that key.

The HTTP status, `code`, `message` and `details` of the refusal are unchanged; only `userMessage` is added. The owner-rule refusal of a row whose optional master is empty is unchanged and carries no `userMessage`.
