---
"@objectstack/plugin-security": patch
---

fix(security): the `controlled_by_parent` master-editability check consults the same app-authored write widener the by-id path does (#8679)

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface
changes: nothing is added, renamed, retired or tombstoned in `packages/spec`.
This is a behavioural fix inside one existing gate, which now asks an
already-shipped question at a second call site. -->

`crm_campaign_member`-shaped objects — ADR-0055 `controlled_by_parent` details —
route every insert/update/delete through `assertControlledByParentWrite`, which
asks whether the caller may EDIT the master. That gate's record-sharing leg
hard-refused on `canEdit === false` **without ever asking whether an app-authored
RLS update-widener admits the master row**. The by-id write path has asked
exactly that since #5493 (merged as PR #6909), where the deferral was installed
on the sharing middleware's refusal branch.

So one principal, one master record and one operation got **two different
answers depending on who was asking** — measured on 17.0.0 GA with real Bearer
tokens, one variable (who created the master), everything else identical:

| step | master created by ADMIN | master created by the caller |
|---|---|---|
| PATCH the master itself, by id | **200** | 200 |
| INSERT a child | **403** | 201 |
| UPDATE a child | **403** | 200 |
| `security/explain` update on the master, record-scoped | **`allowed=true`** | `allowed=true` |

The master write and the platform's own `explain` verdict both said yes; only the
derived write disagreed, refusing with `master '...' not editable by this user
(record sharing)` — naming the very layer #6909 had already taught to defer.

**The fix consults the same composition, and does not relax the check.** The
verdict comes from `checkAuthoredRowWrite` — the method
`SharingService.probeAuthoredRowWrite` passes straight through to — so the answer
at this call site is byte-for-byte the one a direct by-id write of that master
would get. There is no second copy to drift, which matters because a duplicated
permission composition is how the two paths diverged. The question is asked for
`update`, matching the two legs already above it: this gate's subject is edit
access to the master, never the detail's own verb.

Nothing else widens. The object-level `update` grant and the master's own
write-RLS leg run first and still refuse on their own terms; `admit` retracts
only the record-sharing leg's refusal, exactly as an `admit` on the by-id path
hands the row to the pre-image gate rather than authorizing anything. Every other
outcome — `abstain`, no authored policy, a `check`-only policy, a principal-less
or delegated context, a throwing probe — leaves the refusal untouched, and the
method is fail-closed in the `abstain` direction, so no failure mode here can
open access.

The regression proof drives both directions on one fixture and refuses to be
satisfiable by a relaxation: the RLS-widened master **permits** the derived write
**and** a principal with no widener and no share is still refused on the same
route with the same payload. A transferred master (write RLS admits via the
platform floor, record sharing refuses because the owner is someone else) keeps
the record-sharing leg itself pinned live — deleting that leg outright would
otherwise leave the suite green — with an `edit`-level share admitting the same
row and a `read`-level share still refusing it.
