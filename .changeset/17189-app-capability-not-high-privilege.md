---
'@objectstack/spec': minor
---

feat(spec): an app-declared capability token is not a platform system permission at the `everyone` anchor

`describeHighPrivilegeBits` counted **any** non-empty `systemPermissions` as a
high-privilege bit, so a permission set carrying the capability token its own
app declared could not be bound to the `everyone` audience anchor:

```
FROM  describeHighPrivilegeBits({ systemPermissions: ['clm_requester.access'] })
      -> 'system permissions'        // the app's own navigation gate, refused
TO    describeHighPrivilegeBits({ systemPermissions: ['clm_requester.access'] },
                                { declaredCapabilities: ['clm_requester.access'] })
      -> null
```

One list carries two unlike things: the platform's own powers (`manage_users`
and friends) and a capability a package **declared for itself** (ADR-0066 D1,
entering `sys_capability` with `managed_by: 'package'` + `package_id`
provenance). An app whose navigation gates on its own token therefore could not
ship the set every employee holds — the set's own gate made it unbindable — and
authors were pushed toward declaring no gates at all, the opposite of what
ADR-0066 D1 exists to encourage.

**The discriminator is provenance, not spelling.** Both predicates
(`describeHighPrivilegeBits`, `describeAnchorForbiddenBits`) take a new optional
`AnchorBindingContext` naming the capability names *this stack declared*; a
token on that list is the app's own gate and is not counted. ⛔ A naming-syntax
rule (dotted ⇒ app token) was considered and rejected: it misjudges in silence
the first dotted platform permission — `setup.access` is one today — and the
first undotted app token.

**What is still refused**, each pinned in `high-privilege.test.ts`:

- a platform capability name, **however it is declared** — a package declaring
  `manage_users` cannot launder it past the gate (the platform floor);
- any token absent from the declared list, and every token when no list is
  passed — omission gets the pre-change verdict, so the narrowing fails closed;
- a mixed set: one unexcused token still refuses the whole set;
- the `guest` tier (ADR-0090 D9), which does not honour the excusal at all —
  D5 speaks for authenticated members, and anonymous visitors are not that.

**No shipped behaviour moves in this release.** Every current caller invokes the
predicates with the old arity, and with no context the code path is identical —
so this release widens the API, not any live anchor binding. The
`@objectstack/plugin-security` boot refusal and the `@objectstack/lint`
`security-anchor-high-privilege` rule pass the declared list in a follow-up, in
the ruled order (protocol first).

ADR-0090 D5's offending-bit list is revised to match in its own governed PR
(objectstack#17814), per the ruling's 「ADR-0090 修订单独受管 PR」: the offending
bit is a `systemPermissions` entry naming a **platform** system permission.
Both halves are phase ①; ⛔ neither lands without the other following.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` ships `dist`, and
the new code reaches it — `declaredCapabilities` and `appDeclaredCapabilityNames`
each occur in 2 built files under `packages/spec/dist` after the build, with
`describeHighPrivilegeBits` itself at 2 as the positive control that ships. The
ADR half does not ship: a phrase unique to the revision note occurs in 0 built
files, and `docs/adr/**` is in no package's `files[]`.
