---
'@objectstack/plugin-security': minor
---

feat(plugin-security): under a walled posture, the deployment-level acceptance of package defaults can be host configuration (`acceptedDefaultPermissionSets`, ADR-0131 D5) (#23385)

Clause-②: yes (widening)

**What was wrong.** On a walled (`group` / `isolated`) deployment with several organizations and none of slug `default`, the audience-binding suggestion record has no organization to own it. Every boot logged `[security] audience-binding suggestion sync failed (non-fatal)`, and the accept door answered `409 SUGGESTION_STATE` with the remedy "create the Default Organization (slug 'default')". That is a reserved organization for deployment-level rows, the shape ADR-0131 §1.5 rejects.

**What is new.** `SecurityPluginOptions.acceptedDefaultPermissionSets?: readonly string[]` is read only under a walled posture. When it is declared, possibly as `[]`:

- the `everyone` anchor derives from the baseline plus the declared sets. Each name passes the same checks an accepted suggestion does: the security catalog serves it under some package, it declares `isDefault: true`, and it carries no bit the `everyone` anchor forbids (ADR-0090 D7). A name that fails a check grants nothing and is reported, at `error` for a forbidden bit;
- the `sys_audience_binding_suggestion` record is neither read nor written, so the boot no longer warns. Existing rows are counted once and reported, not deleted;
- the record's list, accept and dismiss doors answer `409 SUGGESTION_STATE` naming the option.

```ts
new SecurityPlugin({ acceptedDefaultPermissionSets: [] });              // nothing beyond the baseline
new SecurityPlugin({ acceptedDefaultPermissionSets: ['crm_readonly'] }); // every member also holds crm_readonly
```

A walled deployment that declares nothing keeps today's behaviour. When it has no organization to own the record, the refusal now names `acceptedDefaultPermissionSets` instead of "create the Default Organization".

**Refused loudly.** A value that is not a list of non-empty names is refused at construction. A declaration under the `single` posture is refused at `start()`: there the record owned by the Default Organization is the acceptance. The `single` posture is otherwise unchanged, including its refusal text.

**Exported for callers of the module's functions.** `readAcceptedEveryoneSets`, `syncAudienceBindingSuggestions` and `reconcileAudienceBindingSuggestions` take an optional trailing `DeploymentAcceptance` (`{ posture, acceptedDefaultPermissionSets }`), and `SuggestionDeps` gains `acceptedDefaultPermissionSets`. Omitted, they read the record as before. `WithheldAcceptance` gains `source: 'record' | 'host-configuration'`.
