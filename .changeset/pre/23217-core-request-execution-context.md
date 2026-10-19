---
"@objectstack/core": minor
---

feat(core): export `resolveRequestExecutionContext`, the one composition that turns an inbound request into the caller's `ExecutionContext`

Clause-②: yes (widening)

- **New export from `@objectstack/core`'s `.` entry.** `resolveRequestExecutionContext(input)` reads the session through the auth service (the in-process rule: a request carrying a session cookie reads without renewal), classifies the tenancy posture with `classifyAdmissionTenancyPosture`, resolves the principal and its grants with `resolveAuthzContext`, resolves the reference localization, decides the ADR-0069 authentication-policy gate and assembles the envelope with `assembleExecutionContext` or `assembleExecutionContextOrGuest`. Its input type `RequestExecutionContextInput` and the types `RequestAuthService`, `EstablishedRequestSession` and `RequestAdmission` are exported with it.
- **Two choices, made once.** `anonymous: 'fail-closed'` yields no context for a request that resolves no principal (the door answers 401); `anonymous: 'guest'` serves it as the guest principal with the guest anchor's grants. `authGate: 'withhold' | 'resolved' | 'reread-when-active'` says whether the gate's posture rides the envelope, and how it is read.
- **Every other difference between doors is a named, required parameter:** `credentials`, `sessionApi`, `session`, `tenancy`, `localization`, `requestLocale`, `accessToken`, `oauth` and `onAdmission`. A door with no value passes `undefined` or the withholding literal, so no door can drop an input by omitting it.
- **First caller.** The runtime dispatcher's identity door (`@objectstack/runtime`'s `resolveExecutionContext`) now calls it. What that door answers is unchanged: the same guest envelope, the same 503 for a tenancy service that failed to build, the same OAuth agent principal on `/mcp`.
- **Faults propagate.** It catches nothing around the resolver: an unreadable permission store or tenancy service (`AuthzStoreUnavailableError`, 503) and an API key its own lifecycle refuses (`ApiKeyLifecycleRefusalError`, 403) reach the caller, which answers them at its own net.
