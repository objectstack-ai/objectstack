---
'@objectstack/spec': patch
---

Clause-②: no

The `manifest.contributes.routes` and `App.apis` retire messages (and the published
`plugin-manifest-contributes-routes-retired` migration text) no longer send app authors to an
imperative `http.server` route registered on `kernel:ready`. An app declares its endpoint under
`defineStack({ apis })` (`type: 'object_operation'` or `'flow'`, ADR-0121), computes in a flow,
and registers code as a stack function (`defineStack({ functions })`) or a connector. The
`http.server` service itself is unchanged: platform plugins keep mounting their own doors on it.
No key is added or removed.
