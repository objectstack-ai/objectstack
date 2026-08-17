---
"@objectstack/cloud-connection": patch
---

Cloud-connection refusals now emit the response envelope they declare.

Eleven error exits on `/api/v1/cloud-connection/*` answered with
`error: { code }` and no `message`. `ApiErrorSchema.message` is REQUIRED, so
`body.error.message` read `undefined` on the wire for every one of them — the
Console had already grown the accommodation that produces, displaying
`body?.error?.message ?? body?.error?.code` and so showing a machine code to a
human. All eleven now carry a readable message; no status and no code changed.

`POST /api/v1/cloud-connection/bind/poll` additionally stamped the UPSTREAM
RFC 8628 spelling (`expired_token`, `access_denied`, …) straight into
`error.code`, which is a closed ADR-0112 vocabulary — so that body failed its
own contract. The wire change, for anyone branching on it:

    before:  { success: false, data: { pending: false },
               error: { code: "expired_token" } }
    after:   { success: false, data: { pending: false },
               error: { code: "DEVICE_CODE_FAILED",
                        declaredCode: "expired_token",
                        message: "Device authorization failed: expired_token" } }

Nothing is lost: the verbatim upstream spelling now rides `declaredCode`, the
open producer-authored channel ADR-0112 declares for a code the serving side's
ledger does not know. Read `error.declaredCode` where you previously read
`error.code` for the RFC 8628 value; `error.code` is now the registered member,
which is what a consumer branching on platform conditions should key on.
