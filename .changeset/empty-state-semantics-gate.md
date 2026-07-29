---
"@objectstack/spec": patch
---

chore(spec): classify what a restriction-shaped property's EMPTY value means (#3896 follow-up)

#3929 fixed one field. `sys_sharing_rule.criteria_json` was optional, and its
absence evaluated to `find(object, { filter: {} })` — every record of the object,
granted to the recipient. The field description said so out loud: *"leave empty
to share every record."*

That sentence is the part worth generalising. For a platform whose premise is
that agents author metadata, **a field description is not documentation about the
contract, it is the contract the next author reads** — and omission is the
commonest authoring error a model makes, precisely because it produces no error.
When omission also lands on the widest grant, the likeliest mistake is the most
dangerous outcome, silently.

Sweeping the spec surface found the same syntactic shape — an optional list or
predicate that "restricts" something — carrying opposite meanings when empty:

| Property | Empty means |
|---|---|
| `object.apiMethods` | `undefined` = unrestricted, **`[]` = deny-all** |
| `plugin-runtime.allowedSources` | *"empty = all allowed"* |
| sharing `condition` | nothing is shared (#3929) |

Nothing marked which was which. A maintainer knows by memory; a model cannot.

**New gate — `pnpm --filter @objectstack/spec check:empty-state`**, wired into the
existing Spec Liveness Check workflow. It scans `packages/spec/src/**/*.zod.ts`
for statements declaring an empty state to be permissive and requires each to be
classified in `scripts/liveness/empty-state-registry.mts` as `scope` (selects a
range of work — empty = all is fine), `closed` (an access gate whose empty state
denies — the required posture for new gates), `open` (default-open on purpose,
mandatory rationale), or `output` (a computed projection, not authorable).
`closed` / `open` must cite where the posture is enforced, and the path is
resolved against the checkout so a pointer that rots is reported. 20 statements
across 214 schema files are now classified; adding an unclassified one fails CI.

Detection matches the **statement**, not field names — names would be a guess,
and the liveness README is blunt about where a guessy check ends up ("a
permanently-noisy check is a check nobody reads"). It ignores negated tokens, so
the ⚠ `object.zod.ts` prints to warn that an empty whitelist is DENY-ALL is not
flagged as if it were permissive. Statements that resolve to no property are
narrative and reported as non-failing notes.

**One behavioural correction.** `DynamicLoadingConfig.allowedSources` — a
supply-chain gate — documented `[]` as admitting every source. It now states the
`apiMethods` three-state: `undefined` = any source, `[]` = **deny-all**, a subset
= exactly those types. The empty ARRAY is closed; only ABSENCE is open. Collapsing
the two is what makes an allow-list *vacuous*, where the value an author reaches
by mistake is also the widest grant.

The field has **no runtime consumer** — the whole `DynamicLoadingConfig` block
(`requireIntegrity`, `defaultSandbox`, `allowedSources`) is declared and
unenforced, the ADR-0049 false-compliance shape, and is not addressed here. That
is exactly why the wording mattered: an unimplemented property's description is
the specification whoever implements it will build to. It now carries an
`[EXPERIMENTAL — not enforced]` marker so authors are not misled meanwhile.

Also registers the `sharing-rule-criteria-required` dogfood proof added by #3929,
which was declaring a `@proof:` tag the registry did not know about (unbound, for
the same reason as `showcase-bu-hierarchy-sharing`: sharing rules are authored at
stack level, so there is no governed per-type ledger entry to ratchet).

No runtime behaviour changes.
