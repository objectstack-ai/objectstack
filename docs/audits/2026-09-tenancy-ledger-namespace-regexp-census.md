# Tenancy ledger vs. namespace regexp — the #14096 census

**Date:** 2026-09-04 · **Base:** `origin/main` `35e94c96b` · **Scope:** measurement only —
ships nothing, changes no shipped package's behaviour, touches no row already on disk.
This is step 1 of the director-seat ruling on #14096 (总监批 #25, 2026-09-01, maintainer
verbatim 「同意」, issue comment
[5494594783](https://github.com/objectstack-ai/objectstack/issues/14096#issuecomment-5494594783)).

> **The ruling, verbatim:**
>
> 1. **普查先行(派发的第一交付物,纯测量零裁决)**:读 `PLATFORM_OBJECT_TENANCY` 台账,
>    对每个键跑 `/^(sys_|cloud_|ai_)/`,量出**台账与正则判得不同的对象数**;
> 2. **零** ⇒ **A**:两条 seed 路径维持正则,把「维持现状」记录为被选择的决定 —— 两个
>    正则站点各加一行注记引用本裁决(满足 #13491 执行点 3「不做也是必须写下的决定」),
>    卡关 completed,归档级降 p3;
> 3. **非零** ⇒ ⛔ 停手,带对象清单回决策箱改判 p1 —— 那时这不是形式分歧,是两个写者
>    对活数据不同意;B/C 届时上桌,且与 **#13636**(分类体系第三态)**联裁**:⛔ 不在
>    分类体系可能要改的当口扩散它;
> 4. **C 的反向判例入册**:#8686 自己的姿态「已铸出的只报告、从不重写」—— 同车道既有
>    裁定不支持对存量行的重写,C 即便届时也需独立强理由;
> 5. Clause-②:普查与注记均 no;若走到 B/C 再按 diff 复判。

---

## Answer in one line

**The count is 8, not 0.** The ledger (`PLATFORM_OBJECT_TENANCY`, the runtime write path's
source of truth) judges 8 platform-namespace objects `tenant-scoped` — in scope, an
organization is derived or the write is refused — while both seed paths' namespace regexp
(`/^(sys_|cloud_|ai_)/`) judges every one of those same 8 objects `global` — out of scope,
stays org-less. **Per ruling item 3, this STOPS here: nothing is implemented.** The object
list goes back to the decision box, re-graded p1, jointly with #13636 (confirmed still
open, `pm:awaiting-maintainer`, its implementation PR #14923 closed unmerged on the
maintainer's own instruction — so this lands beside a card already in the maintainer's
hands, not merely returns to an empty one). **This is a correct outcome of the census, not
a failure of it.**

---

## 1. The predicate (stated per dispatch Zone 2.1)

Two verdicts are being compared, and they need a common binary before "differ" means
anything:

- **The ledger's verdict**, `classifyPlatformObjectTenancy(name)`
  (`packages/objectql/src/tenancy/platform-object-tenancy.ts`), answers one of three
  states: `tenant-scoped`, `global`, or `unclassified`.
- **The regexp's verdict.** Read at both sites that still use it (§3 below), `/^(sys_|
  cloud_|ai_)/` is applied as a **uniform** rule: every name it matches is treated as
  staying global/cross-tenant — no seed-load fallback organization, no backfill adoption.
  So for every object IN this census's population (every registered platform-namespace
  object — the population is defined BY the regexp match, see §2), the regexp's verdict is
  the same single answer: **out of scope**.

**The honest mapping onto that binary:** `tenant-scoped` → *in scope* (disagrees with the
regexp's uniform *out of scope*); `global` **and** `unclassified` → *out of scope* (both
agree with the regexp). This is not a simplification chosen for convenience — it is what
the ledger's own file documents `unclassified` as: "keeps TODAY'S behaviour exactly (the
object stays outside the machinery, as the blanket guard had it)", i.e. the same runtime
outcome as `global`. So **a disagreement is exactly a ledger entry classified
`tenant-scoped`** — nothing about the `global`/`unclassified` split changes which
population disagrees, since both map to the same binary answer the regexp already gives
every one of them.

This also means the answer does not depend on whether an unclassified object happens to
carry a real tenant column (the trap in §4) — an unclassified object agrees with the
regexp regardless, by the ledger's own declared policy, not by this census's choice.

---

## 2. The population, and the positive control (dispatch Zone 2.3)

**Method:** an AST-lite census of every `ObjectSchema.create(` call under `packages/`
(excluding tests and the `migrations/registry.ts` / `migrations/entries/` prose files,
which only *mention* the call in comments), filtered to a literal `name: '...'` matching
`/^(sys_|cloud_|ai_)/`. Comments and string contents are blanked before paren-depth
matching — a first pass without that step undercounted by 2
(`sys_oauth_client_resource`, `sys_oauth_resource`), both because a doc comment shaped like
`(255, 768]` desyncs a naive bracket scan; see the script's own header comment for detail).
Script: `scripts/audits/14096-tenancy-ledger-namespace-regexp-census.mjs`.

**Result: 84 registered platform-namespace objects** — all `sys_`-prefixed; zero `cloud_`
or `ai_` object schemas exist in this repository (the ledger's own comment explains why:
the five `cloud_`-runtime objects live in the separate `cloud` repo, which this tree cannot
read, and the `ai_` domain's spec types are metadata types, not `sys_`-style data objects).

**Positive control** (`platform-object-tenancy.ts:32-37`, independently re-derived this
week and confirmed correct): *"84 platform-namespace objects are registered … 25 resolve
NO tenant field (24 `managedBy: 'better-auth'`, plus `sys_sso_provider`'s `tenancy.enabled:
false`) … 59 carry a tenant column."* Reproducing "does this object resolve a tenant
field" requires replicating `resolveTenantFieldName`'s real precedence
(`system-write-organization.ts`), not a `managedBy` heuristic — this census's script does,
and got it wrong once before matching: a first draft treated `tenancy.enabled: false` the
same as the `managedBy` skip (i.e. overridable by a self-declared field) and undercounted
by one (`sys_sso_provider` declares its own `organization_id` field, but
`resolveTenantFieldName` checks `tenancy.enabled === false` FIRST and returns `null`
**unconditionally**, before ever consulting `fields`). The header-reproduction check caught
this — exactly the discipline Zone 2.3 asks for ("if your own reading cannot reproduce the
header's numbers, your instrument is wrong, not the header") — and the fix is left as a
comment in the script rather than quietly folded away.

```json
{
  "reproduced": { "total": 84, "no_tenant_field": 25, "has_tenant_field": 59 },
  "reproduced_matches_header": true
}
```

**Control: PASSES.** The instrument reproduces the header exactly; its other outputs can be
trusted.

---

## 3. Re-deriving the three cut sites (dispatch Zone 2.5)

The dispatch card measured these at `dda969cd71`; `origin/main` has moved to `35e94c96b`
since (`dda969cd71` confirmed an ancestor of the current HEAD via `git merge-base
--is-ancestor`). All three still exist and still cut exactly as described:

| Site | File:line | What it does |
|---|---|---|
| **Runtime write path** | `packages/objectql/src/engine.ts:3744` (`isTenantAuditInScope`, the tenant-audit mute) and `:3963` (inside `resolveSystemInsertOrganization`, called from the insert path at `:9934`) | Both call `isPlatformObjectOutOfTenantAuditScope(object)`, which reads the **hand-adjudicated ledger** — per-object, not by namespace. |
| **`seed-loader.ts`** | `:311` declares `fallbackOrgId`; `:926` applies it: `(/^(sys_\|cloud_\|ai_)/.test(objectName) ? undefined : this.fallbackOrgId)` | A platform-namespace seed row **never** takes the single-org fallback — regardless of whether the object is tenant-scoped, global, or unclassified in the ledger. |
| **`seed-tenancy-backfill.ts`** | `:587` declares its own `PLATFORM_NAMESPACE = /^(sys_\|cloud_\|ai_)/`; `:1251` applies it: `.filter((r) => !PLATFORM_NAMESPACE.test(String(r.object)))` | A platform-namespace object's counter-split rows are **excluded** from adoption into an organization — same uniform rule. |

`scripts/audits/14096-tenancy-ledger-namespace-regexp-census.mjs`'s `confirmSeedSitesCutByRegexp()`
re-derives this mechanically (regex-matches the exact expressions above against the current
file contents) rather than trusting the table:

```json
"seed_sites_still_cut_by_regexp": { "seedLoaderCuts": true, "backfillDeclares": true, "backfillFilters": true }
```

All three sites are unchanged in shape from the card's description. The measurement wins if
any of this had moved; none of it had.

---

## 4. The trap this census does not fall into (dispatch Zone 2.2)

`resolveTenantFieldName` never reads `managedBy`. Three better-auth-managed objects declare
their own `organization_id` field and resolve a real tenant column despite the
`managedBy: 'better-auth'` label:

```json
"trap_check": [
  { "name": "sys_member",     "resolvesTenantField": true, "ledgerVerdict": "unclassified" },
  { "name": "sys_team",       "resolvesTenantField": true, "ledgerVerdict": "unclassified" },
  { "name": "sys_invitation", "resolvesTenantField": true, "ledgerVerdict": "unclassified" }
]
```

None of the three is a **disagreement** for this census's question, though — none is in
the ledger at all (all three are `unclassified`), and `unclassified` maps to the same "out
of scope" binary answer as `global` (§1). The trap matters for §2's control (getting
"which objects carry a tenant column" right), not for the disagreement count itself.

---

## 5. The disagreement — 8 objects, named (dispatch Zone 2.4)

Computed from the real, built module (`classifyPlatformObjectTenancy`, imported from
`@objectstack/objectql`'s public entry — not re-transcribed by hand), cross-checked against
the ledger's own pinned test (`tenancy-by-object-classification.test.ts`'s
`tenantScopedPlatformObjects()` assertion), which lists the identical 8 names.

| # | Object | Ledger's verdict | Regexp's verdict | Which write path(s) diverge from the runtime path **today** |
|---|---|---|---|---|
| 1 | `sys_file` | `tenant-scoped` — writer repaired (#12745), maintainer-ordered backfill 2026-08-28 | global (stays org-less) | **Both** seed-loader and seed-tenancy-backfill |
| 2 | `sys_upload_session` | `tenant-scoped` — `StorageMetadataStore` stamps `organization_id` on insert + update (#12928/#13178), forward-stamp-only | global | **Both** |
| 3 | `sys_approval_request` | `tenant-scoped` — writer repaired (#10101/PR #11311), backfilled 2026-08-23 | global | **Both** |
| 4 | `sys_approval_action` | `tenant-scoped` — child row of `sys_approval_request`, same order | global | **Both** |
| 5 | `sys_approval_approver` | `tenant-scoped` — child row, same order | global | **Both** |
| 6 | `sys_automation_run` | `tenant-scoped` — `ObjectStoreSuspendedRunStore` resolves + stamps organization | global | **Both** |
| 7 | `sys_notification_delivery` | `tenant-scoped` — `SqlOutbox.enqueue` stamps from the derived notification organization (#11698) | global | **Both** |
| 8 | `sys_record_share` | `tenant-scoped` — writer repaired, backfilled 2026-09-02, `SharingService.grant` (#14484) | global | **Both** |

Every one of the 8 diverges from **both** seed paths identically, because both paths cut
by the exact same regexp (§3) — there is no case here where only one of the two seed sites
disagrees with the runtime path while the other agrees.

`sys_permission_set` — the ledger's ninth entry, `global` — is **not** a disagreement: its
verdict already matches the regexp's uniform "stays global" answer, which is exactly why
#8672 named it as the case the old blanket exemption got right.

```json
{
  "ledger_entry_count": 9,
  "disagreement_count": 8,
  "disagreements": [
    "sys_approval_action", "sys_approval_approver", "sys_approval_request",
    "sys_automation_run", "sys_file", "sys_notification_delivery",
    "sys_record_share", "sys_upload_session"
  ]
}
```

---

## 6. Branch verdict

**Non-zero (8) ⇒ ruling item 3: STOP.** No option is implemented — not A, not B, not C.
Per the ruling: *"这不是形式分歧,是两个写者对活数据不同意"* ("this is not a formal
disagreement — it is two writers disagreeing about live data"). Concretely: for all 8
objects, a system-context write on a `single`-posture install today **derives** and stamps
the real organization at the runtime layer (or is **refused** on a walled posture), while a
seed replay or a tenancy-backfill run on the very same objects still treats them as
deliberately org-less. `sys_file` (repaired #12745) and `sys_record_share` (repaired
#14484, backfilled 2026-09-02) are the sharpest instances: the runtime write path was
specifically repaired because an org-less row on each was a measured defect, yet the seed
paths' rule for the identical objects has not moved.

**This card returns to the decision box, re-graded p1**, and — per ruling item 3 — **not
alone**: #13636 (the third tenancy state the batch-#9 re-ruling cannot express) is
confirmed still open, labeled `pm:awaiting-maintainer` and `priority:p1`, its
implementation PR **#14923 closed unmerged** on the maintainer's own instruction earlier
this week. So this census's non-zero result does not merely return #14096 to an empty
decision box — it lands beside a card already sitting in the maintainer's hands, which the
ruling itself flags as raising the stakes rather than lowering them. Options B and C stay
off the table until then, and per ruling item 4, C also carries an independent, unmet
burden: #8686's own posture — "already-minted rows are reported, never rewritten" — is a
counter-precedent on the same lane, not a null result.

**Nothing on disk was touched.** No seed path was edited, no annotation was added (ruling
item 2's annotations are conditioned on a **zero** result), no row was rewritten or
backfilled. This document and its companion script are the entire diff.

---

## Clause-② and changeset

**Clause-②: no**, per ruling item 5 (census + non-zero-stop carries no annotation either).
Re-derived against the actual diff: this PR adds one markdown file and one `.mjs` script
under `scripts/audits/` — no exported symbol, no published payload key, nothing shipped.
**`skip-changeset`**: a stop-at-non-zero outcome with no code change is explicitly the
"publishes nothing" case the dispatch names for this label.

---

## Commands to re-run this census

```bash
# Build the dependency closure the script imports from (dist, not src):
pnpm --filter '@objectstack/objectql^...' build && pnpm --filter @objectstack/objectql build

# The whole census, in one command — prints the full JSON report to stdout
# and a human-readable summary to stderr; exits 0 (measurement, not a gate):
node scripts/audits/14096-tenancy-ledger-namespace-regexp-census.mjs
```
