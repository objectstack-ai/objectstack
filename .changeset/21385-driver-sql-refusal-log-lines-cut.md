---
'@objectstack/driver-sql': patch
---

fix(driver-sql): the driver's own refusal log lines no longer write the statement or the values bound into it

Clause-②: no

Five warning lines wrote the dialect's message to the server log as it came back. That message opens with the statement, with its bound values inlined on SQLite and MySQL, and on PostgreSQL a value-bearing diagnostic carries the value itself. The lines are the read terminal, the raw-statement terminal, and the refusals for a WHERE, a groupBy or aggregation, and a listed-distinct column the backend could not resolve. Each line now writes the dialect's text through the driver-fault redaction in `@objectstack/types`, the cut the engine applies at its boundary.

- **What stays on each line.** Its code, the class of fault it reports, the object and column it names, the dialect's error code where the line printed one, and the dialect's own diagnostic.
- **What goes.** The statement and the values bound or inlined into it, replaced by `[statement and bound values redacted]`, and the value slot of each diagnostic the redaction's templates own, replaced by `[value redacted]`. The raw-statement line no longer writes the statement it was sent, which also holds for `@objectstack/driver-turso`'s remote transport, whose refusals reach the same line. The two debug lines the read terminal writes inside a pre-DDL question, or for a table whose DDL the driver deferred, take the same cut.
- **The envelopes.** The code, status, `cause` and withheld text of every refusal are unchanged. Two composed messages, the read terminal's `DATABASE_ERROR` and the raw-statement terminal's, said the statement was written to the server log; they now say the diagnostic was written with the statement and its bound values cut.
- **What changes for an operator.** A log reader that took the statement or a bound value from these lines now finds the marker where the dialect's text carried them, and nothing where the raw-statement line wrote the sent statement on its own. The diagnostic, the codes and the named object and column are where they were.
