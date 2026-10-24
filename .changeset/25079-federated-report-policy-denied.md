---
'@objectstack/objectql': patch
---

fix(objectql): a federated object whose datasource the connect policy denied is reported at info, not in the ERROR that claims its reads hit the wrong table

Clause-②: no (log text and level only: no response, status, outcome, boot verdict or export moves)
Metadata-protocol: none (a boot log line's level and text; nothing a metadata author writes changes)

- **What it was.** At `kernel:ready`, `ObjectQLPlugin` re-binds every federated (`external`) object to its remote table and reports, at ERROR, each one it could not bind. The ERROR says the object stays served while every read against it "resolves to a table named after the OBJECT … no such table, or the wrong table". It said that about an object whose datasource the host's connect policy had denied on purpose. `os migrate apply` on the stock showcase, whose managed-only policy denies every `schemaMode: 'external'` datasource, printed it after a successful apply.
- **What changed.** When the datasource layer records the datasource as refused by policy (availability `blocked`), its unbound objects are reported in one `info` line instead. The line names the objects and their datasource, and says every read against them is refused with `DatasourceUnavailableError` until the policy allows that datasource. That is what the engine already does for such a read. The same line appears on every composition, serving or not, because it follows the recorded verdict alone.
- **Unchanged.** The ERROR, word for word, for every other object it covered: a datasource that was never declared, a connect that FAILED (availability `failed`), a driver without external-object registration, and a registration that threw. On a boot with both, the info line covers the denied objects and the ERROR covers the rest, and the ERROR's counts exclude the denied ones. No binding, connect policy or read result changes.
- **What to do.** Nothing. A log filter or agent that keyed on the ERROR for a policy-denied datasource now finds the info line, which names the same objects and datasource.
