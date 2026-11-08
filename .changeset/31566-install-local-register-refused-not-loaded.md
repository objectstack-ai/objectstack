---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an installed app whose register the engine refuses at boot is listed as not loaded, with the refusal's code and sentence

Clause-②: yes (widening)
Metadata-protocol: none

An earlier build could ledger a cloud-fetched install whose register the engine refuses (a default page that is not a record page, an object another package owns, two packages of one artifact defining one object, and the like). At every boot the rehydrate meets the same refusal, logs `rehydrate failed`, loads nothing of the package and keeps its ledger entry. `GET /api/v1/marketplace/install-local` listed such an entry as installed, with `withSampleData` and no `notLoaded` marker, so Installed Apps showed an app that the runtime does not hold.

The rehydrate now records a register refusal (a throw declaring a 4xx status, the rule the install door uses to refuse it) where it records the protocol-range refusal. The listing then marks the entry `notLoaded: { code, message }` in place of `withSampleData`: `code` is the refusal's ADR-0112 code and `message` is the engine's sentence, the same one the boot logs. The `notLoaded` marker is now a closed union of two arms. The protocol arm `{ code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange }` is unchanged. A healthy entry is listed as before. DELETE and a compatible reinstall still act on the marked entry. A register fault that declares no 4xx is not marked, because the next boot can load it. A failure after a successful register is not marked either, because the package is loaded. The console's Installed Apps already shows a non-protocol code as "not loaded".
