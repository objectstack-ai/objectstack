---
'@object-ui/auth': patch
---

feat(auth,app-shell): the create-organization dialog draws the host's organization-create choices and sends the picked edition

Clause-②: no
Metadata-protocol: none

- **`@object-ui/auth`:** `AuthPublicConfig.features` declares `organizationEditions`, typed from `@objectstack/spec`'s `OrganizationEditionChoice` (`edition`, `label`, `hint`, `memberLimit`). `createOrganization`'s `edition` takes the `edition` value of any served choice (`string`), not only `developer`; it still rides the `edition` query parameter, and an absent value still sends none.
- **Console (`CreateWorkspaceDialog`):** where `/auth/config` serves `features.organizationEditions`, the dialog draws one choice per entry under the name, with the host's label and hint as given. Every choice starts unchecked and at most one is picked; the picked choice's `edition` goes with the create call and is kept when a taken slug is retried. With the list absent or empty, or nothing picked, the dialog and its create call are unchanged.
