---
'@objectstack/runtime': patch
---

fix(runtime): when two packages declare a job with the same name, both jobs now run. Uninstalling one stops only its own job.

Clause-②: no

The metadata registry keys a packaged item by package and name (`<packageId>:<name>`), so two packages may each declare a job called, say, `nightly_sync`. The job service keys a job by one string and replaces any job with the same name. Before this fix, installing the second package (`os package install`, or a second app on one boot) silently replaced the first package's job. That job stopped running while both installs reported success.

- **Both jobs run.** A job is scheduled under its authored name unless another package already holds that name on the job service. In that case it is scheduled under the registry's package-scoped identity, `<packageId>:<name>`, and an `info` line names the package that holds the name. A package's job body and its `handler`'s `jobId` still see the authored name.
- **What an operator sees.** The Background Jobs catalogue (`sys_job`) and run history (`sys_job_run`) list the job under the name it is scheduled under. That is the authored name, or `<packageId>:<name>` for a package whose job name another package already holds. A reinstall keeps the name the job already has.
- **Each package cancels only its own job.** When a reinstall drops a job, or the package is uninstalled (the `runtime.package-jobs` uninstall cleanup), the job is cancelled under the name it was scheduled under. Another package's job with the same name keeps running.
- **Unchanged:** a runtime in which no two packages declare the same job name schedules every job under its authored name, so its catalogue and run history read exactly as before. No schema, export, `IJobService` contract or accept-set change.
