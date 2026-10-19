---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/service-settings': patch
---

Clause-②: no

Refusals and Setup help text that a user reads inside the running system no longer call that system
"this environment". They say "this system", or they drop the noun.

- `@objectstack/plugin-auth`: the two self-registration refusals drop the noun ("Self-registration is
  closed (audience posture invite_only).", "Self-registration is limited to approved email domains, …").
  So do the OAuth self-service `503` ("OIDC provider is not enabled") and the SSO `400`
  `DOMAIN_VERIFICATION_DISABLED` ("Domain verification is not enabled (set
  OS_SSO_DOMAIN_VERIFICATION)."). The last-administrator guard's refusals and its two warning lines say
  "this system", including "nobody able to administer the system". The OIDC authorize-gate refusal
  (`403 ENV_ACCESS_DENIED`) keeps "this environment". Only the cloud control plane installs that gate,
  and there the noun names the environment a cloud user is signing in to.
- `@objectstack/plugin-security`: the diagnostic `message` of the packaged-permission-set lock now reads
  "… is declared by package '…' and is locked — editing it here would …". The provenance-unknown
  refusal says "this system could not determine …". Both `userMessage` texts are unchanged.
- `@objectstack/service-settings`: the Mail and SMS provider groups read "Choose how this system sends
  outbound email." and "… outbound SMS.". The Authentication audience group reads "Who may become a user
  of this system's apps.". The zh-CN, ja-JP and es-ES bundles change only the noun, to 本系统,
  このシステム and este sistema.

Only the human-readable text moves. Every HTTP status, error code, settings key and response shape
stays as it was.
