---
'@object-ui/core': patch
---

fix(core): the action key inventory lists the spec's `disabledReason`, so an action carrying it is no longer reported as having an unknown key

Clause-②: no
Metadata-protocol: none

`@objectstack/spec`'s `ActionSchema` declares `disabledReason`, the display-only sentence a greyed action shows to say why. `SPEC_ACTION_KEYS` in `@object-ui/core`, which restates every key that schema declares, did not list it, so the dev-mode unknown-key warning named it on a spec-valid action and the inventory's pin test failed. The entry is added. `ActionDef` is unchanged and nothing in the runner reads the key: its readers ship with the console's disabled-reason work.
