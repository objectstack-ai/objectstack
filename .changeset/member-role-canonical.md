---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): canonicalise `sys_member.role` at the write, so an org admin can no longer remove an owner (#8317)

**Security — authorization inversion.** A membership stored with a non-canonical
role — `Owner`, `' owner'`, `OWNER` — was an **owner** to every ObjectStack-side
check and a **plain member** to better-auth.

better-auth `1.7.0-rc.2` reads that column with a raw `role.split(",")`, with no
`trim()` and no `toLowerCase()`, in three branches of
`dist/plugins/organization/routes/crud-members.mjs`: `removeMember`'s "only an
owner may remove an owner", `updateMemberRole`'s creator protection, and
`organization/leave`'s last-owner count. ObjectStack's own readers all trim and
lower-case (the #5942 grade ladder, `mapMembershipRole`). So on such a row the
vendor never entered its owner branch at all and fell through to
`hasPermission({ member: ['delete'] })` — **which an org admin passes**. An org
admin could remove, demote, or count out an owner that every ObjectStack check
treated as an owner.

Not reachable through the ordinary invite/accept path (better-auth's own writes
are canonical). Reachable through anything else that writes the column: an
operator SQL fix-up, a data import, a SCIM group mapping, a script.

**The fix normalises at the write**, so the disagreement is unrepresentable
rather than adjudicated per reader:

- ObjectQL `beforeInsert` / `beforeUpdate` hooks on `sys_member` canonicalise
  `role` on every write path, in every context (system and better-auth adapter
  writes included — those are the paths this exists for). They run at priority
  5, ahead of the ADR-0092 identity write guard and the ADR-0024 D5.2
  break-glass guard, so both judge the value's normal form.
- A **one-off convergent pass runs at boot** and canonicalises rows that already
  exist. It is idempotent, safe to re-run, and logs a census of every distinct
  non-canonical spelling it found with row counts.

Canonicalisation is per token: a token that is a membership role (ADR-0108's
closed vocabulary) is trimmed and lower-cased; any other token is preserved
verbatim apart from trimming, because `mapMembershipRole` passes an unknown
value through with its case and it becomes a position name a permission set may
be bound to. A value carrying no known role at all is left completely untouched
and only reported — it cannot produce the inversion.

No API, schema or configuration change: `sys_member.role`'s option list is
unchanged, and canonicalisation never moves a membership's grade, so no
membership gains or loses authority as a result of this fix.
