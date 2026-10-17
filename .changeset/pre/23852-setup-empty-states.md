---
'@objectstack/platform-objects': patch
'@objectstack/service-messaging': patch
---

Setup's Invitations, API Keys, OAuth Applications and Notification Preferences, Subscriptions and Templates lists say what belongs on them when they are empty, and API Keys gains a Create Key button (#23852)

Clause-②: no

**What an admin saw.** An empty Invitations, API Keys or OAuth Applications list read "No identity records — these records are created by the authentication provider … not added by hand here", which is false for all three. The three notification lists read the generic "Nothing here yet". API Keys had no way to create a key at all.

**What changes.**

- Every list view of `sys_invitation`, `sys_api_key` and `sys_oauth_application` declares its own `emptyState` (a title and one sentence), and a filtered view names itself: Invitations opens on "No pending invitations", the Revoked keys view reads "No revoked keys".
- `sys_notification_preference`, `sys_notification_subscription` and `sys_notification_template` each ship one list view, `all`, declared only for its `emptyState`: it sets no columns (`columns: []`, so the grid keeps the columns it derived before), no filter, no sort and no page size.
- `sys_api_key` gains `create_api_key` ("Create Key"), a primary list-toolbar action on every API Keys list, Setup's and the Account app's. It calls the existing `POST /api/v1/keys` route with the name you give it; the key is created for you, in the organization you are working in, and the raw key is shown once in a dialog you close after copying it. Nothing about the route changes, and the data API still does not create keys.
- The new copy ships in `en`, `zh-CN`, `ja-JP` and `es-ES`.

Unchanged: every field, index, permission and the `revoke_api_key` / `restore_api_key` row actions.
