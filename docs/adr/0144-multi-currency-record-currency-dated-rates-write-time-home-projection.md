# ADR-0144: Multi-currency — a record currency in a sibling code field, dated exchange rates, and a home-currency amount computed and stored at write

**Status**: Accepted — 2026-10-28, ruled on objectstack#27119 (ruling [`6465431966`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6465431966), decision batch #421 item 2, #27119 Q1 = 乙-现在). `docs/adr/**` is Tier H (Prime Directive #14): this record lands by an authorised approval and the maintainer's merge. **This record declares; it implements nothing** — no schema, no code, no changeset. The children of epic #8345 implement it.

- **Decided by**: the maintainer, 2026-10-28T09:29Z, on #27119, verbatim and untranslated: 「同意立专题卡」 — the epic
  form the director seat proposed for 乙-现在. Per the ruling, the maintainer had read the design record
  [`6464438764`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6464438764), the workload list
  [`6464936321`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6464936321) and the seat's answers
  in the summon chat. The ruling's own text is the authority this record executes; where the two differ, the ruling
  wins and this record is corrected.
- **Builds on**: [ADR-0104](./0104-field-runtime-value-shape-contract.md) D1 (a `currency` value is a bare number,
  kept here), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (the codes and envelope of every refusal this
  record names).
- **Amends**: no decision. ADR-0104 gains a dated note under D1's "Reality wins" paragraph. The note points here and at
  #27182, the card that retires `CurrencyValueSchema`.
