---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': minor
---

feat(spec): a field group's `requiresFeature` hides the group where a deployment feature is off; Edit organization hides Parent Organization and Sort Order on a single-organization deployment

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/references/examples-objects.md (its Field Groups section teaches `fieldGroups` and should name `visibleWhen` and `requiresFeature` beside `collapse`); kept out of this diff so it does not become a governed (`skills/**`) change

On a deployment that runs one organization, Edit organization showed Parent Organization and Sort Order, two fields that order and group organizations against each other and so do nothing there. They are now hidden wherever the deployment does not run several organizations.

- **`@objectstack/spec`: `fieldGroups[].requiresFeature`.** A field group can name a deployment feature flag, from the same set an action's `requiresFeature` names (`PUBLIC_AUTH_FEATURES`), and a flag outside it is refused at parse. It is lowered at parse into the group's `visibleWhen`, exactly as the action key is lowered into `visible`, and the key is stripped from the output: `{ key: 'group_structure', label: 'Group Structure', requiresFeature: 'multiOrgEnabled' }` parses to a group whose `visibleWhen` is `features.multiOrgEnabled != false`. Beside an authored `visibleWhen` the two are AND-composed, the author's predicate first: `visibleWhen: "record.kind == 'child'"` gives `(record.kind == 'child') && features.multiOrgEnabled != false`. The form and the record page already evaluate a group's `visibleWhen` with the host's `features` in scope, so the gate holds on both. Like every group predicate it is presentation only: the fields stay readable and writable through the API. `lowerRequiresFeature` takes an optional third argument, the slot it lowers into (`'visible'`, the default, or `'visibleWhen'`), and its refusals name that slot. `PUBLIC_AUTH_FEATURES` books `sys_organization.fieldGroups.group_structure` under `multiOrgEnabled`; a `gatedInputs` path may now name a field group as `OBJECT.fieldGroups.KEY`.
- **`@objectstack/lint`: the lowered gate is accepted.** A field group's `visibleWhen` keeps its root verdict (it binds `record`, `previous` and `parent`), except for the one trailing gate a `requiresFeature` lowers to, which `os validate`, `os build` and the object save door now accept. Any other `features` read in a group predicate is refused as before, and the message now points at `requiresFeature`.
- **`@objectstack/platform-objects`: `sys_organization` declares its field groups.** Identity, Branding, Configuration and Group Structure, in the fields' own order, so every field keeps its place; `id`, `created_at` and `updated_at` stay ungrouped and last, as before. Group Structure (Parent Organization, Sort Order) carries `requiresFeature: 'multiOrgEnabled'`. The two fields' help, which says they matter only with several organizations, is unchanged.
