---
'@objectstack/metadata-protocol': patch
---

An organization-scoped save that changes which public forms accept anonymous intake is now refused (`403 NOT_OVERRIDABLE`) when the anonymous form doors never read that organization, as on a walled tenancy posture (degraded or not), where an anonymous request resolves no organization. The message names the reason and the remedy: save the change env-wide, which withdraws or publishes the form on every anonymous door. Drafts and draft promotion are refused alike. Organization-scoped edits that leave a form's anonymous intake as the env-wide definition has it, env-wide saves, and single-posture deployments are unchanged.
