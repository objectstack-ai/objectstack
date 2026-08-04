---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): a deleted record kills its share links — resolve fails closed, and the delete cascades (#5190)

`ShareLinkService.resolveToken` checked the token, `revoked_at`, `expires_at`,
the audience and the password — **but never whether the record the link points
at still exists**. Nothing revoked links on delete either: #5103's cascade
covers `sys_record_share` only. So a share link outlived its record, kept
resolving, and kept stamping `use_count` / `last_used_at`.

That is worse than the `sys_record_share` orphan #5103 fixed, and for a
structural reason: a share row names its beneficiaries, while a share link is an
identity-less **capability token** — holding the URL *is* the authorisation. The
moment a record id is reused (custom primary keys, an import that preserves ids,
any future id recycling) a link that morally died with its record starts
authorising a brand-new record, for whoever kept it.

Both halves of the fix ship together, and the first does not depend on the
second having run:

- **`resolveToken` re-asks whether the record exists**, and returns `null`
  through the *same* branch as revoked / expired — no distinct code, no distinct
  error, nothing an unauthorised holder can read "that record was deleted" out
  of. The probe sits after the cheap in-memory gates (a revoked link still costs
  no query) and *before* the usage stamp, so a dead record no longer ticks
  `use_count` / `last_used_at`. It fails **closed**: a probe that throws denies,
  because "cannot ask" must not authorise.
- **Record deletes now cascade to `sys_share_link`**, on #5103's existing seam
  rather than a parallel one — the same global `beforeDelete` row-set stash, the
  same `afterDelete` set-based revoke, the same serialized sweep queue for
  unbounded deletes, and the same `kernel:bootstrapped` orphan sweep (keyset
  pages, a scan cap that reports itself, one batched existence probe per object
  per page, and rows left strictly alone when that probe fails). The two halves
  are isolated, so a driver error reclaiming grants cannot also skip the tokens.

The link half judges posture from `publicSharing`, which is *independent* of
`sharingModel`: the object most likely to hold links is a platform object that
opted into link sharing, and that is exactly the object the record-share
predicate skips. `publicSharing` declared counts even when it is currently
`enabled: false` — links minted while it was on outlive the flip.

An orphaned link row is **deleted**, not stamped `revoked_at`: its subject is
gone, so there is no live link left to keep a revocation record of, and the
table would otherwise only grow (with Setup's link lists pointing at records
that no longer exist). Links an admin revokes keep their audit row exactly as
before.

No metadata, spec or API shape changes. Deployments see fewer rows in
`sys_share_link` after the next boot, and links whose record was already deleted
stop resolving immediately — which is the point.
