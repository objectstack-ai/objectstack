---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: the datasource admin doors store `ssl`, `autoConnect` and `description` instead of dropping them, and the connection test probes the same TLS block a Save stores

Clause-②: yes (narrowing) — `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` now store every top-level key `DatasourceSchema` declares (`ssl`, `autoConnect` and `description` were accepted and dropped), `GET /api/v1/datasources/:name` serves them, `POST /api/v1/datasources/test` hands the draft's `ssl` to the probe, and the exported `DatasourceDraft`, `StoredDatasource`, `ProbeInput` and `ConnectivityBearingFields` types gain those members. One body that used to answer 201 / 200 (with the whole `ssl` block dropped) is now refused with `400 DATASOURCE_ADMIN_ERROR`: an `ssl` block carrying a client private key (`ssl.key`).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the doors now store keys DatasourceSchema already declares. The one refused body (an inline ssl.key) was never stored, because the doors dropped the whole ssl block, so there is nothing at rest for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the datasource admin doors (`@objectstack/service-datasource`): an inline `ssl.key` is refused.

- **Before.** Create and edit built the stored record from a hand list of eight keys (`name`, `label`, `driver`, `schemaMode`, `config`, `external`, `pool`, `active`). `ssl`, `autoConnect` and `description` passed the undeclared-key check (the schema declares them) and were then dropped, so a datasource saved with a TLS block was stored, and connected, without one. The connection test probed the same short record.
- **Now.** The stored set is read from `DatasourceSchema`'s shape at run time, so a key the schema declares later is stored the day it lands. Create, edit and the test probe use that one projection; an edit that changes `ssl` rebuilds the live connection. A read serves `ssl`, `autoConnect` and `description`.
- **Not taken from the body**, by design: `origin` (stamped `runtime`) and the ADR-0010 protection envelope (`_lock*`, `_provenance`, `_packageId`, `_packageVersion`), which only a code package's loader sets.
- **`ssl.key`.** The client private key has no sealed channel at this door (a `secret` is the only one, and it takes no TLS key), so storing it would put key material in the datasource row in cleartext. All three doors refuse it by name, never echoing the value; `enabled`, `rejectUnauthorized`, `ca` and `cert` are stored. A read never serves a key a stored row already holds, and an edit that sends back the served `ssl` block keeps that stored key.
- This supersedes the line of the #28612 entry that names `description`, `ssl` and `autoConnect` among the keys "the doors do not store".

**The remedy.** Leave `ssl.key` out of the request; the rest of the TLS block is honoured.
