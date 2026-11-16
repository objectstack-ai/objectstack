---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): the environment-access refusal at `/oauth2/authorize` can carry the host's reason and sentence

Clause-②: yes (widening). The gate seam also takes a reason object, the refusal gains a reason field and a namespaced redirect parameter, the prelogin read is turned on, and new i18n keys are added. A boolean gate answers byte for byte as today. The dev measures this again before the PR.
Metadata-protocol: none

`AuthManagerOptions.oidcAuthorizeGate` (the ADR-0069 D5.1 environment-access gate) may now answer `{ allowed: false, reason, message }` in place of `false`: a reason code from the host's own closed set and the sentence the refused person reads. The refusal then carries both:

- the `403` envelope keeps `code: ENV_ACCESS_DENIED`, gains `reason`, and its `message` is the host's sentence;
- the redirect back to a registered `redirect_uri` keeps `error=access_denied`, sends the host's sentence as `error_description`, and adds `objectstack_error_reason` (RFC 6749 §8.2 asks an unregistered parameter to carry a vendor prefix);
- the readable refusal page shows the host's sentence, HTML-escaped, beside the signed-in account.

Nothing the host answers is trusted as markup or as a URL fragment. A reason outside `[a-z_]{1,40}` is dropped and the refusal stands. A sentence with a control character or an angle bracket, or longer than 300 characters, is replaced by the fixed sentence. On the redirect, a sentence outside the character set RFC 6749 §4.1.2.1 allows for `error_description` (printable ASCII without `"` and `\`) is also replaced by the fixed sentence.

Unchanged: a gate that answers a boolean is answered byte for byte as before on all three doors; who is admitted (an object refuses only when it says `allowed: false`; any other answer keeps the truthiness the gate was always read with); which `redirect_uri` is followed.

Not in this release: the environment's sign-in page does not read `objectstack_error_reason` yet, and the sign-in page's hand-off line still names the relying party's host.
