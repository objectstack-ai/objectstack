# ADR-0158: Units of measure — a closed standard unit table in the spec, organization-owned units, a quantity field that names its unit, and a base quantity stored at write

**Status**: Accepted — 2026-11-19, ruled on objectstack#35339 (ruling record [`7001193034`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001193034), maintainer 「先不考虑 hotsrm，先处理平台任务，你的意见我同意」). `docs/adr/**` is Tier H (Prime Directive #14): this record lands by an authorised approval and the maintainer's merge. **This record declares; it implements nothing** — no schema, no code, no changeset. The R1 cards follow it, as the ruling's "Next" says.

- **Date**: 2026-11-19
- **Decided by**: the maintainer, 2026-11-19T06:01:58Z, in the design discussion for #35339, verbatim and untranslated:
  「先不考虑 hotsrm，先处理平台任务，你的意见我同意」. The ruling record
  [`7001193034`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001193034) reads 「你的意见」
  as the recommendation it carries: "It was reviewed adversarially before it went to the maintainer, and he accepted
  it as recommended on each of its three questions". The record's own text is the authority this ADR executes; where
  the two differ, the record wins and this ADR is corrected.
- **Ordered by**: the maintainer's regrades on the card, 「升 p2，交 data 区写 ADR」
  ([`7001211414`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001211414)) and then
  「升级 p1」 ([`7001212970`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001212970)).
- **Card**: [#35339](https://github.com/objectstack-ai/objectstack/issues/35339) (units of measure on the platform: a
  standard unit list, quantity fields that carry their unit, and conversion).
