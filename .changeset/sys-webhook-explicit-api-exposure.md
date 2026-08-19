---
"@objectstack/plugin-webhooks": patch
---

chore(plugin-webhooks): `sys_webhook` declares its data-API exposure explicitly — recording the posture, not narrowing it (#9756)

`sys_webhook` shipped with no `enable` block at all, so it kept the full default
data API. Three cards each noticed and each named the narrowing as the next
step — #7799 (the signing secret), #7986 (the custom headers), #8025 option 2
(the URL) — and each assumed a later one would write the line. None did, and the
last of them closed `completed` with the line still unwritten. The posture was
never a judgement; it was a default nobody had written down.

It is written down now:

```ts
enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] }
```

**The effective surface is unchanged, and that is the honest headline.** The set
is derived from a census of who actually reaches the object, taken before
anything was edited:

| consumer | reaches it through | needs |
|:---|:---|:---|
| Setup/Studio console — `nav_webhooks`, four list views, `userActions` create/edit/delete | REST `/api/v1/data/sys_webhook` (gated) | `get` `list` `create` `update` `delete` |
| Operator predicate write — "deactivate every webhook on an object" (#4639) | REST `updateMany`/`deleteMany` (gated on `bulk`) | `bulk` |
| `AutoEnqueuer`, `bootstrapDeclaredWebhooks`, the provenance stamp, `redeliver-guard`, the secret sweep | `engine.*` and lifecycle hooks — ObjectQL directly, which never consults `enable.apiMethods` | ungated |

Every primitive is required by a real consumer, so the set is all six — whose
operation closure is what the absent block already produced. Nothing that was
reachable becomes unreachable, and `/me/permissions` reports the identical
`apiOperations` array. No caller needs to change anything.

⛔ **Do not read this as the read-surface narrowing those three cards asked
for.** It is not one, and `apiMethods` cannot be one here: `url` (#8025 —
won't-fix on masking, because the URL is the routing key an operator must be
able to see, search, sort and edit) and a legacy row's un-migrated
`definition_json.headers` (#7986 — still read, and warned about, by
`readLegacyHeaders`) are served by `get`/`list`, which is exactly what the admin
console requires. Any set that removes them removes the admin surface too. The
sibling `sys_http_delivery` can hold `['get','list']` because it is engine-owned
and never authored; `sys_webhook` is a first-class admin authoring surface.

The equality above is pinned in `sys-webhook-api-exposure.test.ts` rather than
left as a claim, so a later change that does move the surface has to say so.
