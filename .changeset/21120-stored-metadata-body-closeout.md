---
'@objectstack/metadata-protocol': minor
'@objectstack/service-analytics': minor
'@objectstack/plugin-audit': minor
'@objectstack/objectql': minor
---

fix(security)!: stored metadata bodies are projected or refused at the audit, analytics, realtime and data-door filter/sort exits too

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) further read/copy/evaluate exits for a stored metadata body (sys_metadata / sys_metadata_history), each routed through the one shared redactor or refused: the audit/activity write-time copy is projected, a data-door filter or sort on the body column is refused (the sibling of the already-registered-as-not-required groupBy refusal), an analytics query member on the body column is refused, and a data.record.* realtime event body is projected. No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer; the published surfaces gain and lose nothing. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a filter/sort target, an analytics member or an event body (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what three doors accept or serve for the two stored-metadata tables — the generic data door refuses a filter or sort on the body column, the analytics door refuses it as a dimension / measure / filter / sort member, and the realtime event and the audit/activity copy now carry the body as its type's read projection instead of the stored bytes. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What changes.**

- **Audit / activity copy (`@objectstack/plugin-audit`).** The audit writer copies a `sys_metadata` / `sys_metadata_history` row into `sys_audit_log.new_value` / `old_value` and `sys_activity.metadata`. That copy now projects the body through the shared redactor, so stored credential material is withheld from the second store too. A new `os migrate audit-metadata-bodies` command rewrites the copies already at rest (dry run by default, `--apply` to write, idempotent).
- **Analytics (`@objectstack/service-analytics`).** A query naming the stored body column of these objects as a dimension, measure, filter or sort is refused with `400 INVALID_FIELD`, before any strategy runs — the posture analytics already takes for a member it will not evaluate.
- **Realtime (`@objectstack/objectql`).** A `data.record.*` event projects its `after` / `changes` body through the same redactor, so a subscriber to these objects' events receives no stored credential.
- **Data door filter / sort (`@objectstack/metadata-protocol`).** A filter or sort on the body column is refused with `400 INVALID_FIELD`, the same family and shape as the existing groupBy refusal.

**What stays answerable.** Every scalar column of these objects — `type`, `name`, `scope`, `state`, timestamps — is still grouped, filtered, sorted, counted and served; only the body column is affected. Every other object is unchanged.
