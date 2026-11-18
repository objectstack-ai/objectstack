---
'@objectstack/scenarios': patch
---

fix(scenarios): a skill-evals arm directory is always made under the system temp directory

Clause-②: no
Metadata-protocol: none

`skill-evals` made each turn's directory under a base its caller could pass, defaulting to the system temp directory. Every turn of a round already used that default; only the package's own tests passed a scratch base. The base is now spelled at the call, `join(tmpdir(), 'skill-eval-')`, so the repository's scratch-directory scan can read where it lands, and the internal `base` argument is gone. A round behaves exactly as before.
