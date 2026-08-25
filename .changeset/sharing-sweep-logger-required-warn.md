---
'@objectstack/plugin-sharing': minor
---

⚠️ **BREAKING (published parameter tightened):** `sweepOrphanedRowsByRecordExistence` —
publicly exported from `@objectstack/plugin-sharing` — now types its optional `logger`
parameter as `{ info?, warn }` with real signatures (`(msg: any, ...rest: any[]) => void`)
and a **required** `warn`, replacing the old `{ info?: Function, warn?: Function }`. A host
that passed this function a logger without a `warn` member (for example an
`{ info, error }`-only literal) compiles today and stops compiling after this release. The
one-line fix: add a `warn` callback to that logger object — or omit the `logger` argument
entirely, since the parameter itself stays optional. Nothing about the sweep's runtime
behaviour changes, and no call site in this repo moved: both in-package callers forward the
owning services' `logger` options, whose `warn` is already required since the producer
tightening (`SharingServiceOptions` / `ShareLinkServiceOptions` /
`SharingRuleServiceOptions`) shipped in the previous release.

Why: every report this sweep emits lands on `warn` — the "could not check whether records
still exist", "stopped early" and "revoked N rows" lines — so a logger without a
guaranteed `warn` is one the sweep can lose its ONLY output into. That is #9754's
permit-silence shape, one module downstream of the producers #10556 tightened, and the
maintainer ruled (#10692, 2026-08-25) that this package's logger contracts refuse it
loudly at compile time rather than keep it. The bare `Function` members were also their
own defect: they documented no call shape and caught no arity mistake. The refusal is
pinned at compile time in `logger-required-warn.pin.ts`, which also pins the three
publicly exported options types above.

Breaking ships as `minor` per the launch-window convention
(`scripts/check-changeset-no-major.mjs`).

<!-- adr-0087: not-required (no-migration-prescription) A TypeScript parameter type on one published function tightens; no metadata surface is involved — no Zod schema, no `packages/spec` declaration, no authorable key, no stored representation — so `objectstack migrate meta` has nothing to visit and no conversion-layer entry could replay anything. The affected caller is host CODE, and the compiler names the exact argument at the exact call line on upgrade, which is more precise than a ledger entry; the repair is adding a `warn` callback to that logger object. The sibling host repo objectui was grepped at claim time (ref 194fae18): zero imports of this package and zero warn-less logger literals, so no known caller has code to rewrite. -->
