---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an invitation mail sent outside a better-auth endpoint still carries the mailbox proof

Clause-②: no
Metadata-protocol: none

A host that calls the organization plugin's `sendInvitationEmail` from its own code, outside any better-auth endpoint, now sends the same mail the console's invite sends: its link carries the invitation's mailbox proof, so the invitee can use the one-step acceptance from it. The proof is minted through the auth manager's own context when no endpoint context exists. Nothing else changes: the proof is still delivered only in the mail and never stored in clear, and a send inside an endpoint mints exactly as before.
