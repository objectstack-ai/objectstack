---
'@object-ui/core': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

fix(dashboard): a drill on a dimension across a relationship lists its records, and a failed drill says so in the viewer's language

Clause-②: no
Metadata-protocol: none

A dataset dimension can read a field of a related object (`crm_account.owner_id`). Clicking such a bucket in a dashboard widget or a report built a drill filter on the dotted path itself, which the data API refuses with `INVALID_FIELD` / 400, and the drill drawer then printed that English developer message to the viewer.

- **The drill resolves the relationship first.** `resolveDatasetDrillFilter` (`@object-ui/core`) reads the related object's ids matching the clicked value through the surface's own data source, as the viewer, and filters the base object on the relationship field: `{ crm_account: { $in: [...] } }`. A path of up to three hops (ADR-0071's limit) is read innermost first, one read per hop, and dimensions that share a hop are read together. A bucket with no relationship path drills exactly as before, with nothing extra read.
- **No drill rather than a wrong list.** A path past three hops offers no drill. A relationship the object does not declare as a single-valued lookup, the empty bucket of a relationship dimension, and more than 200 related records at a hop open the drawer on a localized notice instead of a list. The id list is never truncated. A report emits no drill in those cases and logs why.
- **The drawer speaks to the viewer.** When the drawer's list read fails, it shows a localized sentence (`dashboard.drillFailed`) instead of the server's message. New keys `dashboard.drillTooMany`, `dashboard.drillUnavailable` and `dashboard.drillFailed` are in every built-in locale.
- `buildDatasetDrillFilter` now refuses a relationship-path dimension with a `FilterOperatorError` instead of writing a dotted key, and takes the resolved conditions as an optional sixth argument.
