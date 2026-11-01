---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(platform-objects): Setup Create User marks Email required while phone sign-in is off

Clause-②: no
Metadata-protocol: none

Create User refuses a blank email while phone sign-in is off (the default), and takes an email or a phone number while it is on. The dialog now shows that before submit: with phone sign-in off, Email carries the required mark and a blank one is refused in the dialog; with it on, Email stays optional beside Phone Number.

- **The declaration.** A param's `required` is a static boolean, so `sys_user.create_user` declares two params on the one `email` field. First an optional one with `requiresFeature: 'phoneNumber'`, then a required one with `visible: 'has(features.phoneNumber) && features.phoneNumber != true'`. The console collects and submits only the param whose gate says yes, so exactly one Email input shows. While the console holds no served flag (config not fetched, or the fetch failed), the `has()` term keeps the required param hidden and Email stays optional, as it was.
- **The registry.** `PUBLIC_AUTH_FEATURES.phoneNumber.gatedInputs` books `sys_user.actions.create_user.params.email`. That one path stands for both Email params: the feature-gate guard checks the canonical gate on the first, optional param, and the required param's negated gate is pinned by its own test.
- **Unchanged.** The endpoint's own refusal of a blank email, and the dialog's marks for a refusal the server names per field.
