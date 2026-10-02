---
'@objectstack/metadata-protocol': patch
---

Withdrawing or publishing a public form on a walled tenancy posture (degraded or not) is now refused loudly at authoring, with `403 NOT_OVERRIDABLE`, when the save is organization-scoped and the anonymous form doors cannot honour it. The message names the remedy: save the change env-wide, which every anonymous door honours. Drafts and draft promotion are refused alike. Other organization-scoped edits, env-wide saves and single-posture deployments are unchanged.
