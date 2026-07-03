---
"@objectstack/metadata-protocol": patch
---

fix(protocol): versionless package installs now persist to sys_packages (#2532)

`installPackage` writes both package stores, but its durable half was guarded by
`pkgSvc?.publish && manifest.version` — silently skipping every versionless
runtime-created base (`{id, name}` from the builder / Setup). Those packages
lived only in the in-memory registry and vanished on restart, while their
metadata and tables survived. The version is now defaulted (`0.1.0`) instead of
skipping, a failed persist logs loudly instead of silently, and `deletePackage`
drops the `sys_packages` record so an uninstalled package no longer resurrects
at the next boot (service-package hydrates that table into the registry).
