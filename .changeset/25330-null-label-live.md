---
'@objectstack/spec': patch
---

fix(spec): a dataset dimension's `nullLabel` is live, so `os lint` stops warning that nothing draws it, and the dataset form offers it

Clause-②: no (a liveness-ledger re-grade plus a form column for a key the schema already accepts: no schema, accept set, served body or error code moves)
Metadata-protocol: none

The console now draws a dataset chart's null bucket under the name its dimension declares: the server carries it on the answer's column descriptor as `fields[].nullLabel` (objectstack#25402), and the dashboard's dataset chart reads it (objectui#13354, at the `.objectui-sha` pin this release builds). So:

- **Liveness:** `liveness/dataset.json` re-grades `dimensions[].nullLabel` from `planned` to `live`, citing the console's reader at the pin and the server's carry as its producer. Its `authorWarn` goes with it, so the advisory lint no longer tells an author who sets `nullLabel` that no renderer draws the bucket under it.
- **Dataset form:** the Dimensions repeater gains a Null Label column, the schema's own `.meta({ title })`. The form had left the key out only while nothing drew it. That reason went with the `planned` verdict, so its row in the form ↔ Zod reconciliation ledger is gone.
