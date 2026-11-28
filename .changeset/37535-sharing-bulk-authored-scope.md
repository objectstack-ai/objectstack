---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a predicate update or delete also writes the rows an app-authored update or delete policy admits, as the by-id write does

Clause-②: yes
Metadata-protocol: none

By id, a row an app-authored `using` update or delete policy admits was written although the caller neither owned it nor held a share on it: the sharing gate defers to the security service's `checkAuthoredRowWrite`. A predicate write (`update` / `delete` with `multi: true`, as a flow's bulk node runs) left those rows out, with no error and a smaller count.

The sharing middleware's bulk write scope is now the sharing scope OR the authored policies' own scope, asked of the security service (`getAuthoredRowWriteFilter`), then ANDed into the write as before. An update policy widens update only and a delete policy delete only. A delegated (on-behalf-of) write is not widened, as its by-id write is not. A security service without the member, a caller with no authored `using` policy, or any failure leaves the scope as it was. `buildWriteFilter`, `checkEdit` and `checkDelete` are unchanged. Nothing to migrate: a deployment whose flows relied on the smaller set now writes the rows its own policies declare.
