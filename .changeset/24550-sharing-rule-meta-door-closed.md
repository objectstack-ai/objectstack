---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/plugin-sharing': minor
'@objectstack/platform-objects': patch
---

feat(spec,metadata-protocol)!: the `/meta` door no longer authors sharing rules — `sharing_rule` is a code-only metadata type; Setup lists declared sharing rules

Clause-②: yes (narrowing)

<!-- adr-0087: registered sharing-rule-runtime-create-withdrawn -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D6, regime C).

A sharing rule has two sources: a package declares it (the stack's `sharingRules`, switched off through the activation ledger), or an organization authors its own (`sys_sharing_rule`). A runtime metadata item was a third, and it bypassed the same-name guard and the organization wall. The narrowings, FROM → TO:

- `PUT /api/v1/meta/sharing_rule/:name`, with a name nothing declares, in publish or `?mode=draft` — FROM `200`, with an environment-wide item stored and served by `GET /api/v1/sharing/rules`, TO `403 NOT_CREATABLE`, nothing stored. With a declared rule's name — TO `403 NOT_OVERRIDABLE`.
- `GET /api/v1/meta/types` — FROM `sharing_rule` advertised `allowRuntimeCreate: true`, TO `allowRuntimeCreate: false` and `allowEnvironmentOverlay: false`.

**The fix:** author an organization rule, or clone the declared one. `POST /api/v1/sharing/rules` (Setup > Sharing Rules) creates an organization rule. To customize a declared rule, copy it to an organization rule under a new name, then switch the declared one off with `POST /api/v1/security/_activation/sharing_rule/:name`, body `{ "enabled": false }`. A package declares its rules in the stack's `sharingRules`, as before. An item stored through the old door is still served until you remove it with `DELETE /api/v1/meta/sharing_rule/:name`. On an environment kernel, removing it needs `OS_METADATA_WRITABLE=sharing_rule`. That hatch is an explicit operator opt-in, not an authoring route: as for any code-only type, it reopens every write on the type, including creates of new names, and a sharing rule grants access. Unset it after the removal.

Also in this change:

- **`@objectstack/spec`.** `MetadataTypeSchema` (so the `MetadataType` union) and `DEFAULT_METADATA_TYPE_REGISTRY` gain `sharing_rule`. Its schema binding (`SharingRuleSchema`) moves from the non-kind collections into the kind map. `META_URL_TO_SINGULAR` gains the `sharing_rules` spelling, so `/api/v1/meta/sharing_rules` now folds to `sharing_rule`; before, that plural was not a recognised spelling.
- **`@objectstack/metadata-protocol`.** The refusal names the two sanctioned paths, not a source glob. `sharing_rule` gains its ADR-0126 Regime C row (clone, and the ledger switch).
- **`@objectstack/plugin-sharing`.** Setup's Access Control group gains **Declared Sharing Rules** (`nav_declared_sharing_rules`). It opens `/apps/setup/metadata/sharing_rule?scope=environment` beside **Sharing Rules**, which lists the organization's own rules.
- **`@objectstack/platform-objects`.** That entry's label, in `en`, `zh-CN`, `ja-JP` and `es-ES`.
