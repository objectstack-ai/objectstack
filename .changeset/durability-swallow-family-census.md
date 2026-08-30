---
"@objectstack/plugin-auth": patch
"@objectstack/plugin-sharing": patch
---

fix(plugin-auth,plugin-sharing): a refused bootstrap write stops reading as a clean one (#12981)

Two boot-time seams answered a REFUSED write exactly the way they answer a
write there was no need to make. Nothing else failed on either path, so the
deployment kept looking healthy — the durability class AGENTS.md separates
from the functional one, and the class `check-durability-degradation-log-level`
exists for and, at these two sites, structurally cannot see (it matches callee
NAMES from an 18-entry vocabulary, and a seeder reaching storage through
`ql.insert` is not in it; a green there means NOT MEASURED for the site, never
"level approved").

**`plugin-auth` — `ensureDefaultOrganization` reported at `warn`.** A refused
`sys_organization` or `sys_member` insert leaves the platform admin with no
organization: under multi-org the default `tenant_isolation` RLS policy filters
their console to zero rows, and under single-org better-auth has no active org
to resolve, so there is no way to add a user at all (ADR-0081 D1). Both lines
now report at `error` and each names the consequence AND the remedy, per
"Degradation log levels". `BootstrapLogger` gains an OPTIONAL `error`
(`message, error?, meta?` — the spec `Logger` arity, so the kernel logger
satisfies it as-is) beside its already-required `warn`; the fallback to `warn`
is mandatory and lives in one helper so no site can forget it. Additive: a host
passing `{ info, warn }` compiles and behaves exactly as before, and gets the
same line on the `warn` channel.

**`plugin-sharing` — `backfillPrimaryBu` printed NOTHING when every row was
refused.** Its per-row `catch { }` counted nothing and its report was gated on
`updated > 0`, so a pass in which every `sys_user` write was refused emitted
byte-identical output to a pass with nothing to do, while every affected user
kept a stale or absent `primary_business_unit_id` and every sharing rule keyed
on the primary business unit evaluated against the wrong value. Refusals are
now counted, reported once with the consequence and the remedy, and the summary
branch is `updated > 0 || refused > 0` — the same suppressor, repaired the same
way, as `permission-set-drift.ts` in #12970. `backfillPrimaryBu` now answers
`{ updated, refused }`; the added field is additive and its only in-tree caller
ignores the result.

`patch` rather than `minor` for both: no entry-barrel surface is added, no
command or flag, and neither change can turn a previously accepted call into a
rejected one. The `plugin-sharing` report deliberately stays on `warn` even
though the consequence is durability-shaped — `OptionalSharingLogger`'s own
header forbids growing an `error`, and giving that function a stricter sink
means requiring `warn` on a publicly exported shape, which
`scripts/optional-error-sink-contract.baseline.json` records in as many words
as #10556's contract call. What is fixed here is the SILENCE, which needed no
contract at all; the LEVEL belongs to that card.
