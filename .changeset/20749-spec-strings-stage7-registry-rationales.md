---
'@objectstack/spec': patch
---

The error-code waiver reasons and the public auth-feature registry's notes no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Two registries in `@objectstack/spec` carry a written reason beside each entry. In `@objectstack/spec/api`, every `STANDARD_SYNONYM_WAIVERS` and `PROVENANCE_WAIVERS` entry records why a registered error code is kept or placed where it is. In `@objectstack/spec/kernel`, `PUBLIC_AUTH_FEATURES` records how each public auth flag is consumed. Seventeen of those reasons pointed at an issue-tracker number for the decision behind them. The number goes; where the sentence did not already say what was decided, it now does. For example:

- The five grandfathered synonyms (`CONFLICT`, `FORBIDDEN`, `INTERNAL`, `NOT_FOUND`, `UNAUTHORIZED`) say their consolidation onto the standard member is deferred until a code has a measured victim.
- The `FLOW_DISABLED` waiver says every door that dispatches a flow answers from one status table. The `TENANT_SCOPE_REQUIRED` waiver says an uninstall across every organization must be declared, never inferred from a missing one.
- The `phoneNumber` note names the fix the registry generalizes: create-user's phone field follows the opt-in phoneNumber plugin.

One reason also corrects a stale fact. The `deviceAuthorization` exemption described a known gap in objectui's `DeviceAuthPage`. That gap was closed in objectui on 2026-07-15: the page reads the flag and says device authorization is not enabled, rather than calling the device-auth endpoints. The text now says so.

Text only: no waiver's code, package, shadowed member or registration, no flag's surface, semantics or gated inputs, and no export, type, schema, order or count moves. Each reason still parses under its schema's non-empty rule. A tool that matches one of these reasons by its old text (for example by a tracker-number substring) needs the new spelling.
