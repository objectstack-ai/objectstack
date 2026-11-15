---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime,service-automation)!: the flow doors and the connector address judge the served holders of a name two packages hold, so a disabled holder's slot answers no bare name (ADR-0150 D3, #33386)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are door and run reads under a reversible package state: no stored row, slot key, run key or dispatch key changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of a flow or connector name that two packages hold while one of them is disabled. A disabled package holds no name (ADR-0150 D3). Until now the `/automation` by-name doors, the flow action and endpoint, the start admission's record-read walk and the engine's bare entries still counted a disabled holder for such a name. They now count only the packages that serve it. With no holder disabled, every answer is unchanged. Measured over a real `SchemaRegistry` (its `disablePackage`), in both registration orders. Packages CRM and HR each hold the flow `convert` and the connector `mail`, one engine slot or instance each, and CRM is disabled:

- A bare name with no package (`POST /automation/convert/trigger`, `GET /automation/convert`, the run doors, `GET /automation/connectors/mail/connection`, the engine's `execute`, `getFlow` and `toggleFlow`) was refused 409 naming CRM and HR. It is now served from HR's slot or instance.
- A flow action, a subflow call or a walk read from a package whose closure holds both was refused 409 naming both. It now reaches HR's flow (widening).
- CRM's own flow action, or a subflow call from CRM's own flow, ran CRM's flow. It now gets no flow (not found), and never HR's.
- A package that reaches the name only through CRM ran CRM's flow. It is now refused 409 `outside-closure` naming HR. A package that reaches neither holder is refused naming HR only (before: both).
- An address naming CRM (`/automation/crm/convert/…`, `/automation/trigger/crm/convert`) ran CRM's slot. It is now refused 409 `not-held-by-qualifier` naming HR. `/automation/connectors/crm/mail/connection` reached the service, which answered 404; it is now refused 409 naming HR, and the service is not asked.
- `_env` or another namespace (`/automation/_env/convert/…`, `/automation/connectors/ops/mail/connection`) was refused 409 naming both. It is now refused naming HR only.
- The definition writes (`PUT`, `DELETE`, clone) at an address naming CRM, at `_env` or at a third namespace were refused 409 naming both. They are now refused 409 naming HR only. With both disabled, such a write at an address answers 404.
- With CRM and HR both disabled, no door and no run reaches a flow. An address answers 404. The bare name and `_env` answer as for a flow the engine does not hold.

**Not moved.** HR's own address and HR's own callers answer as before. The durable coordinates stay judged over every holder, served or not: the engine's slot keys, a run's key, the schedule dispatch key (`flowDispatchHolder`), the credential channel's scoping, the subflow guards' arming verdicts, and which slot a run row is filed under. A disable is reversible, so it re-points no slot. A run filed under CRM's slot key is no served holder's: the run doors answer it as a run nobody holds, and it is never read or acted on as HR's. A definition write (`PUT`, `DELETE`, clone) at HR's own address keeps its 409 naming every holder; a bare definition write is refused by the metadata store over its stored rows, as before. A name only one package holds is judged as before.

**Deferred:** amendment 3's trigger binding (a runtime-disabled holder's trigger still fires its slot, as on main) → #33748.

**No migration.** No schema key, stored row, slot key, run key or dispatch key changes, so there is nothing to rewrite: the answers that move follow a reversible package state.

The fix for a caller: re-enable the package, or address the served holder by its namespace.
