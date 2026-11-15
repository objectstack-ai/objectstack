---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

fix(plugin-audit): a redaction run admits and opens each checkpoint once; a late checkpoint never lists a row another sealer already sealed; a seed whose sequence another checkpoint holds is dropped

Clause-②: no
Metadata-protocol: none

**Redaction runs (`os migrate audit-mail-bodies`, `audit-key-material`, `audit-metadata-bodies`).** The redaction amendment writer verified a checkpoint's signature, rebuilt its root from `leaf_hashes` and opened its seed through the crypto provider once for every row the checkpoint lists. It now does each once per checkpoint per run (the hot run and the archive run are each one run) and reuses the answer for every row that checkpoint lists. With a KMS-backed provider that is one remote call per checkpoint instead of one per row. What a run decides is unchanged: a checkpoint that does not verify under a trusted signing key still refuses every row it lists, and a seed that is missing or does not open still refuses every row it sealed. A fault met while opening a checkpoint is now met once in a run and refuses every row that checkpoint lists; re-running the command tries it again.

**The sealer.** A `late` checkpoint now re-reads its window's checkpoints once the chain's head is known, and leaves out every row a checkpoint stored in between already lists, so a row another sealer sealed while this pass ran is not listed by a second checkpoint. When a checkpoint insert is rejected and the read-back finds another checkpoint at that sequence, the seed the sealer just sealed can never be stored, so its `sys_secret` row is removed instead of being left for `os secret orphans`. A rejected insert with no row read back still keeps its seed, as before.

`@objectstack/spec`: a source comment on the `plugin-audit` group of the platform object names now says that the package registers `sys_audit_amendment` too. No name, type or value changes.
