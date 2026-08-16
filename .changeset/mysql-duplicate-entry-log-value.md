---
"@objectstack/objectql": patch
---

Keep a caller's value out of the server log when MySQL reports a duplicate entry

The driver-fault redaction added for #8682 replaces the bound statement in a logged
write fault and keeps the database's own diagnostic, because that diagnostic names the
failing identifier an operator needs. On MySQL's `ER_DUP_ENTRY` (1062) that premise does
not hold: the template is `Duplicate entry '<value>' for key '<index>'`, so the
conflicting value is in the diagnostic rather than in the statement and survived the cut.

The tail is still kept — including `for key '<index>'`, which is the answer to "which
constraint?" — and only the value slot is replaced:

```
before  Duplicate entry 'acme@example.com' for key 'crm_account.email' [statement and bound values redacted]
after   Duplicate entry [value redacted] for key 'crm_account.email' [statement and bound values redacted]
```

Also closed: a value spelled with `" - "` in it used to leave a fragment behind, because
the statement cut takes the last separator and that separator was inside the value.

Identifier-bearing diagnostics on every dialect are unchanged, the rethrown error is
untouched, and no HTTP response moves — this narrows one log slot only.
