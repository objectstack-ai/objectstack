---
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(app-shell,console): the invitation inbox's accept routes an unverified address to verification, and the verify screen no longer says a link was sent before it was

Clause-②: no
Metadata-protocol: none

Follow-ups to the rule that, while a deployment delivers mail, accepting an invitation needs a verified address (`403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`).

- **The invitation inbox's Accept** (`@object-ui/app-shell`). When the `sys_invitation` `accept_invitation` action is refused with that code, the console's `type: 'api'` action handlers (`useConsoleActionRuntime` and `RecordDetailView`, through the action door or the direct call alike) now open the verification-mail screen, `/verify-email-prompt`, for the account's address, with the mail's link returning to that invitation's accept page, instead of showing the vendor's sentence in a toast. Every other refusal still reads as before. The rule is keyed on the code alone; no action metadata key, spec field or server route changes.
- **The action's AI description** (`@objectstack/platform-objects`). `sys_invitation.accept_invitation`'s `ai.description` now states the condition: while the deployment delivers email, the caller's address must be verified, and an unverified caller is refused with that code and nothing is written. The text is the agent-facing description only; no translated bundle carries it.
- **The verify screen's copy** (`@object-ui/console`, `@object-ui/i18n`). `/verify-email-prompt` said "We sent a verification link" on every arrival, but only the sign-up sends a mail before arriving there. The sign-in arrival (refused `EMAIL_NOT_VERIFIED`, which sends nothing unless the deployment sets `emailVerification.sendOnSignIn`) and both accept-invitation arrivals send nothing. The sign-up arrival now marks itself with `?sent=1` and keeps its copy; every other arrival reads "Your email address has not been verified yet. Send a verification link to ADDRESS…", offers "Send verification email", and shows "Sent to:" and the spam hint only once the button has sent the mail. Two keys are added to the `auth.verifyEmail` namespace in every built-in locale: `sendDescription` and `sendButton`.

**A host that embeds the accept page or the console action runtime declares `/verify-email-prompt`.** `DefaultAcceptInvitationPage` and the action handlers above navigate there with `email` and `redirect` query keys; `apps/console` mounts its own `VerifyEmailPromptPage` at that route, and a host without it sends the person to a route that does not exist. The `@object-ui/app-shell` README states the route and its query keys ("Hosting the invitation pages").
