---
"@objectstack/rest": minor
---

fix(rest): a batch create goes through the same create ingress as a single create (#3835)

`readonly` meant two different things depending on which create endpoint you
used. `POST /data/:object` runs the #3043 ingress strip, so a non-system caller
cannot seed a read-only column — the field is dropped and reported. The
cross-object transactional batch (`POST /batch`) called `ql.insert` directly and
skipped that ingress entirely, and the engine's INSERT path is
static-`readonly`-exempt **by design** (#3413, the strip lives one layer up), so
nothing enforced it: the same forged `readonly` value that was rejected on one
route was written through on the other.

Measured on the showcase (`showcase_contact.lead_score`, `readonly: true`, same
signed-in non-system user):

| | before | after |
|---|---|---|
| `POST /data/showcase_contact` | `lead_score = null`, reported | unchanged |
| `POST /batch` create | **`lead_score = 999` written, silent** | `null`, reported |

The fix routes the batch's create ops through the protocol's `createData` rather
than re-implementing the strip at the REST layer. That keeps **one** create
ingress: a future change to its policy covers the batch for free, and the
carve-outs already encoded there stay intact — notably the platform-object
exemption (a `sys_`/`managedBy` object's own guard must *reject* a forged value
with 403, not have it silently swallowed) and the `isSystem` exemption. The
context passed through is the transaction context, so the insert still joins the
batch transaction and rolls back with it, and `{ $ref: <opIndex> }` resolution is
unaffected.

`createData`'s `droppedFields` are folded into the batch response's per-op
`droppedFields` list (#3794), so a batch create now reports its strips the same
way an update does.

Update ops are untouched: the engine enforces `readonly` and `readonlyWhen` on
its own update path.
