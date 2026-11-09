---
'@objectstack/runtime': patch
'@objectstack/core': patch
---

fix(runtime): `/api/v1/ai/*` stops answering 503 "AI service routes not yet initialized" forever when the AI route table is never published

Clause-②: yes (widening) — an authenticated caller on a booted kernel whose AI service publishes no route table now gets the declared unavailable answer (`GET /ai/agents` 200 `{ agents: [] }`, every other `/ai/*` route 501) instead of a 503 that never clears; `ObjectKernel` and `LiteKernel` gain the read-only method `hasBootPhaseSettled('kernel:ready')`, and the exported `DomainHandlerDeps` gains the optional member `isRequestKernelReady`.
Metadata-protocol: none

An AI service registered with its route registration turned off (an unlicensed Enterprise image does this) publishes no route table for the life of the process. The `/ai` handler answered that the same way it answers the short window before a table is published: 503 "AI service routes not yet initialized", which tells clients to retry. The Console requests `GET /api/v1/ai/agents` on every page, so every page of such an install logged a 503.

The handler now tells the two apart by the request kernel's boot phase. Once `kernel:ready` has settled, every plugin's `start()` and every ready handler has run, so a table that is still absent will not appear: `/ai/*` then answers exactly as it does when no AI service is installed (`GET /ai/agents` returns the empty catalog the Console reads as "hide AI", every other route returns 501 with the remedy sentence). Anonymous callers are still refused 401 before either answer. Before `kernel:ready`, on a kernel bootstrapped with `bootPhaseHooks: false`, or on a kernel that cannot answer the question, the 503 stays.

The runtime's exported `DomainHandlerDeps` gains an optional member, `isRequestKernelReady(context)`, which the dispatcher fills from the request kernel. An implementation written without it still compiles and keeps the 503.

`ObjectKernel` and `LiteKernel` gain `hasBootPhaseSettled(phase)`. It answers `true` only for `'kernel:ready'`, only once every `kernel:ready` handler has settled, and only while the kernel is running; any other phase, a kernel still booting, one whose boot-phase hooks are withheld and a stopped kernel answer `false`.
