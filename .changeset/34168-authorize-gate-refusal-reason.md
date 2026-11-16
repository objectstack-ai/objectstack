---
'@objectstack/plugin-auth': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(plugin-auth): the environment-access refusal can carry the host's reason and sentence to the sign-in page, and the sign-in page names the application on a hand-off

Clause-②: yes (widening)
Metadata-protocol: none

`AuthManagerOptions.oidcAuthorizeGate` (the ADR-0069 D5.1 environment-access gate) may now answer `{ allowed: false, reason, message }` in place of `false`: a reason code from the host's own closed set and the sentence the refused person reads. The refusal then carries both:

- the `403` envelope keeps `code: ENV_ACCESS_DENIED`, gains `reason`, and its `message` is the host's sentence;
- the redirect back to a registered `redirect_uri` keeps `error=access_denied`, sends the host's sentence as `error_description`, and adds `objectstack_error_reason` (RFC 6749 §8.2 asks an unregistered parameter to carry a vendor prefix);
- the readable refusal page shows the host's sentence, HTML-escaped, beside the signed-in account.

Nothing the host answers is trusted as markup or as a URL fragment. A reason outside `[a-z_]{1,40}` is dropped and the refusal stands. A sentence with a control character or an angle bracket, or longer than 300 characters, is replaced by the fixed sentence. On the redirect, a sentence outside the character set RFC 6749 §4.1.2.1 allows for `error_description` (printable ASCII without `"` and `\`) is also replaced by the fixed sentence.

On the environment, the OAuth callback for the platform identity provider keeps a valid `objectstack_error_reason` on its redirect to the Console sign-in page. The sign-in page shows its own sentence for `not_member` and `invitation_pending` (in every Console language); any other reason, or none, keeps the existing `access_denied` sentence. The organization's name is carried only inside the host's sentence.

The sign-in page reads the client name only for the client its signed request names: on an OAuth hand-off it asks the new `GET /api/v1/auth/oauth2/client-name` and says "Sign in to continue to NAME". Any other answer keeps the host line ("Continue to HOST").

Unchanged: a gate that answers a boolean is answered byte for byte as before on all three doors; who is admitted (an object refuses only when it says `allowed: false`; any other answer keeps the truthiness the gate was always read with); which `redirect_uri` is followed.

Upgrade note: a host may return the refusal object only once it runs this plugin-auth release or later. An older plugin-auth reads any object as an admission.
