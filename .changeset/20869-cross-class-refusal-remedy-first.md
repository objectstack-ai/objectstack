---
'@objectstack/formula': patch
'@objectstack/plugin-security': patch
---

fix(formula,plugin-security): the refusal of a field-to-field comparison across comparison classes now leads with its remedy, so the remedy reaches REST callers (#20869)

Clause-②: no

A row-level policy that compares two fields of no shared comparison class (text against a number, or any field against a file field, a formula field, or a field that holds a list or an object) is refused with `INVALID_FILTER` / 400. The REST door keeps a 4xx message under 500 characters by cutting it to its first 499 characters plus an ellipsis. Both messages for this refusal put the remedy last, so the remedy was always cut off, and a caller read the diagnosis but never the fix:

- The record matcher's message (`@objectstack/formula`, raised by the RLS write check on an insert or update through `/data`) was 972 characters, with the remedy starting at character 825.
- The explain engine's message (`@objectstack/plugin-security`, answered by `GET` / `POST /api/v1/security/explain`) put the remedy after the policy names and the diagnostic. Those have no length limit, so the message was 601 characters with a short policy name and longer with longer names.

Both messages now start with the remedy. It is the same sentence as before and has only moved:

- The record matcher's message is 494 characters and reaches the wire whole. In order it says: the remedy; that the two columns share no class, and which classes exist; why the comparison is refused; and why the columns are not named. It still names no column, operator or policy; the server log names them.
- The explain engine's message starts with the remedy, then names the policy and both columns, then gives the reason. Whatever the names' length, the remedy sits in the first 125 characters. With long names the REST door may cut the reason at the end.

Unchanged: the error code (`INVALID_FILTER`), the status (400), which comparisons are refused, the refusal a find answers with (driver-sql's read refusal, 383 characters, which already reached the wire whole), and every other refusal.
