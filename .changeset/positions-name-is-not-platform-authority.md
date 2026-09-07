---
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-security": patch
"@objectstack/runtime": patch
---

Four server-side authorization sites stop deriving platform-operator authority from a NAME in `ExecutionContext.positions`, and read the ADR-0095 posture rung instead.

`positions[]` is the security axis, so it carries ADR-0057 D4 `sys_user_position` names alongside the built-ins. `sys_user_position` is `apiEnabled` and its `position` values are unconstrained, so a tenant could mint a row spelling `platform_admin` for one of their own users: `resolveUserAuthzGrants` pushed that name straight onto `grants.positions`, while `grants.posture` — derived from the unscoped `admin_full_access` grant and nothing else — correctly stayed `MEMBER`. Every reader of the name therefore answered `true` for a principal enforcement treats as an ordinary member. `resolve-authz-context.ts` states the rule at `hasPlatformAdminStanding` ("read the RUNG — never `positions.includes(...)`"), but a comment is not a gate and these four had not followed it.

Each site now tests `posture === 'PLATFORM_ADMIN'`, byte-for-byte what `hasPlatformAdminStanding` returns:

- **`plugin-sharing`** — `hasPlatformAuthority`. The minted row satisfied `assertResolvableAdminScope`, so an org-less caller holding only the ORG-scoped `manage_sharing` capability was answered with **every tenant's** sharing rules, and could delete platform-global rules. The `manage_platform_settings` capability spelling is unchanged.
- **`plugin-approvals`** — `isOverrideActor`. This predicate already read the rung and then ORed the name onto it, which is no protection: an OR is only as strong as its weakest arm. Because the platform arm deliberately crosses the tenant wall, the minted row let a member of one organization approve, reject or recall a **different organization's** pending request while holding no slot in its slate. The `ADMIN_FULL_ACCESS` capability arm and both TENANT_ADMIN arms are unchanged.
- **`runtime`** — the ADR-0126 §5 activation gate. Under a `group` or `isolated` posture this gate is the only thing between a tenant org admin and the **install-wide** `sys_metadata_activation` row, so the minted row reopened #10243 with a durable row behind it.
- **`plugin-security`** — `derivePosture` in the explain engine. Narrower than the other three, and stated precisely rather than overclaimed: the name-read sat behind an early `ctx.posture` return that `buildContextForUser` always populates, so the shipping path was already gated and a D4 row never moved it. What the read did reach was a posture-less hand-built context, where it made the panel **report** `PLATFORM_ADMIN` for a principal enforcement treats as a MEMBER — a misreport rather than an admission, but in the one tool an administrator opens to check exactly this.

No behaviour changes for a genuine platform operator: their resolved context carries the rung, and the built-in position is still projected onto `positions[]` for display and predicate use. What changes is that the name alone no longer answers the authorization question.

Graded `patch` on the surface it moves: no exported type, signature or contract changes, and no authorable metadata is added, removed or renamed. The only observable difference is that a principal who never held the capability grant stops being admitted — which is the defect, not a feature anyone could have depended on.
