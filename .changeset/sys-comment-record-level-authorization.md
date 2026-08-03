---
"@objectstack/plugin-audit": major
"@objectstack/rest": patch
---

fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

Attachments derive their visibility from the parent record; comments derived
nothing. On the *same* record, with the *same* user, the two answered
differently:

```
user: rep2 (does NOT own and cannot read the opportunity)
GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                   → 200, 1 row
POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
```

`sys_comment` is public, has no owner column, and hides its parent inside a
string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
every object in every app carried that org-wide readable, org-wide writable
side-channel — a deployment that carefully authored OWD, sharing rules and RLS
on its records still leaked their discussion.

`AuditPlugin` now installs the same two-part kit `service-storage` installs for
`sys_attachment`, keyed off `thread_id`'s parent:

- **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
  query with the threads whose record the caller can actually read (resolved
  through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
  decide). `count()` is filtered identically to `find()`, so a list `total`
  cannot leak the hidden rows' existence either.
- **write** — `beforeInsert` requires READ on the record the thread names;
  `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
  or to hold EDIT on that record. `author_id` is server-stamped from the
  session, so a client-supplied value never wins.

Everything fails CLOSED: a `thread_id` that names no record — the dangling
`"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
itself — is refused on write and excluded on read, and a filter that cannot be
computed denies all rather than falling open. Refusals answer **403
`RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
permission condition takes a catalogued code rather than a new synonym), with
`error.object` naming the record's object.

**Breaking for deployments that depended on the gap.** Reads that used to
return other people's comments now return fewer rows (or none), and writes that
used to 201 now 403. Specifically:

- Listing `sys_comment` without being able to read the parent record → the row
  is gone, not merely unlabelled. Panels that render a thread must be reached by
  a principal who can read the record.
- Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
  usable at all: creating one is refused, and existing rows become invisible to
  everyone but system context. Migrate free-form threads to a real record
  reference (or keep them under a system-context surface).
- Deleting or editing another user's comment now requires EDIT on the record.
  Note also that `sys_comment` delete already needed a permission set carrying
  `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
- Posting a comment no longer requires the client to send `author_id` (it is
  stamped); a client that sends someone else's is silently corrected rather than
  believed.

Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
an object has comments at all, and anonymous callers are still refused with 401
before any of this runs.
