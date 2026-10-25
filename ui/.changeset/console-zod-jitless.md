---
'@object-ui/console': patch
---

The Console document sets zod's `jitless` before any module runs, so zod no longer probes for `eval` at boot (objectui#13511). Under a content-security-policy that refuses `eval` (the ObjectStack server's policy whenever `kind: 'react'` pages are off), that probe was refused and reported once per load; nothing broke, but each load filed a false violation report. zod now uses its interpreter on every deployment, whatever the policy.

Clause-②: no
Metadata-protocol: none
