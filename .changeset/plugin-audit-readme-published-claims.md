---
"@objectstack/plugin-audit": patch
---

docs(plugin-audit): the published README stops documenting an `auditService` API, a row shape and an action vocabulary that do not exist (#9517)

<!-- adr-0087: not-required (no-migration-prescription) Documentation only. No
authorable property is added, renamed, retired or tombstoned; no schema, type or
runtime behaviour changes. The only edited artifact is the package README, which
ships in the package's `files` array. -->

`packages/plugins/plugin-audit/README.md` is in the package's published `files`
array and `private` is unset, so it is **what the npm package page renders**. It
documented an API surface with no implementation anywhere in the repo, under a
banner claiming SOC 2 / HIPAA / GDPR readiness.

**Measured against `origin/main` before anything was rewritten**, and the drift
was wider than the ledger of it:

- **Every `auditService.*` method the README called is absent from the repo** —
  `getFailedActions`, `logAdminAction`, `logDataAccess`, and also
  `getRecordHistory`, `getUserActivity`, `searchLogs`, `getRecordSnapshot`,
  `generateReport`, `archiveLogs`, `purgeLogs`, `logDataDeletion`,
  `logDataExport`. Twelve methods, zero implementations. A reader following the
  README wrote code that could not compile.
- **`PluginAudit` does not exist**, and neither does the `.configure({...})`
  static it was called through — no class in this repo exposes one. The export is
  `AuditPlugin`, a `Plugin` class registered as `kernel.use(new AuditPlugin())`
  and taking **no configuration at all**. The documented config object
  (`trackObjects`, `trackFields`, `retentionDays`, `autoArchive`, `excludeUsers`,
  `trackSystemEvents`) was fabricated in full.
- **`IAuditService` is not in `@objectstack/spec/contracts`** — the README's
  "Contract Implementation" section named an interface the spec has never
  declared.
- **The row shape was not the shipped one.** The README declared `timestamp`,
  `userName`, `userEmail`, `recordName`, `changes`, `sessionId`, `status` and
  `errorMessage`. `sys_audit_log` declares none of them.
- **The action values were outside the enum.** `'insert'`, `'auth:login'`,
  `'security:password_reset'`, `'workflow:approval'` and `'user_role_change'` are
  not forms this object accepts; the namespaced-colon spelling never was one.
- **The object name was wrong** — `audit_log`, not `sys_audit_log`.
- **The REST namespace does not exist.** Six `/api/v1/audit/*` routes were
  documented; the object declares `apiMethods: ['get', 'list']` and is read over
  the ordinary object API.

The compliance paragraph is **deleted, not softened or relocated**: a
regulatory-readiness claim is a company-level statement needing an accountable
owner, and it does not belong in a package README. The three external
SOC 2 / GDPR / HIPAA links that existed only to support that framing are gone
with it.

The replacement documents only what the code can be pointed at: the real exports;
the real `sys_audit_log` columns; the seven-value action enum **with the writer
for each value**, so a reader can check any row of it; the credential masking on
`old_value` / `new_value`; and the coverage model, which is
**all objects minus an exclusion list** rather than the fabricated per-object
`trackObjects` config — subtraction, because the object universe is open and an
enumerated allow list would silently stop auditing everything registered after
boot.

Three things are now stated that the old README obscured, all of them gaps a
reader could otherwise mistake for coverage:

- **reads and views are not on the ledger** — no writer emits a read action;
- **failed operations are not on the ledger** — there is no success/failure
  column, and the writers fire only on `after*` events, i.e. only on operations
  that succeeded, so `getFailedActions`-style "security monitoring" had no
  mechanism behind it in the first place;
- **`ip_address` / `user_agent` are populated on auth events only** — the
  record-level writer does not stamp them, so a null client fingerprint on a CRUD
  row does not mean the request had none.

Two dependency boundaries are **named with their degraded behaviour** rather than
left silent, following the `access-recipes.mdx` pattern: hierarchy-relative
permission scopes need `@objectstack/security-enterprise` and **fail closed to
`own`** without it, so a grant written to let managers read their reports' audit
rows shows them only their own on an open build; and `lifecycle.archive` needs a
registered `archive` datasource, **failing closed to retention** without one —
nothing is ever deleted and the table grows, which is the safe direction for a
ledger but not the documented one.
