---
'@objectstack/driver-sql': patch
---

docs(driver-sql): how an operator finds and corrects the Postgres `date` values that releases before 18.4.0 stored one day early after a `datetime` → `date` publish; the platform does not repair them

Clause-②: no
Metadata-protocol: none

**Not repaired automatically.** Affected: Postgres, a database server whose time zone is ahead of UTC (for example `Asia/Shanghai`), a field published from `datetime` to `date`, and a day written into it after that publish by a release before 18.4.0. Such a day was stored as midnight in the server's zone (`2026-11-12` as `2026-11-11T16:00:00Z` at `+08:00`), so it reads, filters and buckets as the previous day. 18.4.0 writes new days correctly and reads every door the same way, but it cannot tell those rows from a value written while the field was a `datetime` at the same instant, so it changes no stored value.

To find candidates, run against the object's table, with ZONE the server's zone (`SHOW TimeZone`) and FIELD the field:

```sql
SELECT id, FIELD FROM TABLE
WHERE (FIELD AT TIME ZONE 'ZONE')::time = '00:00'
  AND (FIELD AT TIME ZONE 'UTC')::time <> '00:00';
```

Check each row against what was entered (a value that really was entered as a date-time at local midnight is also listed), then correct the ones that are early days:

```sql
UPDATE TABLE
SET FIELD = ((FIELD AT TIME ZONE 'ZONE')::date)::timestamp AT TIME ZONE 'UTC'
WHERE id IN (...);
```

After the update the row reads, filters and buckets as the day that was entered.
