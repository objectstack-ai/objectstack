---
'@objectstack/metadata-core': patch
---

fix(metadata-core): the protocol refusal for a package declared below the migration floor names the remedies that apply, never a `migrate meta --from` the chain refuses (#33031)

Clause-②: no
Metadata-protocol: none

`OS_PROTOCOL_INCOMPATIBLE` (`checkProtocolCompat`, answered `422` by the package install doors) prescribed `objectstack migrate meta --from N` for every declared major behind the runtime, and that command refuses every `N` under the chain's support floor (`MIGRATION_SUPPORT_FLOOR`, 16, ADR-0087 D3). A manifest declaring `engines.protocol: '^15'` (or `'^0'`) was told to run `--from 15`, which then failed with "the chain's support floor is 16".

Below the floor the refusal now does what it already did for a package ahead of the runtime: `diagnostic.migrateCommand` (and so `error.details.migrateCommand` on the HTTP answer) is absent, and the message names the two remedies that apply instead: install a build of the package for this runtime's protocol, or bring its metadata to protocol 16 by another path first and then run `objectstack migrate meta --from 16`. `^16` and every major from the floor up to the runtime's keep their `Run: objectstack migrate meta --from N` exactly as before, and the status, the code and the other four `details` members are unchanged.
