---
title: "Tour · Security"
description: Guided tour of the security domain — positions, permission sets, scope depth, VAMA, audience anchors, sharing rules, delegated administration, and the access-matrix gate.
---

# Guided tour — Security

The showcase ships the complete ADR-0090 permission model. The whole model in
four sentences: a user's **capability** is the *union* of every **permission
set** they hold; **positions** decide who holds which sets; the
**business-unit tree** and manager chain decide *how deep* a grant sees; each
object's **OWD** (`sharingModel`) sets the record baseline — **sharing** only
widens it, **RLS** only narrows it.

Everything lives under `src/security/` (positions, permission sets, sharing
rules), `src/data/objects/` (per-object OWD), and `src/data/seed/` (the
`sys_business_unit` org tree).

## Capability — permission sets

`showcase_contributor` layers object CRUD + field-level security (budget
fields read-only) + row-level security (own tasks/invoices only, plus an
ADR-0058 D4 write-time `check`):

```metadata
type: permission
name: showcase_contributor
```

The other sets each demonstrate one axis:

- `showcase_manager` — **scope depth** (ADR-0057 D1) with read/write
  asymmetry: org-wide read over inquiries, edit own only (`readScope:
  'org'`, `writeScope: 'own'`). The intermediate hierarchy depths
  (`own_and_reports`/`unit`/`unit_and_below`) are enterprise
  (`hierarchy-security`); the open edition demonstrates BU-shaped visibility
  via the sharing rule below instead.
- `showcase_executive` — org-wide read via `readScope: 'org'` (depth, not a
  bypass).
- `showcase_auditor` — **View-All** (`viewAllRecords`): reads every private
  record, holds no write bit. High-privilege: the publish linter blocks it
  from `everyone`/`guest` bindings.
- `showcase_ops` — **system permissions** (`setup.access` opens the Setup
  app for non-admins — apps declaring `requiredPermissions` appear in
  `/me/apps` only when the caller's union carries them) and **Modify-All**
  on announcements (a `public_read` object, so the bypass matters).
- `showcase_member_default` — `isDefault: true`, the **`everyone`
  suggestion** (ADR-0090 D5): the read-mostly baseline every authenticated
  member holds *additively* (no fallback cliff).
- `showcase_guest_portal` — guest-safe capability (read announcements,
  create inquiries) for the built-in **`guest`** position (ADR-0090 D9);
  binding it is an admin action in Setup.
- `showcase_field_ops_delegate` — **delegated administration**
  (ADR-0090 D12): an `adminScope` bounded to the Field Operations subtree
  with an assignable-set allowlist; no self-escalation.

## Record baseline — OWD, internal and external

Every object declares its `sharingModel` explicitly (the unset state no
longer exists — ADR-0090 D1). The showcase covers all four canonical values:
`showcase_private_note` (`private`), `showcase_announcement` (`public_read`),
most demo objects (`public_read_write`), and `showcase_invoice_line`
(`controlled_by_parent`). Two objects also declare the **external dial**
(`externalSharingModel`, ADR-0090 D11): announcements are `private` to
portal users; accounts are `public_read`.

## Widening — sharing rules

Criteria rules compile their CEL condition to an enforced filter and
materialize `sys_record_share` grants (ADR-0058 D3). Recipients demonstrate
both enforced kinds: `position` (red projects → execs; compound-condition
high-value red projects → managers) and `unit_and_subordinates`
(new inquiries → the Field Operations **business-unit subtree**). The
owner-based rule is kept as an authoring-shape example only — it is skipped
at seed time (`[experimental]`, ADR-0049: nothing silently over-shares).

## The org tree

`src/data/seed/` seeds real `sys_business_unit` rows (Acme → Field
Operations → West/East Coast; HQ Finance) with explicit ids so metadata can
reference them. Browse it in Setup → Access Control → Business Units
(org-chart view). User↔unit membership and position assignments are runtime
admin actions — users sign up, they are not seeded.

## The gate — access matrix

`access-matrix.json` next to `objectstack.config.ts` is the ADR-0090 D6
snapshot: `objectstack compile` derives the (permission set × object) matrix
from the declarations above and **fails the build on drift** with a semantic
diff ("`showcase_auditor` gains delete on `showcase_invoice`") until the
snapshot is regenerated with `--update-access-matrix`. The snapshot's git
diff is the review artifact. The same build runs the ADR-0090 D7 security
posture linter (unset OWD, retired aliases, external-wider-than-internal,
wildcard VAMA, high-privilege anchor suggestions, forbidden vocabulary).

## See it enforced

Log in as a non-admin member (create one in Setup → Users): the Field Zoo's
permission-gated fields mask, private notes vanish, and write attempts
outside your row scope are rejected — while a user assigned the `auditor`
position reads everything and the Setup app appears for `ops` holders.
Ask "why" with the explain engine — the `security`
service's `explain({ object, operation, userId })` reports every layer's
verdict with contributor attribution, walking the same code the middleware
enforces with.

This is the last stop — back to the [overview](./showcase_index.md), or
jump to the [Data tour](./showcase_tour_data.md) to start again.
