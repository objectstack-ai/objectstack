---
'@objectstack/metadata-protocol': patch
---

Global search (`searchAll`, the producer behind `GET /api/v1/search`) no longer invents an empty registry. The registry read was `registry?.getAllObjects?.() ?? []`, so a host whose registry does not implement `getAllObjects` — a structural omission that never throws — produced a successful "nothing matched" response with `objectsScanned: 0`. A registry that cannot enumerate its objects is never truthfully "no objects" (ADR-0110 D3): both halves of the swallow are removed and the omission now surfaces as the read's own failure, mapped by the REST door's standard error path. Unchanged neighbours: a registry that enumerates and truthfully answers "no objects" still yields the successful empty response, and a blank query still short-circuits before the registry is consulted.