- **Evidence**: epic [#8345](https://github.com/objectstack-ai/objectstack/issues/8345), with its measurement round
  [`6041378776`](https://github.com/objectstack-ai/objectstack/issues/8345#issuecomment-6041378776) and the spec seat's
  shape verdict [`6041482631`](https://github.com/objectstack-ai/objectstack/issues/8345#issuecomment-6041482631);
  [#27119](https://github.com/objectstack-ai/objectstack/issues/27119) (design record, workload rows, ruling); this
  record's card [#27183](https://github.com/objectstack-ai/objectstack/issues/27183). Every claim below about current
  behaviour cites a file or symbol as read on `origin/main` at `cdec7473`.

---

## TL;DR

- An amount field in the new `record` mode names, through `currencyField`, a text field on the same object with
  `valueDomain: 'iso_4217_currency'`. That field holds each record's currency. The amount stays a bare number
  (ADR-0104 D1).
- `sys_exchange_rate { currency, rate, effective_date, source }` holds dated rates against the organization's home
  currency, which is `localization.currency`. In v1, rows are entered by hand or imported. A provider feed is an app flow
  that writes rows.
- At write, the engine converts the amount at the document date's rate. It stores the result in a declared home field
  (`homeAmount`) together with the rate it used. A missing rate refuses the write. A corrected rate reaches stored
  rows only through an explicit recompute.
- A raw aggregate over a record-mode field refuses at build unless it groups by the code field. Consolidated totals
  read the stored home field.
- There is no CEL conversion function, no platform or tenant switch, no injected column and no fixed field name.
  Metadata never names the home currency.
- Delivery comes in three releases. R1 ships the record currency, the refusals and the per-row display. R2 ships the
  rates, the projection and the recompute. R3 is proof and polish. R1 and R2 each ship as one Version Packages release.

## Provenance — what is ruled here, and what is not

Three kinds of text feed this record. Each section says which kind it carries.

1. **Ruled.** Ruling `6465431966` fixes shape C′, sub-questions Q0–Q4, parameters 1–4, the five design rules, the
   release pairing and the commitment. [Decision](#decision) carries only this. It quotes the ruling wherever the
   wording matters.
2. **Analysis the ruling read.** This is the design record `6464438764`, the workload rows `6464936321`, the
   measurement round `6041378776` and the shape verdict `6041482631`. They supply the context, the shapes considered
   and the per-card plan. A detail that appears only there is not ruled. This record lists such details under
   [Open items](#open-items) or as a card's draft, never as a decision.
3. **Readings.** Current behaviour, measured at `cdec7473` and cited by file or symbol.

**Two numberings meet here.** #27119 is a decision batch, and two of its items are also called Q1 and Q2. #27119 Q1
asks when multi-currency starts, and the answer was 乙-现在. #27119 Q2 asks for one rule for an unknown currency, and
the answer was X, in its first record `6464202770`. The shape's own sub-questions Q0–Q4 come from the measurement
round: Q0 asks where a record's currency lives, Q1 covers rates, Q2 the home currency, Q3 conversion timing and Q4
aggregation. The ruling names them by topic ("Q0 A", "rates A", "home currency A", "conversion timing A",
"aggregation A"). In this record, **Q0–Q4 always mean the sub-questions**. The batch items are spelled "#27119 Q1" and
"#27119 Q2 X".

## Context

### 1. What the platform has today (read at `cdec7473`)

- **A currency value is a bare number** (ADR-0104 D1). `currencyConfig` has two modes
  (`packages/spec/src/data/field.zod.ts#CurrencyConfigSchema`). In `fixed` mode the field has one currency,
  `defaultCurrency`. In `dynamic` mode (the default) amounts display in the tenant default currency. The describe says
  "Neither mode is a per-record choice: the value is a bare number either way." No key, column or value carries a
  record's currency.
- **A `fixed` field with no code becomes a yuan field.** `defaultCurrency` defaults to `'CNY'` (same schema).
  #27157 (#27119 Q2 X) requires the code and drops the default. It is a member of R1 and a blocker of M0-1.
- **The tenant currency is the `localization.currency` setting**
  (`packages/services/service-settings/src/manifests/localization.manifest.ts#localizationSettingsManifest`, key
  `currency`). It has tenant scope, no platform default and `valueDomain: 'iso_4217_currency'`. It may be unset. It is
  mutable and keeps no history: probe B of the measurement round saw a change relabel every stored `dynamic` amount.
- **The ISO 4217 value domain exists** (`packages/spec/src/shared/value-domain.zod.ts#isValueDomainMember`). It checks
  membership in `CURRENCY_FRACTION_DIGITS`
  (`packages/spec/src/data/currency-fraction-digits.ts#CURRENCY_FRACTION_DIGITS`). Only that table's key set is read.
  Its fraction-digit values have no reader.
- **No conversion is implemented.**
  `git grep -n -i -E "exchange.?rate|fx_rate|currency_conversion|convertCurrency" -- packages/ ':!*.test.ts'` prints 0
  lines. Control: `git grep -c currencyConfig -- packages/spec/src/data/field.zod.ts` prints 13.
- **The CEL standard library is pure.** Its header says: "Nothing registered here may be handed a resolver, a lazy
  getter or any other callback into the host" (`packages/formula/src/stdlib.ts`). That purity keeps
  `objectstack build` byte-stable, so a formula function cannot read a rate table.
- **`CurrencyValueSchema` is still exported**, marked `@deprecated`
  (`packages/spec/src/data/field.zod.ts#CurrencyValueSchema`, its type `#CurrencyValue`), although ADR-0104 D1 says it
  "is deleted". #27182 retires it.
- **Today's numbers are silently wrong** (from the measurement round's probes over a real ObjectQL engine; the scratch
  files were run and deleted and are not re-run for this record). The probes model a record currency the way authors
  do today, as a sibling text field. `sum` over a USD row of 100 and an EUR row of 100 answers `200 "USD"`. A `summary`
  roll-up over USD 100 and JPY 15000 answers `15100`. A derived measure across a `fixed` USD field and a `fixed` EUR
  field answers 200 with no currency. Grouping by the code gives correct per-group values, but the column carries one
  currency, so every group gets the same label.

### 2. The pull

One named overseas port and terminal customer (2026-08) needs three things:

1. invoice in the customer's currency;
2. reconcile at the rate of the document's date;
3. consolidate in one home currency.

In-tree author pull is zero. The measurement round counted 17 currency fields in `examples/**` at `3d9188502e`, and
none has a record currency. The hold of 2026-10-08 ended with this ruling (乙-现在: now, as an epic). The commitment,
as ruled: "R1 (about 4–5 agent-days) is the delivery the customer can rely on; R2 starts after the customer confirms
the consolidation terms (home currency, rate source, which date drives the rate)."

### 3. The shapes considered

The spec seat's verdict `6041482631` put four shapes to the maintainer. The design record `6464438764` argued them
again against how Dynamics 365, Odoo, NetSuite, SAP, Salesforce and Airtable model currency.

| Shape | What it is | Outcome |
|:--|:--|:--|
| A | Guard rails only: refuse today's silent cross-currency arithmetic | Rejected. It meets none of the three needs, and it cannot see the sibling-text workaround it would push authors into. |
| A′ | A, plus a declared record currency (`record` mode and a code field) and the grouped-aggregate refusal | Rejected as the end state. Invoicing works but consolidation does not. The design record advised against stopping here because the contract would have to change again after M0. |
| B | Dated rates and a CEL `convertCurrency()` | Rejected. It conflicts with the stdlib purity invariant. A formula is virtual and aggregates refuse it, so the converted amount can never be totalled. |
| **C′** | A′, plus `sys_exchange_rate` and a home amount computed at write and stored with its rate. No formula function. | **Ruled.** It meets all three needs. Existing aggregate readers total the stored home field without any change to the reader. |

The ruling chose C′. The reasons in the Outcome column are the analysis', not the ruling's.

Q0, where the record currency lives, had four options of its own:

- **A, a sibling code field.** Ruled.
- B, a hidden column injected by the platform. It is implicit and invisible to AI authors and to build validation.
- C, a value object `{amount, currency}`. It overturns ADR-0104 D1, migrates every stored currency column and revives
  `CurrencyValueSchema`.
- D, the status quo of one `fixed` field per currency. It cannot serve an open set of currencies.

## Decision

Every decision in this section comes from the ruling, and its words are quoted wherever the reading matters. A line
that cites the design record, a workload row or a card is context for the decision above it, and names its source.

### D1 — Shape C′

> "a record-mode amount field points at an ISO 4217 code field on the same object; a platform rate table by effective
> date; the home-currency amount computed AT WRITE from the document date's rate and STORED with the rate used; a
> missing rate refuses the write; a raw aggregate over a record-mode field refuses at build unless grouped by its code
> field; consolidation reads the stored home field. No CEL conversion function."

D2–D6 answer its sub-questions. D7 covers its parameters, D8 the design rules from the summon and D9 the release
pairing.

### D2 — Q0: the record currency lives in a sibling code field (letter A)

- An amount field declares `currencyMode: 'record'`. Its `currencyField` names a text field on the same object with
  `valueDomain: 'iso_4217_currency'`. That field's value is the record's currency.
- The amount's value stays a bare number, so ADR-0104 D1 is kept, not superseded. `record` is a third mode alongside
  `dynamic` and `fixed`.

### D3 — Q1: dated rates live in `sys_exchange_rate` (letter A)

- `sys_exchange_rate { currency, rate, effective_date, source }` is a platform system object.
- In v1, rows come from manual entry and import. Provider feeds come "by an app flow", which writes rows; the
  platform ships no feed.
- A missing rate refuses (D5).

### D4 — Q2: the home currency is `localization.currency`, locked once used (letter A)

- The organization's home currency is the existing `localization.currency` setting. There is no second currency
  setting.
- It is locked "once a rate row or a home-amount declaration exists". M1-3 (#27198) builds the lock. `service-settings`
  has no write-side predicate hook today (workload row M1-3).

### D5 — Q3: the conversion runs at write and is stored with its rate (letter A)

- At write, the engine computes the home-currency amount "from the document date's rate". It stores the result in the
  declared home field "with the rate used".
- "A missing rate refuses the write." Because the write refuses, no fallback value is stored in place of the missing
  one. The design record (§5) lists the fallbacks it rejected: a 1:1 rate, 「最近一条」, and a null home amount. What
  counts as missing in the first place is [Open item](#open-items) 2.
- A corrected rate reaches stored rows only through "an explicit recompute operation". Changing a rate row does not, on
  its own, rewrite stored home amounts.
- The declaration key is `homeAmount`. The ruling: "the `homeAmount` key never ships ahead of the engine". Workload
  row M2-1 drafts its shape as `homeAmount: { field, rateDate, rateField? }`. #27191 fixes the shape under contract
  review; see [Open items](#open-items) 1 and 2.

### D6 — Q4: raw aggregates over a record-mode field refuse, and consolidation reads the home field (letter A)

- A raw aggregate over a record-mode amount refuses at build unless it groups by that amount's code field.
- Consolidated totals aggregate the stored home field. The home field is an ordinary stored currency field, so the
  aggregate readers that exist today total it without any change to the reader (design record §7). Those readers are
  the ObjectQL aggregate, `summary` roll-ups, analytics datasets and cubes, grid footers and metric tiles.
- The workload rows place the refusals in existing doors: the ObjectQL aggregate-by-field-type door and `summary`
  registration (M0-2, #27186), and the analytics cube measure door (M0-3, #27187).

### D7 — Parameters 1–4 (the workload's defaults, uncontested)

| # | Parameter | Ruled value |
|:--|:--|:--|
| 1 | Backfill when a historical rate is missing | Report and skip the row, and apply the rest |
| 2 | Who edits `sys_exchange_rate` | Organization admins only |
| 3 | Rate direction | "1 home unit = `rate` units of the foreign currency" |
| 4 | Precision of `rate` | "12 significant decimals" |

- **Parameter 3 as arithmetic.** An amount `A` in currency `X`, whose rate row says `r`, is `A ÷ r` home units. The
  home amount is the record amount **divided by** `rate`. Workload row M2-2 writes the projection as
  "amount × rate", which is the inverse convention, and #27192's card body repeats the product. That card's own
  two-minute check is the division: USD 10,000 at 0.1389 gives ¥71,994.24. #27192 follows parameter 3.
- **Parameter 1 governs the recompute and backfill** (M2-3, #27193). It does not govern the write path, where D5's
  refusal holds.
- The wording of parameter 4 leaves its unit open ([Open item](#open-items) 5).

### D8 — Design rules recorded from the summon

1. **No platform or tenant switch.** "the declaration `currencyMode: 'record'` is the switch". Nothing turns
   multi-currency on for an organization or a deployment.
2. **No injected columns and no fixed field names.** "every currency-related field is declared by the app author and
   referenced by pointer". The naming convention (`currency_code`, `AMOUNT_home`, `AMOUNT_rate`) is guidance in
   `skills/**`, "never a contract".
3. **"Enabled currencies" are derived, not a setting.** They are the home currency, plus every currency with a rate
   row, plus the codes already used.
4. **The form pre-fills the organization's currency at the renderer, and the stored value is always explicit.** Read
   plainly, the organization's currency reaches a new record only as a pre-filled value the user submits, and the
   server never fills in the code.
5. **Metadata never names the home currency.** "the home field is a `dynamic`-mode currency field", so it displays in
   `localization.currency`, as every `dynamic` field does.

   The measurement round and the design record (§9, §10) drafted the home field as `fixed` to the home currency. Rule
   5 replaces that with `dynamic`, and workload row M2-1 already reads `dynamic`. #27191 builds on the ruled `dynamic`.

### D9 — Release pairing (the only half-state risk)

As ruled:

- **R1** = #27157 + this ADR + M0-1..M0-4 "in ONE Version Packages release (a published `record` mode without the
  refusals and the per-row display is worse than today)".
- **R2** = M1 + M2-1..M2-3 (+ M3-2's read-only display) "in ONE release (the rate table's only reader is the
  write-time projection; the `homeAmount` key never ships ahead of the engine)". M1 "is therefore developed in parallel
  but released with M2".
- **R3** = "the rest of M3".

The cards that carry each release are listed in the epic #8345 body:

| Release | Ruled members | Cards |
|:--|:--|:--|
| R1 | #27157, the ADR, M0-1..M0-4 | #27157; #27183 (this record, numbered M3-4 in the workload rows); #27184 M0-1; #27186 M0-2; #27187 M0-3; #27188 M0-4 |
| R2 | M1, M2-1..M2-3, M3-2's read-only display | #27185 M1-1; #27190 M1-2; #27198 M1-3; #27191 M2-1; #27192 M2-2; #27193 M2-3; #27196 M3-2 |
| R3 | the rest of M3 | #27195 M3-1; #27197 M3-3 |

The epic body also files three cards that the ruling's pairing does not list. Under R1 it files #27182, the
`CurrencyValueSchema` retirement (the ruling calls it a prerequisite, and M0-1 is blocked by it), and #27189, the M0-5
docs page. Under R2 it files #27194, M2-4. Those placements are the epic PM's, not the ruling's. The epic PM marks each
R1 and R2 pull request "⛔ not released alone — pairs with …". Under Prime Directive #15, the maintainer merges
Version Packages, and the epic body says that happens only when a pair is complete.

## Non-goals

These are outside this decision, and each would need a decision of its own. The first eight are the workload rows'
"What is not in this list", each "a capability with no pull in tree". The last comes from the design record §13.

- A CEL `convertCurrency()`. The shape rules it out (D1), and it conflicts with the purity rule in the header of
  `packages/formula/src/stdlib.ts`.
- Read-time conversion.
- A built-in provider feed (ECB or similar). An app flow writes rows instead (D3).
- N×N pair rates. Every rate is against the home currency.
- A per-user display currency.
- Period-end revaluation and unrealised FX gains.
- More than one home currency per organization (multi-entity consolidation).
- Locale rounding rules.
- Rates shared across organizations at platform level. The design record §13 calls this "another decision, not this
  phase".

D8 already excludes a switch, injected columns, fixed field names and a setting for enabled currencies.

## Consequences

- **The change is additive.** `record` is a new mode, `dynamic` and `fixed` keep their meaning and stored rows are not
  touched. An app that never writes `record` sees no change. The two spec cards that add keys (#27184, #27191) declare
  `Metadata-protocol: added`.
- **Two steps cannot be undone once used** (design record §13). One is the home-currency lock. The other: an object
  with record-mode amounts and a home field returns to a single currency only through a data migration.
- **Today's relabel hazard closes where the feature is used** (the measurement round's Q2 recommendation). Once the
  lock holds, a change to `localization.currency` can no longer relabel stored amounts. An organization with no rate
  row and no home-amount declaration keeps today's behaviour.
- **Every converting write adds a rate lookup.**
- **The fraction-digit values may get their first reader.** That depends on [Open item](#open-items) 3.
- **The docs start from a true baseline.** #27158 (closed) removed the two docs claims of exchange rates and a stored
  currency code. At `cdec7473`, `git grep -n -E "Money with exchange rates|Store amount \+ currency code" -- content/docs`
  prints 0 lines. The M0-5 currency page (#27189) builds on that baseline.

## Open items

The ruling does not decide the items below. Each belongs to the card named, and is settled under that card's review.
Where a source leans one way, the lean is quoted here, not adopted. This record is amended with each answer.

1. **The document-date pointer and the stored-rate pointer: spelling and whether they are required** (#27191). The
   ruling fixes that the rate is the document date's and that the rate used is stored. Workload row M2-1 drafts
   `homeAmount: { field, rateDate, rateField? }`. In that draft, `rateDate` is "a `date`/`datetime` field on the same
   object (⛔ no default)" and `rateField` is optional. The design record §6 says the document date must be declared
   explicitly and must not default to `created_at` (「⛔ 不默认 created_at」). An optional `rateField` sits against the
   ruling's "STORED with the rate used", and #27191 reconciles the two.
2. **Which row counts as "the document date's rate"** (#27192). The ruling says "a platform rate table by effective
   date". Workload row M2-2 and the measurement round read this as the row with the latest `effective_date` on or before
   the document date. The measurement round also rules out a "nearest-future rate". The design record §5 says
   「⛔ 不取最近一条」 (do not take the most recent row). The predicate fixes what counts as missing, and #27192 pins it
   with tests.
3. **Arithmetic and rounding of the home amount** (#27192). The design record §5 and workload row M2-2 round to the
   minor units of the home currency's ISO 4217 code, read from `CURRENCY_FRACTION_DIGITS`. The epic body's risk note
   says money is computed in minor-unit integers or decimals, not floating point (「浮点算钱用最小单位整数或 decimal」).
   Neither point is in the ruling.
4. **A home-amount declaration or a converting write while no home currency is set** (#27192, #27198).
   `localization.currency` may be unset (its manifest entry says `required: false`, and there is no platform
   default). The ruling locks the setting once used. It does not say what happens while the setting is unset. The sources rule out a
   silent default (design record §9: no CNY default).
5. **The unit of parameter 4** (#27185). "12 significant decimals" can mean 12 significant digits or 12 digits after
   the decimal point. The precision and scale of the `rate` column follow from the choice.
6. **A record currency equal to the home currency** (#27192). Workload row M2-2 reads "same-currency-as-home ⇒ rate
   1, no lookup". The ruling does not say whether such a write needs a rate row.
7. **Uniqueness and audit of rate rows** (#27185). The design record §5 and the measurement round make rows unique per
   organization, currency and date. Workload row M1-1 says "unique (currency, effective_date); tenant scope;
   admin-only permission set; audit on". Parameter 2 fixes only who edits.
8. **A row that a backfill skips** (#27193). Parameter 1 skips and reports a row whose historical rate is missing,
   which leaves that row's home field unconverted. The design record §5 warns that `sum` silently ignores an empty home
   amount. #27193 decides how the gap stays visible after the report.
9. **Refusal codes and messages** (#27186, #27187, #27192). The workload rows draft `ERR_CURRENCY_CODE_REQUIRED` and
   `ERR_EXCHANGE_RATE_MISSING`. The codes and their envelope follow ADR-0112. The missing-rate refusal names the
   currency and the date (design record §5, workload row M2-2).
10. **Which aggregates count as "raw"** (#27186, #27187). The sources list `sum`, `avg`, `min` and `max`; `count`
    reads no amount. The per-row `currency` on grouped analytics results (workload row M0-3) is the contract half of
    #27187.

## Verification notes

Each reading below was taken at `cdec7473`. To re-check one, run its command on a newer `origin/main`. The comment
says what the command printed at `cdec7473`.

```bash
git grep -n "Neither mode is a per-record choice" -- packages/spec/src/data/field.zod.ts      # 1 line
git grep -n "default('CNY')" -- packages/spec/src/data/field.zod.ts                           # 1 line, until #27157
git grep -n "export const CurrencyValueSchema" -- packages/spec/src/data/field.zod.ts         # 1 line, until #27182
git grep -n "may be handed a res" -- packages/formula/src/stdlib.ts                            # 1 line
git grep -n -i -E "exchange.?rate|fx_rate|currency_conversion|convertCurrency" -- packages/ ':!*.test.ts'   # 0 lines
git grep -n "valueDomain: 'iso_4217_currency'" -- packages/services/service-settings/src/manifests/localization.manifest.ts   # 1 line
```

## References

- Ruling: [#27119 `6465431966`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6465431966).
- Design record: [#27119 `6464438764`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6464438764).
- Workload rows and parameters: [#27119 `6464936321`](https://github.com/objectstack-ai/objectstack/issues/27119#issuecomment-6464936321).
- Measurement round and shape verdict: [#8345 `6041378776`](https://github.com/objectstack-ai/objectstack/issues/8345#issuecomment-6041378776),
  [#8345 `6041482631`](https://github.com/objectstack-ai/objectstack/issues/8345#issuecomment-6041482631).
- Epic and children: [#8345](https://github.com/objectstack-ai/objectstack/issues/8345). The cards executing
  #27119 Q2 X outside the epic: #27156, #27157 (also a member of R1), #27158, #26939.
