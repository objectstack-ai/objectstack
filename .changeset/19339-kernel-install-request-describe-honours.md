---
"@objectstack/spec": patch
---

`kernel/InstallPackageRequest.enableOnInstall` no longer tells authors the in-process primitive ignores the key — it now states the three states that primitive really applies (#19339).

The declaration's published description read "this protocol primitive does not read it". That was true when it was written and stopped being true when `MetadataProtocol.installPackage` started honouring the key (`482d584121`): `true` enables, `false` disables, and an ABSENT key makes no lifecycle call at all. Nothing went red, because `check:docs` holds the generated reference page equal to the `.describe()` and the two still agreed with each other — internal consistency, not truth.

Clause-②: no

**What moves**

The `.describe()` text of one key, the doc block above it, and the two reference pages generated from that text (`references/api/protocol.mdx`, `references/kernel/package-registry.mdx`). It now reads: "restates the install-door request key, whose one authority is api/PackageInstallRequest; this protocol primitive honours it on the registry row: true enables, false disables, absent makes no lifecycle call".

The scope word "on the registry row" is load-bearing and is spelled out in the doc block: the durable disabled-package file is keyed by environment, which an `InstallPackageRequest` does not carry, so this seam moves the registry row for the life of the process and `POST /api/v1/packages` still owns the record that survives a restart.

**What does not move**

No key is added, removed, renamed or retyped, and no default changes — the accept set is byte-for-byte what it was, and `api-surface`, `authorable-surface` and `authorable-defaults` are all unchanged. `PackageInstallRequestSchema` (`api/package-api.zod.ts`) remains the one authority for this key, and the parity pin that holds the copy to it is untouched.
