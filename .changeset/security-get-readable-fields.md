---
"@objectstack/plugin-security": minor
"@objectstack/rest": minor
---

feat: `security.getReadableFields` query surface for export column projection (#3547, #3391 follow-up)

The REST export route projected its columns by inferring readability from the
first chunk of already-masked data rows (#3498). That has two known
compromises: a readable column whose first-chunk values are all null (and thus
omitted by the driver) drops out of the header, and an empty result set leaves
nothing to narrow. This adds the long-term-correct path.

- **plugin-security** — the `security` service gains
  `getReadableFields(object, context)`. It resolves the caller's permission
  sets and builds the field-permission map with the SAME evaluator +
  `requiredPermissions` fold the read middleware's `FieldMasker` uses (and the
  same on-behalf-of delegator intersection, fail-closed on a dangling
  delegator), then returns every schema field NOT masked non-readable — the
  exact complement of what the mask deletes, so it can never drift from
  data-plane FLS. Computed from schema + context, never from data rows: immune
  to null values and empty result sets. A system context bypasses FLS; an
  unresolvable schema returns `undefined` so callers fall back.
- **rest** — the `GET /data/:object/export` route asks the environment's
  `security` service for `getReadableFields(object, context)` and projects the
  schema-derived header to that set BEFORE streaming. When no security service
  is reachable (no plugin-security / single-kernel without a provider) it
  degrades to the existing masked-row inference, so there is zero regression.
  Explicit `?fields=` requests are still honored verbatim.

Contract-neutral: export columns already equal list's readable columns
(`export ⊆ list`, #3391); this makes the projection authoritative instead of
inferred.
