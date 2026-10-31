---
'@objectstack/objectql': patch
---

fix(objectql): the 503 `ERR_DATASOURCE_UNAVAILABLE` text for a failed datasource no longer blames a startup connect under `OS_ALLOW_DRIVER_CONNECT_FAILURE`

Clause-②: no
Metadata-protocol: none

A datasource whose connect failed answers a read of its bound objects with `503 ERR_DATASOURCE_UNAVAILABLE`. Its message used to say the datasource "failed to connect at startup and the server was started with `OS_ALLOW_DRIVER_CONNECT_FAILURE`" and that the server "must be restarted". That was false for a datasource declared by a package installed into a running server (`POST /api/v1/marketplace/install-local`) and for one created in Setup: no flag was involved, and saving it again or reinstalling the package re-runs the connect.

The connection layer records every failed connect the same way, so the message now names no origin: "its last connect attempt failed, so no driver serves it", ending "See Setup → Datasources or the server log for the cause." Only while `OS_ALLOW_DRIVER_CONNECT_FAILURE` is set does it add that a datasource declared in code whose connect failed at startup is re-connected only by a restart. The code, the 503 status and the `reason: failed` class are unchanged, and the message still never carries the underlying cause.
