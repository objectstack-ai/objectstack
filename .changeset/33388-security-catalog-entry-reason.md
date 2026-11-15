---
'@objectstack/spec': patch
---

docs(spec): the security-catalog overlay migration entry says the environment catalog and a package never hold one name, not that a permission set holds one name per deployment

Clause-②: no
Metadata-protocol: none

The `security-catalog-environment-overlay-refused` semantic migration entry's `reason` opened "Positions, permission sets and capabilities hold one name per deployment", which stopped being true for permission sets when a permission-set name became one holder per namespace (ADR-0150 D2/D9). It now opens with the entry's own subject: the environment catalog and a package never hold one name. Its `id`, `surface`, `replacement` and `acceptanceCriteria` are unchanged, and so is the cold-boot refusal it records. The `adr_0146_d6_security_catalog` gloss on `OverrideClassificationBasis` now says the security catalog takes no override, and the permission sets guide lists the environment among a name's one-holder cases and says a grant names its set by its package and name. No schema, rule or runtime behaviour changes.
