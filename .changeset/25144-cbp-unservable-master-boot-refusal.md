---
'@objectstack/objectql': patch
---

fix(objectql)!: a `controlled_by_parent` detail whose master the engine cannot compose a read over now refuses the boot, instead of booting and failing at read time

Clause-②: yes (narrowing)

Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A boot refusal of one deployment composition: no key of any metadata schema is added, removed, renamed or re-shaped, and `ObjectSchema.parse` accepts exactly what it accepted before, so `objectstack migrate meta` has nothing to rewrite and no tombstone is owed. Both facts the refusal reads are deployment facts (datasource mapping, a package's default datasource, lifecycle routing, the middleware registrations), and the remedy is the author's choice among three, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this composition (not already-registered); and nothing exported is removed or narrowed, one engine method is added (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a narrowing of what boots). A stack declaring a `controlled_by_parent` detail over either class of master below booted before this change. It is now refused at `kernel:bootstrapped`, before `kernel:listening` opens the socket. It ships as `patch` because no metadata protocol shape moves.

ADR-0139 D5.2 and D5.3 record two classes of master the engine composes no `ReadableIds` leaf over, and refuses by name at read time:

- **(a)** a master bound to another datasource than the detail. No driver evaluates a subquery across two datasources.
- **(b)** a master whose rows an object-scoped read middleware narrows (`registerMiddleware(fn, { object })`), for example `sys_attachment`, `sys_comment`, `sys_activity`, `sys_audit_log`, `sys_mail_message` or `sys_approval_request`. That WHERE is built at read time and is no part of the master's read scope, so a leaf over it would be wider than a read of the master.

A `controlled_by_parent` detail derives its access from its one required master (ADR-0055 §1). A detail over such a master is a declaration the runtime cannot honour, so under ADR-0049 it is no longer admitted. `ObjectQLPlugin` refuses the boot with `INVALID_METADATA` / 422, naming each detail, its master field, the master and the class, and the remedies below.

- The check is judged at `kernel:bootstrapped`, not at `kernel:ready` or `registerApp`. Several platform plugins (mailbox, audit, attachment storage) register their object-scoped read middleware from their own `kernel:ready` handler, which runs after the engine's, so only then are both facts final.
- It reuses the read path's own predicate (`hasObjectMiddleware` and the datasource binding resolution), so the boot rule and the read rule cannot drift. The read-time refusal is unchanged.
- New engine method: `ObjectQL#findUnservableControlledByParentMasters()` lists the offending details.

No producer is known to be affected. HotCRM's six `controlled_by_parent` objects all sit on one datasource over masters with no object-scoped read middleware, and no in-repo declaration has either shape.

### Remedy

Pick one, for each detail the refusal names:

- bind the detail and its master to one datasource (the same `datasource`, mapping rule or package default);
- or choose a master that no object-scoped read middleware narrows;
- or declare the detail with a sharing model other than `controlled_by_parent`, and grant its access directly.
