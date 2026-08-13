---
"@objectstack/spec": minor
"@objectstack/service-datasource": patch
---

feat(spec): per-type metadata read-path redaction seam in `kernel`, and ONE definition of "what is a credential key" in `data` (#8300)

Two additions to `@objectstack/spec`, both enabling #8154's security invariant
(stored credentials must never serve cleartext on the metadata read path):

- **`kernel/metadata-type-redaction.ts`** — `registerMetadataTypeRedactor` /
  `getMetadataTypeRedactor` / `listMetadataTypeRedactorTypes`, the same
  built-in-map + runtime-overlay registry pattern as its siblings
  `registerMetadataTypeSchema` and `registerMetadataTypeActions`. The
  `datasource` redactor is wired as a **built-in** (present the moment the
  module loads), because registering it from the opt-in datasource-admin
  plugin is measured fail-open: `sys_metadata` rows and the `/meta` read exits
  exist without that plugin.
- **`data/datasource-credential-redaction.ts`** — the credential-key
  derivation and read-path redaction previously in
  `@objectstack/service-datasource` (`refusedCredentialKeys`,
  `redactableConfigKeys`, `redactUrlPassword`, `redactDatasourceConfig`,
  `RedactedDatasourceConfig`), moved here so the datasource-admin read path
  and the metadata read path share one security list. The key set is derived
  from each driver's own `z.never()` contract plus the pre-#8078 alias list
  and turso's still-writable `encryptionKey` — byte-equal to what the
  service-datasource original derived, pinned by test.

`@objectstack/service-datasource` re-exports the moved names from
`@objectstack/spec/data` (existing imports keep compiling; behaviour
unchanged) and keeps `restoreRedactedConfig`, the admin service's write-path
inverse.

<!-- adr-0087: not-required (no-migration-prescription) additive new exports plus a same-name re-export move; no authorable key, stored shape, or consumer-visible behaviour changes, so there is nothing for an upgrader to migrate -->
