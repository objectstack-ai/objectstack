---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/cli': patch
---

docs(identity): re-point the cloud-identity `ADR-0024` citations at the records that decide them (#14361)

From this repository's point of view `ADR-0024` names two unrelated decisions.
`docs/adr/0024-mcp-connectors.md` is *MCP Servers as Connectors* — an open,
vendor-neutral tool protocol, with a Decision section numbered §1–§5 and no
D-lettered clauses at all. The identity surface's citations mean something else
entirely: the identity-and-access decision taken in `objectstack-ai/cloud` as
its own ADR-0024, whose open mechanism half has been mirrored into this repo
since 2026-09-07 as
[ADR-0135](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0135-identity-and-access-architecture.md).
A reader following one of those citations landed on a real page about the wrong
subject, which is worse than a dangling id: a plausible-looking record invites
belief rather than a second question.

79 citation lines were read one at a time and re-pointed. 73 mean a clause
ADR-0135 restates and now name it with its letter — D4 (source-of-truth marking,
managed vs env-native), D5.2 (the break-glass last-administrator invariant), D6
(SSO per production environment, including the opt-in DNS domain-verification
clause this tree spelled `ADR-0024 ②`) and D9 (environment users and
organization membership). 6 mean a clause ADR-0135 deliberately leaves in the
cloud record and now carry the anchors gate's cross-repo qualifier
`cloud ADR-0024`: `V1` (the SSO default-role provisioning, the roadmap and
commercial framing) and `§7` (the `ai_seat` synthesis, which ADR-0135 does not
restate).

What actually reaches a consumer of these packages:

- `@objectstack/plugin-auth` — the **operator-facing break-glass refusal
  detail** now reads `break-glass invariant, ADR-0135 D5.2 — an environment must
  always keep at least one administrator who can sign in`. The condition that
  raises it, its status, its error code and the rest of its wording are
  unchanged; only the ADR number moves. ⚠️ A deployment that greps that message
  for the literal `ADR-0024` should grep for `ADR-0135`. The guard's
  registration log line moves the same way.
- `@objectstack/platform-objects` — `sys_sso_provider`'s `domain_verified` field
  help text, its `protection.reason`, and the matching leaf in all four shipped
  locale bundles (`en`, `es-ES`, `ja-JP`, `zh-CN`).
- `@objectstack/spec` — the doc comment above `AuthConfigSchema`'s
  `ssoDomainVerification`, published both in `dist/` and as
  `src/system/auth-config.zod.ts`.
- `@objectstack/core`, `@objectstack/cli` — doc comments only, published in
  `dist/`; no runtime string and no behaviour.

No behaviour moves. No schema accepts or refuses anything it did not accept or
refuse before, no security or permission semantics are touched, and no ADR
record is written or edited. Bare `ADR-0024` still resolves exactly as it did:
the 15 citations that mean the local MCP-connectors record are byte-identical to
`main`, and `check:adr-anchors` reports the same resolving-citation totals before
and after. Historical archives are deliberately untouched — 36 CHANGELOG lines
across seven packages, and the 22 lines under `docs/adr/`, which is a governed
surface this change does not enter.