- **Builds on**: [ADR-0144](./0144-multi-currency-record-currency-dated-rates-write-time-home-projection.md), the
  pattern this record mirrors (D1, the D2 amendment, D5, D6, D8 rule 2).
  [ADR-0104](./0104-field-runtime-value-shape-contract.md) D1 (a value is a bare number; kept by U4).
  [ADR-0049](./0049-no-unenforced-security-properties.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (no
  declared key without the engine that reads it; U8). [ADR-0153](./0153-one-way-sync-in-beside-federation.md)
  (`synced` objects; `sys_unit` is not one, [Non-goals](#non-goals)).
- **Amends**: no decision. ADR-0144 is mirrored, not changed. The standard value-domain vocabulary of 2026-09-02
  (`packages/spec/src/shared/value-domain.zod.ts#ValueDomainSchema`) keeps its three members (U1).
- **Complements**: ruling A on [#35328](https://github.com/objectstack-ai/objectstack/issues/35328)
  ([`7000155587`](https://github.com/objectstack-ai/objectstack/issues/35328#issuecomment-7000155587)): each suite owns
  its own records, matched by contract keys.
- **Evidence**: every claim below about current behaviour cites a file or symbol as read on `origin/main` at
  `3819afec`.

---

## Provenance — what is ruled here, and what is not

Four kinds of text feed this record. Each section says which kind it carries.

1. **Ruled.** The ruling record `7001193034`: its three accepted answers, U1–U8, "Out of scope" and "Left to the
   ADR". [Decision](#decision) carries only this text and quotes it verbatim; [Non-goals](#non-goals) quotes "Out of
   scope". The three answers the maintainer accepted, as the record lists them:

   > 1. Standard units go in a closed spec constant.
   > 2. The piece code is H87, and org codes get a reserved namespace.
   > 3. R2 converts both by dimension ratio and by a suite-supplied factor.

2. **Left to this record.** The ruling hands this record three items ("Left to the ADR"), and U6 hands it one more
   sentence. Each is a section of [Left to this record](#left-to-this-record) that states the question as ruled. L3
   carries the owning seat's settlement, marked as such; L1, L2 and L4 carry no settlement yet. The consequences
   noted under U3 are the same seat's, and are not new rules.
3. **The card.** The business reason and the review questions in #35339's body. They are the analysis the ruling
   answered; a detail that appears only there is not ruled.
4. **Readings.** Current behaviour, read at `3819afec` and cited by file or symbol. The commands are under
   [Verification notes](#verification-notes).

**Two labels meet here.** U1–U8 are the ruling's own decision labels. They are kept unchanged, so a card that cites
"U5" or "U7 R1" resolves here. R1 and R2 are U7's releases; they are not ADR-0144's R1 and R2.

## Context

### 1. The business reason (the card's)

From #35339's body. The card read these in the suite repositories; they are not measured here.

- **Sell side.** "hotcrm sales order lines and quote lines carry a `unit_price` but no unit at all."
- **Buy side.** "hotsrm has `srm_material.uom` and `srm_delivery_record.uom` as free text with `maxLength: 20`. "kg",
  "KG", "千克" and "公斤" are four different values there."
- **Production.** "The planned production suite (the one EE customer builds production management) lives on unit
  conversion: bills of material, material issue, finished goods."

The card ties this to ruling A on #35328, which "only works if quantities mean the same thing on both sides of a
match. A unit is the quantity's half of that contract, the way ISO 4217 is the amount's half." Without a platform
list, "each suite ships its own unit list. Every later ERP or cross-suite link then starts with a data-cleaning
project."

The ruling sets the order of work: 「先不考虑 hotsrm，先处理平台任务」. The platform comes first; hotsrm and hotcrm
adoption is deferred ([Non-goals](#non-goals)).

### 2. What the platform has today (read at `3819afec`)

- **Nothing for units.** `uom` as a word in `packages/spec/src`: 0 lines. "unit(s) of measure", `unitConfig`,
  `unitMode`, `sys_unit`, "UN/ECE" and "Recommendation 20" in `packages/` outside tests: 0 lines. No record under
  `docs/adr/` named units of measure before this one.
- **Three standard value domains, and a vocabulary that does not widen.**
  `packages/spec/src/shared/value-domain.zod.ts#ValueDomainSchema` has three members: `iana_time_zone`,
  `iso_4217_currency` and `iso_3166_alpha2`. The module header records the maintainer ruling of 2026-09-02 that "the
  vocabulary does not widen", and the rule that "a member earns its place by a metadata key that actually needs it,
  not by being a standard that exists". Its membership predicate,
  `packages/spec/src/shared/value-domain.zod.ts#isValueDomainMember`, "takes no I/O, holds no state, and reads no
  runtime service".
- **A separate code table beside the vocabulary.**
  `packages/spec/src/data/currency-fraction-digits.ts#CURRENCY_FRACTION_DIGITS` is a checked-in table keyed by
  currency code. Its key set is the `iso_4217_currency` membership list, and its values are data of their own (CLDR
  fraction digits), which the write-time home projection reads
  (`packages/objectql/src/home-amount-projection.ts`). U1 names this form: "a separate table, the way
  `CURRENCY_FRACTION_DIGITS` is".
- **Multi-currency, the pattern mirrored.** `packages/spec/src/data/field.zod.ts#CurrencyConfigSchema` declares
  `currencyMode` (`dynamic`, `fixed`, `record`), `defaultCurrency` (the one code of a `fixed` field), `currencyField`
  (a `record`-mode amount's pointer to a sibling code field, or, since ADR-0144's D2 amendment, a two-segment path
  through `master_detail`) and `homeAmount` (the stored home-currency projection). The value is a bare number in
  every mode.
- **An organization-owned system table.**
  `packages/platform-objects/src/system/sys-exchange-rate.object.ts#SysExchangeRate` declares no tenancy opt-out, "so
  `organization_id` is injected and the Layer 0 tenant wall (ADR-0095 D1) scopes every read and write". Its `rate`
  keeps `packages/platform-objects/src/system/sys-exchange-rate.object.ts#EXCHANGE_RATE_SCALE` (12) decimal places.
  U3 names this object as the model for `sys_unit`.
- **A backfill door.** `os migrate record-currency-codes` (`packages/cli/src/commands/migrate/record-currency-codes.ts`;
  engine side `packages/objectql/src/record-currency-backfill.ts#backfillRecordCurrencyCodes`) writes codes into a
  `record`-mode amount's code field; it is the backfill of ADR-0144's Open item 13. U7 R1 names it as the model for
  the unit backfill.
- **Decimal places on a number.** The `scale` key of `packages/spec/src/data/field.zod.ts#FieldSchema` declares a
  `number` field's decimal places and is enforced on writes. An absent `scale` declares no fixed width; consumers
  resolve the effective width through `packages/spec/src/data/field-scale.ts#resolveFieldScale`. U6 asks this record
  to state how a unit's decimal places interact with it ([L4](#l4--u6s-decimals-and-the-fields-scale)).

### 3. The pattern mirrored

This table maps ADR-0144's pieces to the ruled ones. It decides nothing; where it and [Decision](#decision) differ,
Decision wins.

| ADR-0144 (currency) | This record (units) |
|:--|:--|
| ISO 4217 membership, read from `CURRENCY_FRACTION_DIGITS`'s key set | U1: a closed constant of UN/ECE Rec 20 codes with dimension and ratio; a separate table, not a fourth value domain |
| `sys_exchange_rate`, organization-owned | U3: `sys_unit`, organization-owned, org-added units only, zero platform rows |
| `currencyConfig`: `fixed`, or `record` with `currencyField` (D2) | U4: a unit declaration on `number`: `fixed`, or `record` with a pointer to a sibling `text` field |
| The D2 amendment: an amount follows its parent through `master_detail` | Not admitted by this record; the spelling is reserved ([L3](#l3--u4s-key-spellings-and-following-a-parent)) |
| D8 rule 2: `currency_code` is a convention, never a contract | U4: `unit_code` is a convention, never a contract |
| The code field's `valueDomain`, judged by the pure predicate | U5: a new asynchronous write-path check over U1 and `sys_unit`; the predicate stays pure and unchanged |
| D6: a raw aggregate over a `record`-mode amount refuses unless grouped by its code field | U7 R1: the same refusal over a `record`-mode quantity and its unit field |
| Open item 13's backfill, `os migrate record-currency-codes` | U7 R1: a backfill door from free-text units to codes |
| D5: the home amount at write, stored with its rate; a missing rate refuses, no 1:1 or null fallback | U7 R2: the base quantity at write, stored with its factor; no ratio and no factor refuses, no 1:1 or null fallback |
| D7 parameter 4: `rate` at scale 12 | U7 R2: "Ratios are decimal, scale 12, never float." |
| No CEL `convertCurrency()` (D1, Non-goals) | U8: no formula conversion function |
| D4: the home currency locks once used | The ruling compares L1's question with it ([L1](#l1--the-ratio-lock)) |

## Decision

Every decision below is the ruling's text, quoted verbatim from the record `7001193034`. The U-labels are the
ruling's. A line outside a quotation is a cross-reference, never a decision.

### U1 — Standard list

> **U1 · Standard list.** A closed constant in `packages/spec` holds a curated subset of UN/ECE Rec 20 common codes,
> each with its dimension and its ratio to the dimension's base unit. It is a separate table, the way
> `CURRENCY_FRACTION_DIGITS` is (`packages/spec/src/data/currency-fraction-digits.ts`). It is **not** a fourth member
> of `ValueDomainSchema`, and the 2026-09-02 vocabulary stays closed. Package codes (Rec 21, admitted through the Rec
> 20 annex with the `X` prefix, e.g. `XBX`, `XPX`) are listed with a package dimension and no ratio. The constant is
> three things at once: the build-time oracle for fixed-unit fields, the source of truth for standard codes, and a
> pure conversion table.

### U2 — Piece

> **U2 · Piece.** The piece code is `H87`. Its near-synonyms `C62` and `EA` are not admitted.

### U3 — Organization units

> **U3 · Organization units.** `sys_unit` is organization-owned: `organization_id` is injected and it sits behind the
> tenant wall, like `sys_exchange_rate`. It holds org-added units only, and the platform ships zero rows. Org codes
> live in a reserved namespace, at least 4 characters or containing an underscore. Rec 20 codes are at most 3
> alphanumerics, so a later standard code cannot collide with an org code.

*Consequences of U3, not new rules* (the owning seat's settlement, 2026-11-19):

- `sys_unit` must be readable by members, so that a quantity's unit label displays to everyone who reads the
  quantity. `sys_exchange_rate`'s grant is not copied: an ordinary member neither reads nor writes that table
  (`packages/platform-objects/src/system/sys-exchange-rate.object.ts#SysExchangeRate`).
- Its label and documentation say "unit of measure" throughout. `sys_business_unit` and `sys_business_unit_member`
  already sit in the platform object list
  (`packages/spec/src/system/constants/platform-object-names.ts#PLATFORM_OBJECTS_BY_PACKAGE`), and the name
  `sys_unit` is ruled.

### U4 — Quantity shape

> **U4 · Quantity shape.** A `number` field gains a unit declaration that mirrors `currencyConfig`:
>
> - `fixed`: the unit is written in metadata and checked at build against U1.
> - `record`: a pointer names a sibling `text` field that holds each row's code.
> - An optional dimension restriction is allowed.
> - The value stays a bare number (ADR-0104 D1). The row stores the code, never an id, in exact uppercase.
> - The sibling field's name is a convention (`unit_code`), never a contract, as in ADR-0144 D8 rule 2.
> - The key spelling (proposed `unitConfig: { unitMode, unit, unitField, dimension }`) is the ADR's to fix.
> - Whether a unit may follow a parent through `master_detail`, as ADR-0144's D2 amendment allows for currency, is
>   also the ADR's to fix. A `lookup` path is not admitted.

The last two sub-bullets are settled under [L3](#l3--u4s-key-spellings-and-following-a-parent): the keys are
`unitConfig: { unitMode, unit, unitField, unitDimension }`, and following a parent through `master_detail` is not
admitted by this record.

### U5 — Membership at write

> **U5 · Membership at write.** A new write-path check admits a code in U1 or in the organization's `sys_unit` rows.
> It is asynchronous and reads rows, so it is not the `valueDomain` predicate, which stays pure and unchanged.

### U6 — Decimals

> **U6 · Decimals.** A unit's decimal places are an org-editable default, not platform-fixed: Rec 20 defines none,
> and BOM scrap quantities need decimals. The ADR states how this interacts with the field's `scale`.

The last sentence is [L4](#l4--u6s-decimals-and-the-fields-scale).

### U7 — Releases

> **U7 · Releases.**
>
> - **R1:**
>   - the membership check (U5)
>   - display of the value with its unit
>   - a build-time refusal of a raw aggregate over a `record`-mode quantity unless it groups by that quantity's unit
>     field (mirrors ADR-0144 D6)
>   - a backfill door that converts existing free-text units to codes (like `os migrate record-currency-codes`)
> - **R2:** write-time projection into a declared base-quantity field, stored with the factor used. The factor is the
>   dimension ratio from U1/`sys_unit`, or a suite-supplied factor named by pointer (`factorField`). With no ratio and
>   no factor, the write is refused; there is no 1:1 or null fallback (ADR-0144 D5). Affine units such as temperature
>   are excluded from ratio conversion. Ratios are decimal, scale 12, never float.

[Releases](#releases) restates the plan as a table.

### U8 — No formula conversion function

> **U8 · No formula conversion function.** A formula is virtual and cannot be totalled. No unit key ships ahead of
> the engine that reads it (ADR-0078; ADR-0144 D5).

## Left to this record

The ruling leaves three items to this record under "Left to the ADR", and U6's last sentence leaves a fourth. Each
section below states its question as ruled.

**PENDING: L1, L2 and L4.** Their settlement comes from the seat, with the maintainer's pick where an item is a
product choice; until then each states its question and nothing else. L3 is settled.

### L1 — The ratio lock

<!-- PENDING: settlement from the seat -->

> Whether an org unit's ratio locks once used, and how. "Used" means scanning every quantity table, which is costlier
> than the home-currency lock.

The home-currency lock it compares with is ADR-0144 D4.

### L2 — Organization-unit label translation

<!-- PENDING: settlement from the seat -->

> How org-unit labels are translated. No row-data translation mechanism was found.

### L3 — U4's key spellings, and following a parent

> The key spellings from U4.

The two sub-bullets of U4 that this item settles:

> - The key spelling (proposed `unitConfig: { unitMode, unit, unitField, dimension }`) is the ADR's to fix.
> - Whether a unit may follow a parent through `master_detail`, as ADR-0144's D2 amendment allows for currency, is
>   also the ADR's to fix. A `lookup` path is not admitted.

**Settled on 2026-11-19 by the owning seat (repo:objectstack#5), as a technical item.** This is the seat's
settlement of what the ruling handed to this record, not ruling text. One change from the ruling's proposal:
`dimension` becomes `unitDimension`.

```ts
unitConfig: {
  unitMode: 'fixed' | 'record',   // required; no default
  unit: 'KGM',                    // `fixed` only, and required there: a U1 code in exact uppercase
  unitField: 'unit_code',         // `record` only, and required there: one segment in this record
  unitDimension: 'mass',          // `record` only, optional
}
```

The values are illustrations: which codes U1 holds, and the dimension vocabulary, are [Open item](#open-items) 2.

- **The mirror.** `unitConfig`, `unitMode` and `unitField` mirror `currencyConfig`, `currencyMode` and
  `currencyField` (`packages/spec/src/data/field.zod.ts#CurrencyConfigSchema`). `unitMode`'s two values reuse `fixed`
  and `record` with the meaning they have there.
- **`unitMode` is required and has no default.** `currencyMode` defaults to `dynamic` because an absent config
  already means the tenant currency. No tenant unit exists, and the platform does not guess one.
- **`unit`, not `defaultUnit`.** `defaultCurrency` is a recorded misnomer: it once defaulted to `'CNY'`, and under
  `fixed` it is the field's one currency, not a default (the docblock above `CurrencyConfigSchema`). On the field
  surface `default*` means a value applied on insert (`packages/spec/src/data/field.zod.ts#defaultValue`), so
  `defaultUnit` would read as a pre-fill for `record` mode, which is a different feature.
- **`unitDimension`, not `dimension`.** `dimension` already means a group-by axis in the analytics schemas
  (`packages/spec/src/api/analytics.zod.ts#dimension`, `packages/spec/src/data/analytics.zod.ts#dimension`,
  `packages/spec/src/ui/dashboard.zod.ts#dimension`), and U7 R1's aggregate rule ("unless it groups by that
  quantity's unit field") is stated in that sense. The bare word would carry two meanings in one record.
- **Cross-refusals**, mirroring `packages/spec/src/data/field.zod.ts#refuseRecordModeKeyMismatch`: `fixed` requires
  `unit` and refuses `unitField` and `unitDimension` (U1 already gives a fixed code its dimension); `record` requires
  `unitField` and refuses `unit`.
- **Refusal prescriptions**, as `aliases` rows, which are did-you-mean answers and never accepted spellings
  (`packages/spec/src/shared/strict-object.ts#strictObject`). Inside `unitConfig`: `mode` to `unitMode`;
  `defaultUnit`, `unitCode`, `code` and `uom` to `unit`; `field` and `codeField` to `unitField`; `dimension` to
  `unitDimension`. On the field itself, prose guidance for a bare `unit`, `uom`, `unitCode` or `dimension` key, the
  form the guidance for a bare `currency` key takes.
- **Read on `type: 'number'` only** (U4). On `formula` and `summary` the declaration is refused until a reader exists
  (U8). So a roll-up of a `fixed`-unit quantity shows a bare number; the gap is declared here, not discovered later.
- **The object door.** `unitField` names a `text` field of the same object. That field carries no marker, because U1
  is not a value domain (ruled); the pointer is the declaration. Two quantities that share one unit field must not
  declare different `unitDimension` values, the check `packages/spec/src/data/object.zod.ts#refuseDishonestHomeAmount`
  makes for amounts that share a rate field.
- **No numeric key at `unitConfig`'s top level.** `check:duration-unit-keys` exempts a numeric key that has a sibling
  literally named `unit` (`packages/spec/scripts/check-duration-unit-keys.ts#collectDurationKeys`). A later R2 block
  is an object of its own, as `homeAmount` is.

**Following a parent through `master_detail` is not admitted by this record; the spelling is reserved.**

- A two-segment `unitField` is refused at the object door, with a message saying that a child cannot follow its
  parent's unit yet. The reserved form is currency's, `PARENT_FIELD.UNIT_FIELD` through a `master_detail` field. A
  `lookup` path stays refused (U4).
- No named shape pulls it. The card's shapes are a sibling code on the row (`srm_material.uom`,
  `srm_delivery_record.uom`) or an order line that follows its product, which is a `lookup` and refused by U4. This
  reads the card's description; the suites' source was not read.
- For currency the same path took a ruling of its own, a lock on the parent's code field, three child cards and new
  readers in the engine (ADR-0144, the D2 and D6 amendments), and two edges of ADR-0144's Open item 14 are still open.
- In R1, a `summary` over `record`-mode child quantities is therefore always refused, as every such currency roll-up
  was before ADR-0144's D6 amendment
  (`packages/objectql/src/record-currency-aggregate-door.ts#recordCurrencySummaryRefusal` is the currency
  counterpart). A parent whose children all share its unit cannot say so until an amendment admits the path.
- Precedent for adding it later: ADR-0144 was accepted on 2026-10-28 and amended on 2026-11-09 to admit the same
  path for currency.

### L4 — U6's decimals and the field's `scale`

<!-- PENDING: settlement from the seat -->

> The ADR states how this interacts with the field's `scale`.

From U6, where "this" is "A unit's decimal places are an org-editable default, not platform-fixed". The ruling's
"Left to the ADR" list does not name this sentence; U6's own text hands it to this record, so it is held here beside
the three.

## Releases

U7 is the ruled plan; this table restates it and adds nothing.

| Release | Member, in U7's words | Mirrors |
|:--|:--|:--|
| R1 | "the membership check (U5)" | ADR-0144's code-field `valueDomain`, with rows read (U5) |
| R1 | "display of the value with its unit" | ADR-0144's per-row display |
| R1 | "a build-time refusal of a raw aggregate over a `record`-mode quantity unless it groups by that quantity's unit field" | ADR-0144 D6 |
| R1 | "a backfill door that converts existing free-text units to codes" | `os migrate record-currency-codes` |
| R2 | "write-time projection into a declared base-quantity field, stored with the factor used" | ADR-0144 D5 |

- U7 lists the readers of each release, not the declarations they read: U1's constant, U3's `sys_unit` and U4's unit
  declaration. U8 binds each key to its reader: "No unit key ships ahead of the engine that reads it" ([Open
  items](#open-items) 7).
- The ruling's "Next": "An ADR records U1–U8. The R1 cards follow it."
- Suite adoption is no release's member ([Non-goals](#non-goals)).

## Consequences

- **The value-domain vocabulary keeps three members** (U1). Units are a separate constant, and U5's check is a new
  check beside `isValueDomainMember`, which stays pure and unchanged.
- **The declaration is additive.** U4 adds a unit declaration to `number`; a `number` field that declares no unit is
  not touched by any decision here.
- **A new organization-owned system object, `sys_unit`,** behind the tenant wall like `sys_exchange_rate`, with zero
  platform rows (U3), readable by members (the notes under U3).
- **A child quantity cannot follow its parent's unit** in this record (L3). A `summary` over `record`-mode child
  quantities is refused until an amendment admits the reserved path.
- **A write that U5 guards reads rows.** U5's check "is asynchronous and reads rows".
- **No standard code can ever collide with an organization code** (U3): org codes are at least 4 characters or carry
  an underscore, and Rec 20 codes are at most 3 alphanumerics.
- **A stored unit is a code, never an id** (U4), in exact uppercase.
- **R2 refuses rather than guesses** (U7 R2): with no ratio and no factor, the write is refused; affine units take no
  ratio conversion.

## Non-goals

As ruled, under "Out of scope":

> - **Item pack tables:** the suites own them; R2 reads their factor by pointer.
> - **ERP unit-master sync:** `sys_unit` is not a `synced` target (ADR-0153). ERP code mapping is connector or suite
>   work.
> - **hotsrm / hotcrm adoption:** deferred by this ruling.

Also outside this record:

- A formula conversion function (U8).
- Ratio conversion of affine units such as temperature (U7 R2).
- From the card's body, not restated by the ruling and not contradicted by it: "Inventory, costing and valuation stay
  with the suites and the ERP" and "No suite-side migration is in scope; each suite adopts the result in its own
  repo."

## Open items

The ruling does not decide the items below, and this record does not settle them. Items 2–7 belong to the card that
builds the piece, settled under that card's review; this record is amended with each answer, the way ADR-0144's open
items were.

1. **[L1](#l1--the-ratio-lock), [L2](#l2--organization-unit-label-translation) and
   [L4](#l4--u6s-decimals-and-the-fields-scale)**, pending in this draft.
2. **U1's membership.** Which Rec 20 common codes the curated subset holds, each one's dimension and ratio, and which
   package codes it lists. U2 fixes one code (`H87`) and refuses two (`C62`, `EA`).
3. **`sys_unit`'s owning package, and its fields** beyond what U3, U6 and U7 R2 name, against
   [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D1, D3 and D6. ADR-0144 D3 left
   `sys_exchange_rate`'s owner to its card the same way.
4. **The codes of the new refusals**: U5's membership refusal, U7 R1's aggregate refusal and U7 R2's refusal of a
   write with no ratio and no factor. [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) sets their codes and
   envelope.
5. **R2's key spellings.** U7 R2 names `factorField`, the pointer to a suite-supplied factor: an input, written by
   the suite. The field where the engine stores "the factor used" is an output, engine-written and `readonly`, the
   counterpart of `homeAmount.rateField` (`packages/spec/src/data/field.zod.ts#HomeAmountSchema`). The input pointer
   and the output field get two different names (the owning seat's settlement, 2026-11-19). The rest of the R2
   block's spelling, the base-quantity field's declaration included, is the R2 card's, the way ADR-0144 left
   `rateDate` and `rateField` to its card.
6. **How R2 rounds a projected base quantity.** Not ruled.
7. **The release of each declaration.** U7 lists readers; U8 binds each key to its reader's release
   ([Releases](#releases)).

## Verification notes

Each reading below was taken at `3819afec`. To re-check one, run its command on a newer `origin/main`; the comment
says what the command printed at `3819afec`.

```bash
git grep -n -i -w uom -- packages/spec/src                                                                      # 0 lines
git grep -n -i -E 'unit(s)? of measure|unitConfig|sys_unit|unitMode|UN/?ECE|Recommendation 20' -- packages ':!*.test.ts'   # 0 lines
git grep -c -i -w currency -- packages/spec/src/data/field.zod.ts                                               # 106 (the control)
git grep -n -E "^  '(iana_time_zone|iso_4217_currency|iso_3166_alpha2)',$" -- packages/spec/src/shared/value-domain.zod.ts   # 3 lines
git grep -n "vocabulary does not widen" -- packages/spec/src/shared/value-domain.zod.ts                         # 1 line
git grep -n "name: 'sys_exchange_rate'" -- packages/platform-objects/src                                        # 1 line
```

## References

- Ruling record: [#35339 `7001193034`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001193034).
- Regrades ordering this record:
  [#35339 `7001211414`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001211414),
  [#35339 `7001212970`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001212970).
- Card: [#35339](https://github.com/objectstack-ai/objectstack/issues/35339).
- Cross-suite master data: [#35328](https://github.com/objectstack-ai/objectstack/issues/35328), ruling A
  [`7000155587`](https://github.com/objectstack-ai/objectstack/issues/35328#issuecomment-7000155587) and its linkage
  follow-up [`7000955097`](https://github.com/objectstack-ai/objectstack/issues/35328#issuecomment-7000955097).
- Records: [ADR-0144](./0144-multi-currency-record-currency-dated-rates-write-time-home-projection.md),
  [ADR-0104](./0104-field-runtime-value-shape-contract.md), [ADR-0049](./0049-no-unenforced-security-properties.md),
  [ADR-0078](./0078-no-silently-inert-metadata.md), [ADR-0153](./0153-one-way-sync-in-beside-federation.md),
  [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md),
  [ADR-0112](./0112-error-code-vocabulary-and-ledger.md).
