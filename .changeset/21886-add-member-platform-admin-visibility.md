---
"@objectstack/platform-objects": patch
---

"Add Member" is offered only to a platform administrator, the one standing its endpoint admits.

Clause-②: no

- `sys_member`'s `add_member` toolbar action now declares `visible: 'current_user.isPlatformAdmin == true'`. `requiresFeature: 'organization'` composes onto it at parse time, so the served predicate reads `(current_user.isPlatformAdmin == true) && features.organization != false`.
- Its endpoint, `POST /api/v1/auth/organization/add-member`, has always admitted a platform administrator alone (ADR-0068) and answered every other caller, org owners and admins included, with 403 `PERMISSION_DENIED`. Before this change the button was still shown to every member of the organization.
- ⛔ Nothing you author changes. The endpoint and the callers it admits are unchanged, and no key, export or parameter is added. The action's label is unchanged.
