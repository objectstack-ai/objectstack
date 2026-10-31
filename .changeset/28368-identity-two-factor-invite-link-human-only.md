---
'@objectstack/platform-objects': patch
---

fix(platform-objects): enabling two-factor authentication and copying an invitation's accept link are human-only — an agent cannot reach them over MCP

Clause-②: no
Metadata-protocol: none

`sys_user.enable_two_factor` and `sys_two_factor.enable_two_factor` no longer declare an ADR-0011 `ai` block. Each takes the user's current password and answers a new sign-in factor (the authenticator URI and one-time backup codes), so an MCP agent no longer sees them in `list_actions` and `run_action` refuses them by name. `sys_invitation.copy_invitation_link`, which answers the invitation's accept link (a bearer credential), is assessed human-only and keeps declaring no `ai` block. A person signed in to the Console runs all three exactly as before.

ADR-0011's identity-actions addendum records the amended lists (human-only 23, exposed with confirmation 17, exposed 19: 36 `ai` blocks over 59 actions) and notes that `sys_approval_request`'s 9 actions are unassessed and human-only until assessed.
