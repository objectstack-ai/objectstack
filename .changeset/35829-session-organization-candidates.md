---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a host's session-creation organization choice can fall back when that organization's access policy would refuse the sign-in

Clause-②: yes
Metadata-protocol: none

A host's `session.create.before` hook (`AuthManagerOptions.databaseHooks`) chooses the organization a new session is scoped to, and the framework then refuses the sign-in (`IP_NOT_ALLOWED`, 403) when that organization's own allowed IP ranges do not admit the request. The hook can now return an ordered list of fallbacks beside `data`:

```ts
import type { SessionCreateBeforeResult } from '@objectstack/plugin-auth';

databaseHooks: {
  session: {
    create: {
      before: async (session): Promise<SessionCreateBeforeResult> => ({
        data: { ...session, activeOrganizationId: lastUsedOrgId },
        activeOrganizationCandidates: [ownedOrgId, oldestOrgId],
      }),
    },
  },
},
```

The session is scoped to the first organization, `data.activeOrganizationId` first and then the list in order, that the organization's scoping admits. Each one is judged exactly as the single choice is: the same client address the server established for the request, the same organization policy, the same tenant-level administrator exemption. When no candidate is admitted, the sign-in is refused as before, and the `login_failed` audit row names the host's first choice. The list never reaches the stored session.

Nothing changes for a host that returns no list or an empty one. A value that is not an array of non-empty organization ids is a host error and fails the session creation with a `TypeError`. The new public export is the type `SessionCreateBeforeResult`.
