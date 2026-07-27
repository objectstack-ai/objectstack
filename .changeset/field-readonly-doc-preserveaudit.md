---
---

docs(spec): correct the `field.readonly` describe re: import exemption (#3493). It listed "import" as a system-context exemption, but a normal data import is non-system and still strips; the strip is bypassed only by `isSystem` writes (seed replay, migration) and by an opt-in "historical" import (`preserveAudit`), which admits a whitelist. Describe-string only — regenerates `references/data/field.mdx`, releases nothing.
