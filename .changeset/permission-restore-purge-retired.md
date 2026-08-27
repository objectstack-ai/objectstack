---
"@objectstack/spec": minor
"@objectstack/plugin-security": patch
---

feat(spec): retire the `allowRestore` / `allowPurge` object-permission bits — declared gates on operations that do not exist (#12497, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).
Maintainer ruling 2026-08-26 (decision-inbox batch 5) accepting #1883's
recommendation B; **the keys return with the M2 lifecycle initiative** (feature
+ RBAC in one batch) — anchor card #1883 stays open.

`allowRestore` and `allowPurge` claimed to gate `restore` (undelete) and
`purge` (hard-delete / GDPR erase) ObjectQL operations that have never
existed: no destructive lifecycle verb is in the engine's dispatch vocabulary
(pinned by objectql's `engine-middleware-operation-vocabulary.test.ts`, #8106).
Authoring the bits granted nothing — and in the `allowPurge: false` direction
the failure was ADR-0049's worst false-compliance shape: an admin believed a
lock on permanent deletion existed when the operation itself did not. The
sibling `allowTransfer` is **enforced** (#3004, the insert/update `owner_id`
door) and is untouched.

**What is refused:** authoring either key, with any value — both are
`retiredKey()` tombstones (`ObjectPermissionSchema` is reachable from the
`permission` metadata root, so the tombstone route keeps the removal audible:
a tsc `never` on the input type plus a parse-time prescription). The former
`restore` / `purge` bare-verb aliases now answer with the same prescription
instead of a rename onto a tombstone. The tombstone rides the `.extend()`
clone into `EffectiveObjectPermissionSchema`, so the response-side def carries
the same `[RETIRED]` rows.

**What stays accepted:** every other object-permission bit parses
byte-identically (`allow*` CRUD, `allowExport`, `allowTransfer`,
`viewAllRecords`, `modifyAllRecords`, `readScope` / `writeScope`).

**Runtime (plugin-security):** the evaluator's pre-mapping rows
(`OPERATION_TO_PERMISSION` restore→allowRestore / purge→allowPurge) retired in
the same batch — with the bits unwritable, a mapping onto them was a claim
about a surface that rejects authoring. Behaviour is deny-before and
deny-after: a dispatched `restore` / `purge` is refused fail-closed by the
`DESTRUCTIVE_OPERATIONS` backstop, now unconditionally (not even
`modifyAllRecords` reaches an unmapped destructive op — the bypass re-covers
them only when the M2 batch re-adds the rows). `transfer` keeps its row and
its bypass. `describeHighPrivilegeBits` stopped reading `allowPurge` (a legacy
stored value grants nothing, so flagging it guarded nothing real); the
delete/purge/transfer class message is unchanged.

The retirement kit:

- `retiredKey()` tombstones + former-alias `guidance` prescriptions at the
  schema (`packages/spec/src/security/permission.zod.ts`)
- ADR-0087 registration: retired-key entries
  `security/ObjectPermission:allowRestore` / `:allowPurge` (and the
  `security/EffectiveObjectPermission` pair for the cloned rows) and the D2
  conversion `permission-allow-restore-purge-removed` (protocol 18), wired
  into the step-18 chain — `os migrate meta --from 17` strips the keys from
  every object grant in `permissions[].objects` (pure lossless delete; they
  never had an effect to lose)
- liveness ledger: both entries flipped to `dead` with the retiredKey evidence
  (entries stay — the tombstone keeps the keys in the walked shape, the
  `rls.priority` precedent)
- pin tests (`permission.test.ts` — refusal pins asserting the prescription;
  `security-plugin.test.ts` — fail-closed pins incl. the legacy-stored-grant
  and modifyAllRecords directions; `audience-anchors.test.ts` — the predicate
  no longer reads the retired bit)
- generated baselines/docs follow the schema (`authorable-surface/`,
  `authorable-defaults/`, spec-changes, upgrade guide, reference docs)

## FROM → TO

```ts
// before — parsed green; nothing ever read the bits, no operation existed
definePermissionSet({
  name: 'support_agent',
  objects: {
    crm_ticket: {
      allowRead: true, allowEdit: true,
      allowRestore: true,   // claimed: can undelete — nothing enforced it
      allowPurge: false,    // claimed: GDPR erase locked — no lock existed
    },
  },
});

// after — delete the keys; restore/purge dispatches are denied fail-closed
// until the M2 lifecycle batch ships the operations WITH their RBAC bits
definePermissionSet({
  name: 'support_agent',
  objects: {
    crm_ticket: { allowRead: true, allowEdit: true },
  },
});
```

<!-- adr-0087: registered permission-allow-restore-purge-removed -->
