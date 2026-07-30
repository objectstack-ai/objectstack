---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

fix(data): reject unknown list query parameters instead of reading them as zero-matching field filters (#4134)

`GET /api/v1/data/:object` reads any parameter it does not reserve as a
field-level equality filter — that is what makes `?status=done` shorthand for
`?filter={"status":"done"}`. When the name matched **no** field the resulting
predicate could only ever match nothing, so `?pageSize=5` on a 10-row object
returned `200` + `total: 0`: structurally valid, and indistinguishable from
"this object is empty". The write path already rejected the same unknown name
loudly (`400 INVALID_FIELD`), so one piece of knowledge — does this field
exist — was enforced on write and silently zeroed on read.

The read path now answers the same way, in the same envelope:

```json
{
  "error": "Unknown field 'pageSize' on object 'showcase_task'. Query parameters that are not reserved are read as field filters, so an unknown name can only match zero records. Did you mean the 'top' query parameter (OData spelling '$top')?",
  "code": "INVALID_FIELD",
  "field": "pageSize",
  "object": "showcase_task"
}
```

The rejection carries a suggestion — the canonical parameter for a known
dialect (`pageSize` / `perPage` / `page` / `sortBy` / `q` → `top` / `skip` /
`sort` / `search`), or the closest real field name when it reads like a typo —
and fires whether or not an explicit `filter` rode along, so the failure never
depends on which other parameters were sent.

**What changes for callers:** a request sending a parameter that names no field
now gets a `400` where it used to get an empty `200`. Page size is `top` /
`$top` / `limit`; page offset is `skip` / `$skip` / `offset`. Every documented
parameter, every `$`-prefixed OData alias, and the full `QueryAST` body of
`POST /data/:object/query` are unaffected. An object with a field named after a
reserved parameter (`count`, `cursor`, `object`, `top`, `search`, …) filters it
through the explicit form: `?filter={"count":3}`.
