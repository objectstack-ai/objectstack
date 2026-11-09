---
'@objectstack/runtime': patch
---

fix(runtime): a packaged job keeps the job-service key its catalogue holds for it across a restart (ADR-0150 D4)

Clause-②: no
Metadata-protocol: none

Who is affected: a runtime where two installed packages declare a job of the same name, on the database-backed job service (`sys_job` / `sys_job_run`). Nothing else moves: a runtime where no two packages share a job name schedules every job under its authored name, as before.

A job's identity is its package coordinate, the package id and the job name. The first package to hold a job name keeps the authored name on the job service, and a second package keeps the package-scoped `<packageId>:<name>`, as before. What changes is a restart. Before, the bare name went to whichever package the boot scheduled first, so a restart that rehydrated the packages in another order than they were installed in handed the first package's catalogue row and run history to the second package's job, and moved the first job under a new name. Now a package whose `<packageId>:<name>` the job catalogue still holds active (scheduled by an earlier run and never cancelled) is scheduled under it again, whatever the order. A job stored under its bare name before this release is scheduled under it again and fires as before. Nothing is refused and no author action is needed.
