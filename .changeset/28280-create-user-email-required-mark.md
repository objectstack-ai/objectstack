---
'@objectstack/platform-objects': patch
'@objectstack/spec': minor
---

fix(platform-objects): Setup Create User marks Email required while phone sign-in is off

Clause-②: yes (widening)
Metadata-protocol: semantic

Create User refuses a blank email while phone sign-in is off (the default), and takes an email or a phone number while it is on. The dialog now shows that before submit: with phone sign-in off, Email carries the required mark and a blank one is refused in the dialog; with it on, Email stays optional beside Phone Number.

- **The declaration.** A param's `required` is a static boolean, so `sys_user.create_user` declares two params on the one `email` field. First an optional one with `requiresFeature: 'phoneNumber'`, then a required one with `visible: 'has(features.phoneNumber) && features.phoneNumber != true'`. The console collects and submits only the param whose gate says yes, so exactly one Email input shows. While the console holds no served flag (config not fetched, or the fetch failed), the `has()` term keeps the required param hidden and Email shows unmarked, as before.
- **The action doors (the semantic change).** `validateActionParams` (`@objectstack/spec/ui`), which the REST action route and the MCP `run_action` bridge run before the handler, used to key params by name with the LAST declaration winning. A name declared more than once is now required only when EVERY declaration of it is required, and its value shape is the FIRST declaration's. Without this the REST door refused a phone-only Create User with `400 VALIDATION_ERROR` "Action param \"email\" is required". The door reads no `visible` or `features`, so the endpoint stays the judge: Create User still answers a blank email with phone sign-in off with its own `400` "Email is required". No other action in this repository, its examples or hotcrm declares a param name twice, so nothing else changes meaning.
- **The registry.** `PUBLIC_AUTH_FEATURES.phoneNumber.gatedInputs` books `sys_user.actions.create_user.params.email`. That one path stands for both Email params: the feature-gate guard checks the canonical gate on the first, optional param, and the second, required param is negatively gated, as the row's notes say.
- **Unchanged.** The endpoint's own refusal of a blank email, and the dialog's marks for a refusal the server names per field.
