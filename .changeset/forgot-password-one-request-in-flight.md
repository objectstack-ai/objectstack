---
'@object-ui/auth': patch
---

fix(auth): the forgot-password form sends one reset request at a time

Clause-②: no
Metadata-protocol: none

- **`@object-ui/auth`:** `ForgotPasswordForm` ignores a submit while its reset request is pending, so a fast double or triple click on "Send reset link" sends one `POST /request-password-reset`, not one per click. The button shows its submitting label and, like the email field, is disabled until the request answers; a request that fails (a 429 included) releases the form, so the next submit is sent. Before, the form's only guard was the provider's `isLoading`, which tracks the session read and was never raised for this call. The phone (SMS code) branch is unchanged.
