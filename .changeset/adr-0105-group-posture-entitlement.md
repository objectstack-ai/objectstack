---
'@objectstack/plugin-auth': minor
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
'@objectstack/cli': patch
---

Multi-organization operation is an ENTITLEMENT again: the `group` posture no
longer activates without the enterprise runtime (ADR-0105 D12 correction).

The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
posture self-activating — it never probed for `@objectstack/organizations`. That
turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
D2), and made the weaker isolation the free one, which is not a boundary anyone
would draw on purpose.

The distinction that was missed: **open code is not free activation.** The wall's
implementation has always lived in the open packages — that is equally true of
`isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
service the enterprise package registers. Cloud ADR-0016's 铁律
(强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
away.

## Changes

- **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
  Without it the posture resolves to `single` and reports `degraded`.
- **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
  instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
  both the enterprise package load AND the fail-fast, silently degrading to an
  unwalled deployment — the exact ADR-0049 class that guard exists to close. A
  `group` request without the runtime now refuses to boot unless
  `OS_ALLOW_DEGRADED_TENANCY=1`.
- **New seam — the runtime declares what it entitles.** `org-scoping` may expose
  `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
  the open side honours it and fails closed on anything not listed. Whether
  `group` and `isolated` are one commercial tier or two is packaging policy, and
  packaging policy belongs to the commercial runtime rather than hard-coded in
  open core. Omitting the field entitles every walled posture, so existing
  runtimes are unaffected.
- **`organization_id` stamping returns to the enterprise runtime.** The previous
  wave moved auto-stamping into the open engine; that removed the closed
  package's only load-bearing runtime duty, so a five-line forged `org-scoping`
  registration would have produced a fully working multi-org deployment. With
  stamping back where it was, a forged registration yields NULL-org rows the wall
  hides — a broken deployment, not an unlicensed working one.

  **Write-side VALIDATION stays open and is unchanged**, including the
  bulk-insert coverage: rejecting a forged `organization_id` is a security
  property, not a packaging one. Only filling an ABSENT value moved back.
- Default-organization bootstrap returns to `single`-only; every walled posture
  keeps its existing owner (ADR-0081 D1).

## Note for operators

`OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
**refuses to boot** rather than running single-org. This only affects
deployments that adopted `group` between the two waves.
