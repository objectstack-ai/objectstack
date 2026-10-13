---
"@objectstack/plugin-security": minor
---

feat(plugin-security)!: accepting a package's `isDefault` suggestion takes effect for the whole deployment

Clause-②: yes (narrowing)

**BREAKING.** A package's `isDefault: true` permission set now reaches every signed-in member through ONE deployment-level acceptance, and the acceptance takes effect. Before this release a confirm wrote a `sys_position_permission_set` row that granted nothing.

- **What an accept does.** `POST /api/v1/security/suggested-bindings/:id/confirm` records the decision once for the deployment, and the security plugin derives the `everyone` anchor's definition again as the baseline plus every accepted set. The derivation also runs at boot, on uninstall and on a package-door publish. A member's reads of the package's objects change on the next request. `bindingCreated` is `true` when the definition did not name the set before.
- **Who may decide (narrowing).** All three routes now need the `manage_metadata` capability, and under a `group` or `isolated` tenancy posture the platform operator. Before this release a tenant administrator (the `*` wildcard holder) listed, confirmed and dismissed suggestions for their organization. That caller is now refused `403 PERMISSION_DENIED`. Remedy: a `manage_metadata` holder decides, once for the deployment.
- **The record is the deployment's.** `sys_audience_binding_suggestion` rows are owned by the Default Organization. A deployment with no Default Organization (several organizations, none with slug `default`) answers `409 SUGGESTION_STATE` with the remedy.
- **Rows written before this release are never promoted.** A Default Organization row a tenant administrator confirmed or dismissed is set back to `pending`, unless the baseline already names the set. A row another organization owns, or none, is not read. Boot logs a warning with the count. Such rows granted nothing before this release and grant nothing after it.
- **The high-risk gate is on the definition (ADR-0090 D7).** Accepting a set that carries a bit the `everyone` anchor forbids answers `403 PERMISSION_DENIED`. If a publish later adds such a bit to an accepted set, the derivation withholds it and logs an `error` that names the set.
- **Revoke.** `POST …/:id/dismiss` on an accepted suggestion revokes it, and `everyone` is derived again without the set. A set that only the baseline names (`confirmed`, no resolver) cannot be dismissed (`409`).
- **Only `everyone`.** A `guest`-anchor suggestion is refused `409`, because accepting it would record a grant that never takes effect.
- **The anchors stay sealed.** No caller writes `everyone`'s definition. An acceptance changes the derivation's input, and the plugin re-declares the definition. Reconciliation reads that definition and no binding row.
- **Declarations come from the security catalog.** A suggestion is offered for an `isDefault` set that the catalog serves with an owning package, which is the source the authorization resolver reads. The module no longer reads `sys_position`, `sys_permission_set` or `sys_position_permission_set`. It also no longer materializes a set.
- **New field:** `sys_audience_binding_suggestion.deployment_decision`, a boolean that is `true` when a `manage_metadata` holder resolved the row.

Exported TypeScript surface (the compiler names each caller):

- Removed: `reapOrganizationLessSuggestions`, `listSuggestionOrganizationIds` and the `SuggestionReconcileScope` type. Nothing replaces them, because the record is no longer per organization.
- `reconcileAudienceBindingSuggestions` and `syncAudienceBindingSuggestions` now take `(ql, logger)`. The metadata, scope and organization parameters are gone.
- `SuggestionReconcileOutcome` reports `unread` in place of `organizations` and `reaped`. `SuggestionSyncOutcome` gains `reopened`.
- `SuggestionDeps` drops `resolveSets` and takes `posture` and `rederiveEveryone`.
- New: `readAcceptedEveryoneSets(ql, metadata)` and the `WithheldAcceptance` type.

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-security/src/suggested-audience-bindings.ts#SuggestionDeps, packages/plugins/plugin-security/src/suggested-audience-bindings.ts#SuggestionReconcileOutcome) TypeScript service plumbing with no metadata surface; the compiler names every caller, and no stored row or authored key changes shape (the new object field defaults to false) -->
