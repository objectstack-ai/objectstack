---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `deleteMetaItem`'s catch re-wrap carries the error `code` (#7426)

`deleteMetaItem` is the one verb in `protocol.ts` that re-wraps a thrown error
instead of rethrowing it: both of its catches build a fresh `Error` carrying the
"failed to delete" context. They carried `status` forward and dropped `code`, so
a refusal thrown by `SysMetadataRepository` with a full ADR-0112 envelope reached
the caller as **403 with `code: undefined`**, its code surviving only as prose
inside the message. That made the envelope depend on the deployment topology: on
a project kernel (`environmentId` set) the same refusal comes from
`deleteMetaItem`'s own two-tier block and arrived intact with
`code: 'NOT_OVERRIDABLE'`, while a control-plane kernel — which skips that block
entirely — answered the code-less 403.

Both re-wrap exits now carry `code` forward, gated on membership in the declared
ADR-0112 vocabulary (`StandardErrorCode ∪ ERROR_CODE_LEDGER`) — verbatim the
predicate `toRowApiError` in the same file already applies to decide which thrown
code may become a wire code. A driver's own dialect (`42P01`,
`SQLITE_CONSTRAINT`, `ECONNREFUSED`) is not in the catalog and stays out of the
envelope, so restoring the code for refusals does not smuggle an unregistered
code onto a surface `ApiErrorSchema` declares as a closed union.

What a caller sees change, per failure kind through those two catches:

- repository authorization refusal (`NOT_OVERRIDABLE`) — was `403` + no code,
  now `403` + `NOT_OVERRIDABLE`;
- engine failure carrying a **registered** code (`ERR_DATASOURCE_UNAVAILABLE`,
  `ERR_DRIVER_CONNECT`) — was `status` only, now `status` + that code;
- engine failure carrying an **unregistered** driver code, or none at all —
  unchanged (`500`, no code), and pinned so it stays that way;
- `ConflictError` — unchanged (`409` + `METADATA_CONFLICT`); it is translated one
  branch above the re-wrap and never passes through it.

`status` is untouched at both sites. The message text is unchanged — the code is
added to the envelope, it does not restate the sentence — so the 5xx prose
sanitisation in `@objectstack/rest` is unaffected; that layer already forwards a
declared `code` when one is present.
