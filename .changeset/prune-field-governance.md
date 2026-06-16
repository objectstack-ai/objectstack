---
"@objectstack/spec": minor
---

chore(spec): prune 7 dead field governance/compliance properties (dead-surface plan, P0/P2). Removes `FieldSchema` props that implied data-protection/governance behavior but had no runtime consumer — false promises (the real at-rest channel is `type: 'secret'`): `encryptionConfig`, `maskingRule`, `auditTrail`, `cached`, `dataQuality`, `writeRequiresMasterRead`, `trackFeedHistory`. Also drops the now-unused `EncryptionConfigSchema`/`MaskingRuleSchema` imports. Kept `caseSensitive` and `dependencies` (potentially functional — conservative). Field types unchanged.
