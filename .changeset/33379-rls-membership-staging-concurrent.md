---
'@objectstack/plugin-security': patch
---

fix(plugin-security): operations running at the same time on one request context now wait for the RLS membership resolver instead of compiling against an empty membership set

Clause-②: no
Metadata-protocol: none

With an RLS membership resolver registered, staging its sets was marked done before the resolver answered. A second operation running concurrently on the same execution context (a record page's related lists, stream or timeline loaded together) skipped staging and compiled `current_user.KEY` row-level policies against a set not filled yet, so it returned fewer rows than the same read alone. It failed closed, so nothing was over-shared. Every concurrent operation now waits for the one resolution in flight, and the resolver is still called once per request. A resolver that throws is no longer remembered as staged: the operations that waited on the failed call stay closed as before, and the next operation on the request asks the resolver again instead of inheriting an empty set.
