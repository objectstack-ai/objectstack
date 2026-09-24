---
'@objectstack/runtime': patch
---

fix(runtime): `POST /automation/:name/runs/:runId/resume` checks WHO is resuming — the run's own starter, or the `sys_automation_run` read grant (#19987)

Clause-②: no

**The defect.** The resume route checked the body and then resumed. It never asked who the caller was. An authenticated user holding another user's run id could continue that user's paused run, and the run then went on under the identity STORED on the run: its data nodes ran as the user who started it, with the values the other user submitted. The screen read on the same pause, `GET /automation/:name/runs/:runId/screen`, already refused that caller.

**The fix.** The route now asks the screen read's own question, through the same function: the caller must be the user who started the run (`getRun(runId).trigger.userId`), OR hold read access to `sys_automation_run` (the operator override), OR be a system context. Anyone else gets `403 PERMISSION_DENIED`, the screen read's code and status, and the run is not touched: nothing reaches the engine, so the pause stays parked for the person it is waiting on. The message states the screen read's requirement word for word under this route's own verb: "Resuming a paused run requires being the identity that triggered the run, or read access to 'sys_automation_run'."

**What stays the same.**

- The user who started a run resumes it exactly as before, with no grant needed, and still does while the permission subsystem is down.
- The suspended node's own gate (`resumeAuthority`) is unchanged and still answers behind this one. An `approval` pause is still refused on this route for every caller; approvers decide through the approvals API, which never uses this route.
- Body checks come first, as before, so every `400` for a malformed body is unchanged for every caller.
- For the starter, a `sys_automation_run` reader and a system context, every engine answer is unchanged, including the `404` for an unknown or finished run.

**Who needs to act.** A caller that resumes runs it did NOT start (for example an integration that feeds a `wait` node's signal, or a support tool) now needs read access to `sys_automation_run`. Without it, it gets the `403` above. Such a caller also gets that `403`, not the old `404`, for a run id that does not resolve. The check fails closed there because a run that is still paused can read as "not found" while the run store is degraded.
