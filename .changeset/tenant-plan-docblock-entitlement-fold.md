---
"@objectstack/spec": patch
---

docs(spec): `TenantPlanSchema` doc block states the entitlement-layer fold, not normalization (#9345)

`TenantPlanSchema`'s doc block claimed that an unrecognized plan code is folded
to the free tier by "the cloud distribution's normalization." That was
measured wrong on two counts as of the cloud#1380 ruling (2026-08-16, landed
in cloud PR #1417, merged 2026-08-17):

- The fold happens at the **entitlement layer** (e.g. `isFreePlan`), never in
  normalization — `sys_environment.plan` keeps the raw value (case-normalized
  only), so an unrecognized tier stays distinguishable from the free tier to
  any reader, log line, or operator. Writing it as normalization is exactly
  what cloud#1389's red line forbids: normalize the spelling, never the
  vocabulary.
- Before the ruling landed, only the control-plane `planKey` reader folded
  unknown codes to free; the tenant-runtime `isFreePlan` reader granted paid
  access to an unrecognized code. As of cloud PR #1417 both mirrors fold.

The corrected doc block also states, explicitly, what it must not say: the two
mirrors' vocabularies are not merged into one list (cloud#1380 lands a
pinned *copy*; unifying them is cloud#1418, ruled but not yet landed, and a
SHA-pinned image can predate a vocabulary entry even after that lands), and
it carries the ruling's operational premise (new plan tiers are minted
rarely, images roll before a new tier goes on sale) so the spec text does not
contradict cloud's `isFreePlan` docstring, which states the same premise.

Doc-block prose only — `TenantPlanSchema` still accepts any string and
enforces no vocabulary; acceptance behavior is unchanged.
