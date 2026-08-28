# ADR-0128: The AAD binding on `CryptoContext` is producer-discriminated

**Status**: Proposed (2026-08-28) — awaiting the maintainer's hand-merge, which is itself the acceptance act for a governed surface (Prime Directive #14). The **direction** below was already ruled on [#12599](https://github.com/objectstack-ai/objectstack/issues/12599) (maintainer, 2026-08-27, decision-inbox batch 6, verbatim and untranslated: 「其他同意」, accepting the seat recommendation "A now, with B recorded as the intended direction in its own ADR"). ⛔ **Nothing here is implemented, and this record changes no behaviour.** The prose half of that ruling shipped separately; see [Consequences](#consequences) for what is built and what is not.
**Deciders**: maintainer ruling, 2026-08-27, PM chat decision-inbox batch 6, on the four-axis recommendation filed against [#12599](https://github.com/objectstack-ai/objectstack/issues/12599).
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (no unenforced security properties — a documented guard weaker than the sentence advertising it is the same defect this record is about, one layer down), [ADR-0100](./0100-credential-field-channels.md) (credential field channels — the `secret` channel whose engine path is the second of the three producers below), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (error-code vocabulary — any refusal added by the implementation legs takes a code from that ledger).
**Supersedes**: nothing.
**Consumers** (at implementation time; none today): `@objectstack/spec` (`contracts/crypto-provider.ts` — `CryptoContext`, `ICryptoProvider`), `@objectstack/service-settings` (`settings-service.ts`, `local-crypto-provider.ts`), `@objectstack/objectql` (the engine's secret-field path), `@objectstack/service-datasource` (`datasource-secret-binder.ts`), and any out-of-tree `ICryptoProvider` implementation (`AwsKmsCryptoProvider`, `GcpKmsCryptoProvider`, `HashicorpVaultCryptoProvider`, customer HSM providers).
**Surfaced by**: [#12599](https://github.com/objectstack-ai/objectstack/issues/12599) — the doc-drift card, its dev measurement (comment [5432682106](https://github.com/objectstack-ai/objectstack/issues/12599#issuecomment-5432682106)), the decision facets (comment [5432696898](https://github.com/objectstack-ai/objectstack/issues/12599#issuecomment-5432696898)) and the ruling (comment [5434987411](https://github.com/objectstack-ai/objectstack/issues/12599#issuecomment-5434987411)). Found while correcting [#12550](https://github.com/objectstack-ai/objectstack/issues/12550)'s `sys_secret` field help.

---

## TL;DR

An AAD binding is a claim about **what a ciphertext is allowed to be**. Today the platform's default provider makes that claim over `(namespace, key)`, and that pair is not a coordinate — it is three different coordinates wearing one name:

> **`(namespace, key)` is one flat space shared by three uncoordinated producer vocabularies, so an AAD over it cannot say which producer sealed a ciphertext. It rejects a swap within a vocabulary and does not exclude a cross-vocabulary pair.**

The decided direction:

> **The AAD must be producer-discriminated.** `CryptoContext` carries a required **scope discriminant** naming which vocabulary `(namespace, key)` is drawn from, and providers fold it into a **delimiter-safe** encoding. Then "this ciphertext is a settings value" and "this ciphertext is an object's secret field" are different claims, and no swap between them authenticates.

⛔ **This is a direction, not a schedule.** It is deferred against a measured-zero hazard, and the deferral is priced in [§4](#4-why-it-is-not-being-built-now). What the record buys is that the present weak guard cannot fossilise as the designed one — the failure mode ADR-0049 exists to name.

## 1. Context — the measurement

All four facts below are measured, in tree, and were established by the dev seat on [#12599](https://github.com/objectstack-ai/objectstack/issues/12599) (comment [5432682106](https://github.com/objectstack-ai/objectstack/issues/12599#issuecomment-5432682106)) on `origin/main@527e0505d`, re-verified against `f75a38af` when the prose correction landed. They are recorded here rather than cited, because a record that outsources its own premises to a comment thread is a record whose premises will not be re-read.

### 1.1 Three producers, one `CryptoContext`, one meaning of "settings"

| producer | `ctx.namespace` | `ctx.key` | where `handle.id` is recorded |
|---|---|---|---|
| `SettingsService` | settings namespace | specifier key | `sys_setting.value_enc` |
| the ObjectQL engine's secret-field path | **object name** | **field name** | a `secret:` ref on the business row |
| the datasource credential binder | caller-supplied, default `datasource` | datasource name | a `sys_secret:` credentialsRef |

Only the first means "settings". The contract's prose asserted the settings reading for all three until the correction that this record's sibling PR landed.

### 1.2 The default provider really does bind AAD to this pair

`LocalCryptoProvider` — the **default, open-source, self-host** provider, and the one the CLI composition root wires — derives its AAD as the `|`-join of `ctx.namespace` and `ctx.key`, and feeds it to `setAAD` on both the cipher and the decipher. There is no producer discriminator in it, and the separator is unescaped. This is not an exotic implementation detail: it is the shipped default path.

### 1.3 The collision is structurally permitted, at every layer that could refuse it

Four facts compose, and no one of them is a defect on its own:

1. **One provider instance, one key, all three producers.** The CLI's `serve` command builds a single shared crypto provider and hands it to `SettingsService` *and* to the engine's secret-field path. Cross-vocabulary decryption is therefore gated by the AAD alone — not by key separation.
2. **`sys_secret` deliberately permits duplicate pairs.** The system object declares `{ fields: ['namespace', 'key'], unique: false }`. Collisions are permitted at rest **by design**, and that object's own TSDoc already states the pair "does NOT attribute a row to a producer".
3. **Nothing reserves the colliding names.** Object `name` validation admits any `[a-z_][a-z0-9_]*`; `RESERVED_NAMESPACES` governs metadata FQN namespaces, not object names. `mail`, `auth`, `storage` and `datasource` are all legal object names.
4. **The colliding pair already exists on the settings side.** The shipped `mail` manifest declares encrypted specifiers including `api_key`, and the provider's existing AAD pin test is literally written on `{ namespace: 'mail', key: 'api_key' }`.

### 1.4 The hazard, concretely

Compose 1–4: an app object named `mail` carrying a `Field.secret()` field named `api_key` makes the engine produce the AAD `mail|api_key` — **byte-identical** to the settings producer's, under the same provider and the same key, in a table that permits both rows. A ciphertext swapped between those two rows **decrypts cleanly**. The advertised guard does not see it, and the existing AAD test passes unchanged, because that test only ever varies the *key* half within one vocabulary.

**Is it live today? No — and that is load-bearing for §4.** Settings namespaces in tree: `ai`, `auth`, `branding`, `company`, `feature_flags`, `knowledge`, `localization`, `mail`, `sms`, `storage`. Objects carrying `Field.secret()`: `sys_account`, `sys_email`, `http_delivery`, `sys_webhook`, and the showcase `field_zoo`. **No intersection.** The hazard is open by construction, not realised.

### 1.5 Why the unescaped separator is a second, independent defect

Even inside one vocabulary the encoding is ambiguous: a join on a literal `|` cannot distinguish `('a|b', 'c')` from `('a', 'b|c')`. Nothing in tree produces a `|` in either half today, and nothing forbids one either — object and field names cannot contain it, but a settings specifier key and a caller-supplied datasource namespace are not so constrained. The discriminant and the encoding are therefore **one change**, not a change plus a nicety: adding a third component to an ambiguous join makes the ambiguity worse, not better.

## 2. Decision

### D1 — The AAD is producer-discriminated

`CryptoContext` carries a **required** scope discriminant naming the vocabulary that `(namespace, key)` is drawn from — a closed set, one member per producer (settings · object secret field · datasource credential). Every provider that binds AAD MUST fold the discriminant into that binding.

The obligation attaches to **the claim, not to the provider**: any future producer of `CryptoContext` gets its own discriminant member rather than borrowing an existing one, and adding a producer without one is the defect this record names.

### D2 — The encoding is delimiter-safe

The AAD MUST be built by an encoding under which distinct component tuples produce distinct bytes — length-prefixing, or escaping the separator, or a canonical structured encoding. ⛔ An unescaped join is not permitted, and the third component makes that non-negotiable rather than optional (§1.5).

### D3 — `ICryptoProvider` is the place the fix belongs

The fix is made **at the producer of the AAD**, not tolerated downstream. ⛔ No consumer-side widening — no "try the other vocabulary's AAD on failure", no lookup that resolves a colliding pair by guessing a producer. This is Prime Directive #12 (contract-first) applied to the case that motivates it: a downstream fallback would make the collision *invisible* rather than *impossible*, and would restore, as a compatibility path, exactly the cross-vocabulary decryption D1 exists to refuse.

### D4 — The record states the direction; it does not schedule the work

⛔ Nothing in D1–D3 is implemented by this record, and no card is opened by it. §4 states what would fund it. Until then the shipped contract prose is the honest present-tense description landed under the same ruling, and this record is what stops that description being read as the intended end state.

## 3. What the strong guarantee buys

Under D1–D2 the AAD authenticates a ciphertext's **producer** as well as its coordinate. Two properties follow, and the second is why the AI-authoring axis moved the recommendation:

- **The cross-vocabulary swap becomes cryptographically impossible**, not merely unlikely. It stops depending on a global name-uniqueness property that nothing in the platform enforces or intends to.
- **An author cannot fall into it.** Naming an object `mail` with a secret field `api_key` is a plausible thing for a person — and a *very* plausible thing for a metadata-authoring AI — to do, and today nothing at authoring time says no. Under D1 that object's secrets live in a different AAD space by construction, so the authoring decision stops carrying a security consequence it never signalled.

## 4. Why it is not being built now

The measured hazard has **zero instances** in any shipped or example corpus (§1.4), and the fix is not cheap. Both halves are recorded so the deferral can be re-priced rather than re-argued:

1. **A breaking change to a public export.** `CryptoContext` and `ICryptoProvider` are published from `@objectstack/spec`. A *required* discriminant breaks every out-of-tree provider implementation at compile time — which is the point (a silently-optional discriminant would leave the weak binding in place wherever it was omitted, i.e. everywhere that matters).
2. **An at-rest migration of every existing ciphertext.** Every ciphertext already sealed was sealed under the old AAD. Adding the discriminant changes the AAD, so **every existing ciphertext fails to decrypt** until it is re-wrapped. That is a rewrap path over `sys_secret` — with the usual properties of an at-rest migration: it must be resumable, it must be safe to run against a live deployment, and it fails closed on any row it cannot read. `rotateKey` is the seam it would use, but the migration itself does not exist.

⚠️ Note the ordering constraint that makes this more than a sum of two costs: the migration must read under the **old** AAD and write under the **new** one, so the implementation cannot simply replace `aadOf` — it needs a period in which both derivations exist and each ciphertext knows which one sealed it. That is a versioning problem on the handle, and it is the reason this is a project rather than a patch.

### The trigger that would fund it

Any **one** of these turns the deferral over; none requires re-opening the direction, only scheduling it:

- **The hazard stops being hypothetical**: any intersection appears between the settings-namespace set and the set of object names carrying a `Field.secret()` field — in shipped platform metadata, in an example app, or in a reported customer deployment. §1.4's "no intersection" is the whole of the deferral's evidence, and it is a fact with a shelf life.
- **A fourth producer of `CryptoContext` is added**, or an existing one's vocabulary is widened to accept names it does not control. A fourth vocabulary in a flat space is the same defect with more surface, and the discriminant is far cheaper to introduce *with* the new producer than after it.
- **`ICryptoProvider` is opened for another breaking change.** The migration is the expensive half; the breaking-export half should be paid once. A queued breaking change to this interface should pull D1 in with it.
- **A compliance or customer requirement asks the platform to state its at-rest ciphertext binding.** The honest present-tense answer is §1's, and an organisation that needs a stronger one funds the work.

## 5. Alternatives considered

**A — Prose only, and treat the flat space as the end state.** The prose half is landed and is *correct as a description*; this alternative is about stopping there. Rejected as a terminal answer: it leaves the contract permanently unable to state its AAD scope except as an exclusion list, and — the axis that decided it — it is the only option under which an author who names an object into another producer's AAD space is met with **silence**. Honest documentation of a weak guard is a description, never a decision, and ADR-0049 is the record of what happens when the two are confused.

**C — Reserve and reject the colliding names.** Refuse, at authoring or publish time, object names that collide with a registered settings namespace or with `datasource`. Genuinely attractive: no migration, every existing ciphertext stays valid, and it fails **loud** at publish rather than silent at runtime. **Declined by the maintainer ruling, 2026-08-27.** It couples object authoring to a settings-namespace registry that plugins extend **at runtime**, so a namespace registered later retroactively collides with an already-published object — a rule enforceable only over what is known at publish time, which is not the population that has to be safe. It also spends the platform's scarcest budget (the set of names an author may use) to protect a coordinate space that D1 removes the need to protect at all. Recorded here as considered-and-declined so it is not re-proposed as the cheap alternative to a deferred D1: it is not a cheaper D1, it is a different and weaker guarantee.

**Segregate keys per producer instead of discriminating the AAD.** Give each vocabulary its own KMS key, so a cross-vocabulary ciphertext fails for lack of the key rather than for AAD mismatch. Not chosen: it multiplies key custody, rotation and provisioning by the number of producers — for managed-custody providers, per tenant — and it buys the same property the discriminant buys for the price of one string. It also does not survive a provider that legitimately shares one key; the AAD is the layer that expresses "what this ciphertext is", and that is where the claim belongs (D3).

**Make the discriminant optional, to avoid the breaking change.** Rejected in D1. An optional discriminant is absent exactly where it was not thought about, which is the population the record exists to protect; and it splits the ciphertext corpus into bound and unbound halves without recording which is which — leaving the migration to be designed later against a corpus that has become harder to reason about, not easier.

## Consequences

**What is built: the prose, and nothing else.** The `CryptoContext` / `ICryptoProvider` docblocks now name the three producer vocabularies and state the within-vocabulary AAD guarantee, and the `DatasourceSecretBinderDeps.namespace` sibling drift is corrected — landed under this record's ruling as an ordinary documentation change. **What is not built: all of D1–D3.** No card is opened by this record; §4 names what would open one.

**No behaviour changes because this record exists, and no ciphertext is affected.** The deployed guarantee is exactly what it was before the ruling; what changed is that it is now described accurately in the contract and that its intended replacement is on the record.

**The prose and this record must move together if either moves.** The docblock's present-tense description is only honest while §1 holds, and this record is only a direction while D4's "not implemented" holds. If D1 ships, the docblock paragraph describing the flat shared space is the thing that must be rewritten in the same change — it is written to be replaced, not maintained.

**This record does not claim the hazard is exploitable end-to-end.** §1.4 establishes it is *constructible* from names already legal in the tree, with zero live instances. ⛔ Nothing here should be read as a disclosed vulnerability in a shipped deployment; an intersection appearing is the trigger in §4, and finding one is a finding to file, not a conclusion this record has already drawn.

**The `|` ambiguity (§1.5) is disclosed here without an obligation attached.** It is unreachable from object and field names, reachable in principle from a settings specifier key and a caller-supplied datasource namespace, and measured at zero producers. It is recorded so a future reader finds it written down rather than rediscovers it, and so that D2 is not mistaken for polish on D1.

## Refs

[#12599](https://github.com/objectstack-ai/objectstack/issues/12599) (the card, the dev measurement in comment 5432682106, the decision facets in 5432696898, the ruling in 5434987411) · [#12550](https://github.com/objectstack-ai/objectstack/issues/12550) (the `sys_secret` field-help correction that surfaced it) · [ADR-0049](./0049-no-unenforced-security-properties.md) · [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (the upgrade-contract discipline a D1 implementation's breaking change would enter) · [ADR-0100](./0100-credential-field-channels.md) · [ADR-0112](./0112-error-code-vocabulary-and-ledger.md)
