---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth,platform-objects): an organization's require-MFA refusal reads in the caller's language, an accepted save that turns it on names the grace period in force, and the field help says two-factor must be on (#30411)

Clause-②: no
Metadata-protocol: none

- **Before.** Saving `sys_organization.require_mfa` on while two-factor enrollment was off was refused with an English sentence, whatever language the administrator's console used. An accepted save that turned it on answered nothing about when members would be blocked, and the configured grace period (`auth.mfa_grace_period_days`) was readable only through the `auth` settings, which need `manage_platform_settings`, a capability an organization administrator does not hold. The field help did not say the requirement needs two-factor on.
- **Now.** The refusal is in the request's language (English, Simplified Chinese, Japanese, Spanish; matched from `Accept-Language` exactly, then by language, else English), with the same shape as before: `400 VALIDATION_FAILED`, one `require_mfa` / `invalid_value` field entry carrying the same sentence as the top-level message. A save that is admitted and turns the requirement on (two-factor on, the stored value off, or an insert) answers a save `notice` on the create or update answer, in the same language: every member without an authenticator app must enroll, within the grace period in force, in days, read per write from the same setting the MFA gate's clock holds to. A save that turns nothing on (clearing it, re-saving a stored `true`, writing other columns) answers no notice. The field help, in all four languages, says the requirement needs two-factor authentication on for the deployment (`OS_AUTH_TWO_FACTOR=true`) and that saving it on is refused while it is off.
- **Unchanged.** Which writes are refused and which are admitted, the refusal's code, status and field entry, the MFA gate and its grace clock, and every `auth` setting and its read permission. No member is added to any answer: `notice` is the create and update answers' existing optional member.
