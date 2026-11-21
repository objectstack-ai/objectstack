# ADR-0158: Units of measure — a closed standard unit table in the spec, organization-owned units, a quantity field that names its unit, and a base quantity stored at write

**Status**: Accepted — 2026-11-19, ruled on objectstack#35339 (ruling record [`7001193034`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001193034), maintainer 「先不考虑 hotsrm，先处理平台任务，你的意见我同意」); L1 picked by the maintainer the same day on a decision card, option A 「可改，只影响以后」 (ruling record [`7003532733`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7003532733)), and the rest of L1 and L2 settled by the owning seat, per the analysis recommendation. `docs/adr/**` is Tier H (Prime Directive #14): this record lands by an authorised approval and the maintainer's merge. **This record declares; it implements nothing** — no schema, no code, no changeset. The R1 cards follow it, as the ruling's "Next" says. · **Amended** (2026-11-20, [#35489](https://github.com/objectstack-ai/objectstack/issues/35489) and [#35492](https://github.com/objectstack-ai/objectstack/issues/35492), under the owning seat's contract review): L3 records the `unitConfig` key as shipped, and Open items 3, 6, 8, 9, 11 and 12 carry the R1 settlements of the membership card and the backfill card.

- **Date**: 2026-11-19
- **Decided by**: the maintainer, 2026-11-19T06:01:58Z, in the design discussion for #35339, verbatim and untranslated:
  「先不考虑 hotsrm，先处理平台任务，你的意见我同意」. The ruling record
  [`7001193034`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7001193034) reads 「你的意见」
  as the recommendation it carries: "It was reviewed adversarially before it went to the maintainer, and he accepted
  it as recommended on each of its three questions". The record's own text is the authority this ADR executes; where
  the two differ, the record wins and this ADR is corrected. On L1 the maintainer picked option A on a decision card
  at 2026-11-19T08:11Z; the maintainer's own words there are 「可改，只影响以后」 and nothing else. Ruling record
  [`7003532733`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7003532733) records that card
  and writes the pick out further, with an answer to L2. What it adds beyond those words is the owning seat's
  settlement, per the analysis recommendation, and [L1](#l1--the-ratio-lock) and
  [L2](#l2--organization-unit-label-translation) mark each part.
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
   sentence. Each is a section of [Left to this record](#left-to-this-record) that states the question as ruled. L1
   carries the maintainer's pick, in the maintainer's own words 「可改，只影响以后」. The rest of L1, and all of L2,
   is the owning seat's settlement per the analysis recommendation, quoted verbatim from the ruling record
   `7003532733` and marked as such. L3 and L4 carry the owning seat's settlement, marked as such. The notes under U3
   are the same seat's settlement; the first of them adds a read grant to the member baseline. Two
   [Open items](#open-items), 8 and 10, owe the maintainer a ruling.
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
  to state how a unit's decimal places interact with it; [L4](#l4--u6s-decimals-and-the-fields-scale) settles it.

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
| Open item 13's backfill, `os migrate record-currency-codes` | U7 R1: a backfill door from free-text units to codes; a looser mirror ([Open item](#open-items) 12) |
| D5: the home amount at write, stored with its rate; a missing rate refuses, no 1:1 or null fallback | U7 R2: the base quantity at write, stored with its factor; no ratio and no factor refuses, no 1:1 or null fallback |
| D7 parameter 4: `rate` at scale 12 | U7 R2: "Ratios are decimal, scale 12, never float." |
| No CEL `convertCurrency()` (D1, Non-goals) | U8: no formula conversion function |
| D4: the home currency locks once used | Not mirrored: an org unit's ratio stays editable, and an edit affects later writes only ([L1](#l1--the-ratio-lock)) |
| D5's third bullet: a corrected rate reaches stored rows only through "an explicit recompute operation" (`os migrate recompute-home-amounts`); D7 parameter 2: organization admins only edit `sys_exchange_rate` | The seat's L1 settlement: stored rows change only through an explicit recompute, and only an organization admin edits a ratio ([L1](#l1--the-ratio-lock)) |

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

*Settled by the seat under U3* (the owning seat's settlement, 2026-11-19, not ruling text). The first note is a new
rule: a read grant on the member baseline for a new system object.

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

The last sentence is settled under [L4](#l4--u6s-decimals-and-the-fields-scale): the field's `scale` governs storage
and is the ceiling, and a unit's decimal places are only its display default.

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

All four are settled, and each part says whose it is. L1's core is the maintainer's pick, in the maintainer's own
words 「可改，只影响以后」. The rest of L1, and L2, are the owning seat's settlement per the analysis recommendation. L3
and L4 were technical and carry the owning seat's settlement.

### L1 — The ratio lock

> Whether an org unit's ratio locks once used, and how. "Used" means scanning every quantity table, which is costlier
> than the home-currency lock.

The home-currency lock it compares with is ADR-0144 D4. The decision card put the question as
「自定义单位的换算比例，用过以后还能不能改」, and with it what deleting a used org unit does.

**Picked by the maintainer**: maintainer decision card, 2026-11-19T08:11Z, option A 「可改，只影响以后」. Those words
are the maintainer's whole text on the card. Read plainly: an org unit's ratio can be changed, and a change affects
only what comes after.

**Ruling record [`7003532733`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7003532733)
writes option A out as below.** Verbatim:

> - **1A.** An org unit's ratio may be edited at any time and affects later writes only. Stored rows keep their
>   quantity and the factor they were converted with; they change only through an explicit recompute that previews
>   first and writes on confirmation. Only an organization admin edits a ratio; the edit is audited (field history, as
>   for exchange-rate rows), and the UI states that an edit affects only records saved afterwards ("a changed
>   specification is a new unit, not an edited ratio").
> - **Delete under 1A's terms:** deleting an org unit is allowed. Old rows keep their code and stored conversion and
>   show the code without a label; a new save with that code is refused (the row's quantity must move to an existing
>   unit first).
> - **Under every option (technical, settled by the ADR):** a unit's code and dimension are immutable after create.

Whose each part is:

- **The maintainer's pick**, in the record's wording of 「可改，只影响以后」: "An org unit's ratio may be edited at any
  time and affects later writes only. Stored rows keep their quantity and the factor they were converted with".
- **Settled by the seat, per the analysis recommendation**, not the maintainer's words:
  - the recompute: "they change only through an explicit recompute that previews first and writes on confirmation";
  - the admin edit and its audit: "Only an organization admin edits a ratio; the edit is audited (field history, as
    for exchange-rate rows)";
  - the UI sentence: "the UI states that an edit affects only records saved afterwards ("a changed specification is a
    new unit, not an edited ratio")";
  - the delete: the whole "Delete under 1A's terms" bullet.
- **Settled by the seat, as a technical item**: the "Under every option" bullet, that a unit's code and dimension are
  immutable after create. It holds for a unit row; it does not hold across a delete and a new create of the same
  code ([Open item](#open-items) 11).

So no ratio lock exists, and no quantity table is scanned for "used". An edited old row is left to a later card,
R2's ([Open item](#open-items) 5).

### L2 — Organization-unit label translation

> How org-unit labels are translated. No row-data translation mechanism was found.

The decision card put the question as 「自定义单位的名称要不要多语言」.

**Settled by the seat, per the analysis recommendation.** The maintainer's own words on the card are
「可改，只影响以后」 (L1). Ruling record
[`7003532733`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7003532733) records 2A as picked
on the same card; beyond those words it is the seat's settlement, not the maintainer's text. Verbatim:

> - **2A.** One label per org unit, written by the org in its own language; translation of org-unit labels is
>   deferred to its own card (filed as a sub-issue of this card, p3). Standard U1 codes get a platform-shipped
>   per-locale label table.

The deferred card is [#35404](https://github.com/objectstack-ai/objectstack/issues/35404).

### L3 — U4's key spellings, and following a parent

> The key spellings from U4.

The two sub-bullets of U4 that this item settles:

> - The key spelling (proposed `unitConfig: { unitMode, unit, unitField, dimension }`) is the ADR's to fix.
> - Whether a unit may follow a parent through `master_detail`, as ADR-0144's D2 amendment allows for currency, is
>   also the ADR's to fix. A `lookup` path is not admitted.

**Settled on 2026-11-19 by the owning seat (repo:objectstack#5), as a technical item.** This is the seat's
settlement of what the ruling handed to this record, not ruling text. One change from the ruling's proposal:
`dimension` becomes `unitDimension`.

*Amended (2026-11-20):* built by the membership card
([#35489](https://github.com/objectstack-ai/objectstack/issues/35489)). The key shipped as the union below, which
replaces the block settled here; Open item 8's ruling adds its third member. The three bullets after
**Cross-refusals** record what shipped.

```ts
unitConfig:
  | { unitMode: 'fixed';  unit: 'KGM' }                                     // on `number`: one U1 code, exact uppercase, checked at build
  | { unitMode: 'record'; unitField: 'unit_code'; unitDimension?: 'mass' }  // on `number`: one segment, a sibling `text` field
  | { unitMode: 'code';   unitDimension?: 'count' }                         // on `text`: Open item 8, the field holds a unit code itself
```

The values are illustrations: which codes U1 holds, and the dimension vocabulary, are [Open item](#open-items) 1.

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
- **Shipped as a discriminated union of three closed shapes**
  (`packages/spec/src/data/field.zod.ts#UnitConfigSchema`). The discriminator is required, so each mode's keys belong
  to its own variant, and the rule reaches the published JSON Schema as a `oneOf`. `currencyConfig` cannot take this
  form because its discriminator has a default. A key of another mode is refused, with guidance naming the mode it
  belongs to. Inside the config, `mode`, `defaultUnit`, `unitCode`, `code`, `uom`, `field`, `codeField` and
  `dimension` are answered with the spelling this record uses, each in the variant that holds its target key.
- **Which type carries which mode**: `fixed` and `record` on a `number`, `code` on a `text`. Every other type is
  refused, including `currency`, `formula` and `summary` (U8: no reader). A bare `unit`, `uom`, `unitCode` or
  `dimension` key on a field is refused, with guidance naming `unitConfig`.
- **The object door** (`packages/spec/src/data/object.zod.ts#refuseDishonestRecordUnitField`, beside the currency one)
  refuses a `record` pointer that:
  - names no declared field;
  - names its own field;
  - names a field that is not `text`;
  - names a field that carries its own `unitConfig` ("the pointer is the declaration");
  - names a `text` field that declares a `valueDomain` (a second vocabulary for the same column, the pairing
    FieldSchema refuses beside the `code` marker);
  - holds a dot (the `master_detail` path this record does not admit; "a child cannot follow its parent's unit yet").

  It also refuses two quantities that share one unit field with different `unitDimension` values.
- **Refusal prescriptions**, as `aliases` rows, which are did-you-mean answers and never accepted spellings
  (`packages/spec/src/shared/strict-object.ts#strictObject`). Inside `unitConfig`: `mode` to `unitMode`;
  `defaultUnit`, `unitCode`, `code` and `uom` to `unit`; `field` and `codeField` to `unitField`; `dimension` to
  `unitDimension`. On the field itself, prose guidance for a bare `unit`, `uom`, `unitCode` or `dimension` key, the
  form the guidance for a bare `currency` key takes.
- **Read on `type: 'number'` only** (U4; *amended 2026-11-20*: `code` on a `text` joins it, Open item 8). On `formula` and `summary` the declaration is refused until a reader exists
  (U8). So a roll-up of a `fixed`-unit quantity shows a bare number; the gap is declared here, not discovered later.
- **The object door** (as settled; *amended 2026-11-20*: the shipped door is the bullet after **Cross-refusals**). `unitField` names a `text` field of the same object. That field carries no marker, because U1
  is not a value domain (ruled); the pointer is the declaration. Two quantities that share one unit field must not
  declare different `unitDimension` values, the check `packages/spec/src/data/object.zod.ts#refuseDishonestHomeAmount`
  makes for amounts that share a rate field. A field that holds a unit code with no quantity pointing at it is left
  outside this door: [Open item](#open-items) 8.
- **No numeric key at `unitConfig`'s top level.** `check:duration-unit-keys` exempts a numeric key that has a sibling
  literally named `unit` (`packages/spec/scripts/check-duration-unit-keys.ts#collectDurationKeys`). A later R2 block
  is an object of its own, as `homeAmount` is.

**Following a parent through `master_detail` is not admitted by this record; the spelling is reserved.**

- A two-segment `unitField` is refused at the object door, with a message saying that a child cannot follow its
  parent's unit yet. The reserved form is currency's, `PARENT_FIELD.UNIT_FIELD` through a `master_detail` field. A
  `lookup` path stays refused (U4).
- No named shape pulls it. The card's shapes are a code on the row (`srm_material.uom`, `srm_delivery_record.uom`)
  or an order line that follows its product, which is a `lookup` and refused by U4. This reads the card's
  description; the suites' source was not read. A material's own unit may have no quantity beside it
  ([Open item](#open-items) 8).
- For currency the same path took a ruling of its own, a lock on the parent's code field, three child cards and new
  readers in the engine (ADR-0144, the D2 and D6 amendments), and two edges of ADR-0144's Open item 14 are still open.
- In R1, a `summary` over `record`-mode child quantities is therefore always refused, as every such currency roll-up
  was before ADR-0144's D6 amendment
  (`packages/objectql/src/record-currency-aggregate-door.ts#recordCurrencySummaryRefusal` is the currency
  counterpart). A parent whose children all share its unit cannot say so until an amendment admits the path.
- Precedent for adding it later: ADR-0144 was accepted on 2026-10-28 and amended on 2026-11-09 to admit the same
  path for currency.

### L4 — U6's decimals and the field's `scale`

> The ADR states how this interacts with the field's `scale`.

From U6, where "this" is "A unit's decimal places are an org-editable default, not platform-fixed". The ruling's
"Left to the ADR" list does not name this sentence; U6's own text hands it to this record, so it is held here beside
the three.

**Settled on 2026-11-19 by the owning seat (repo:objectstack#5), as a technical item.** This is the seat's
settlement, not ruling text:

> The field's `scale` governs storage and is the ceiling. A unit's decimal places (U6, org-editable) are only the
> display default for that unit and never exceed the field's `scale`. Nothing is rounded at write by a unit's decimal
> places. In R2, the projected base quantity rounds to the base field's `scale`.

The `scale` it names is the existing key, enforced on writes of a `number` field
([Context](#2-what-the-platform-has-today-read-at-3819afec) §2). A field that declares no `scale`, and what the
display default does at render, are [Open item](#open-items) 6. For a standard code, a unit's org-editable decimal
places have no home: [Open item](#open-items) 10.

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
  platform rows (U3), readable by members (the seat's settlement under U3, a new read grant on the member baseline).
  Who creates, relabels and deletes an org unit is [Open item](#open-items) 2.
- **A child quantity cannot follow its parent's unit** in this record (L3). A `summary` over `record`-mode child
  quantities is refused until an amendment admits the reserved path.
- **A write that U5 guards reads rows.** U5's check "is asynchronous and reads rows".
- **No standard code can ever collide with an organization code** (U3): org codes are at least 4 characters or carry
  an underscore, and Rec 20 codes are at most 3 alphanumerics.
- **A stored unit is a code, never an id** (U4), in exact uppercase.
- **A unit's decimal places never round a stored value** (L4). The field's `scale` governs storage; a unit's decimal
  places only set how its values display. R2's base quantity rounds to the base field's `scale`.
- **R2 refuses rather than guesses** (U7 R2): with no ratio and no factor, the write is refused; affine units take no
  ratio conversion.
- **An org unit's ratio never locks** (L1, the maintainer's pick). An edit affects later writes only, and stored rows
  keep their quantity and factor. Settled by the seat: they change only through an explicit recompute that previews
  first, and only an organization admin edits a ratio, audited.
- **A unit row's code and dimension cannot change after create** (L1, settled by the seat). A deleted code can be
  created again with another dimension; what that does to resting rows is [Open item](#open-items) 11.
  *Note (2026-11-19):* Open item 11 is settled: a deleted code stays retired, and the retired row keeps its code, so it
  is never created again.
- **A deleted org unit leaves its rows readable** (L1, settled by the seat): they keep their code and stored
  conversion and show the code without a label, and a new save with that code is refused. Which writes count as such
  a save is [Open item](#open-items) 9.
- **An org unit has one label** (L2, settled by the seat), in the organization's own language; standard codes get
  per-locale labels shipped by the platform.

## Non-goals

As ruled, under "Out of scope":

> - **Item pack tables:** the suites own them; R2 reads their factor by pointer.
> - **ERP unit-master sync:** `sys_unit` is not a `synced` target (ADR-0153). ERP code mapping is connector or suite
>   work.
> - **hotsrm / hotcrm adoption:** deferred by this ruling.

Also outside this record:

- A formula conversion function (U8).
- Ratio conversion of affine units such as temperature (U7 R2).
- Translation of organization-unit labels, deferred to
  [#35404](https://github.com/objectstack-ai/objectstack/issues/35404) (L2, settled by the seat).
- From the card's body, not restated by the ruling and not contradicted by it: "Inventory, costing and valuation stay
  with the suites and the ERP" and "No suite-side migration is in scope; each suite adopts the result in its own
  repo."

## Open items

The rulings do not decide the items below, and this record does not settle them. Items 8 and 10 each sit between two
ruled clauses, so a card cannot settle either without reading ruled text down: each owes the maintainer a ruling
first. Every other item belongs to the card that builds the piece, settled under that card's review. This record is
amended with each answer, the way ADR-0144's open items were.

1. **U1's membership.** Which Rec 20 common codes the curated subset holds, each one's dimension and ratio, and which
   package codes it lists. U2 fixes one code (`H87`) and refuses two (`C62`, `EA`).
   *Note (2026-11-19):* settled on the `sys_unit` card
   ([#35488](https://github.com/objectstack-ai/objectstack/issues/35488)), under the owning seat's contract review; the
   table is `packages/spec/src/data/standard-units.ts#STANDARD_UNITS`, 41 codes. Seven dimensions, the closed
   vocabulary `UNIT_DIMENSIONS`; each ratio dimension has a base unit (`UNIT_DIMENSION_BASE_CODES`), whose ratio is
   `1`. The ratio reads `1 CODE = ratio × BASE`, so a quantity converts to the base unit by multiplying it by the
   ratio. Every ratio is a decimal string of at most 12 places, exact by definition:

   | Dimension | Base | Members, with ratio |
   |:--|:--|:--|
   | `mass` | `KGM` | `GRM` 0.001, `MGM` 0.000001, `TNE` 1000, `LBR` 0.45359237, `ONZ` 0.028349523125 |
   | `length` | `MTR` | `MMT` 0.001, `CMT` 0.01, `KMT` 1000, `INH` 0.0254, `FOT` 0.3048, `YRD` 0.9144 |
   | `area` | `MTK` | `CMK` 0.0001, `MMK` 0.000001, `FTK` 0.09290304 |
   | `volume` | `MTQ` | `LTR` 0.001, `MLT` 0.000001, `GLL` 0.003785411784 |
   | `time` | `SEC` | `MIN` 60, `HUR` 3600, `DAY` 86400, `WEE` 604800 |
   | `count` | `H87` | `PR` 2, `DZN` 12 |
   | `package` | none | `XBG`, `XBE`, `XBO`, `XBX`, `XCT`, `XCS`, `XCR`, `XDR`, `XPK`, `XPX`, `XRO`, `XSA`; no ratio |

   Sources: the SI prefixes (`GRM`, `MGM`, `MMT`, `CMT`, `KMT`, `CMK`, `MMK`, `MLT`) and the units accepted for use with
   the SI (`TNE`, `LTR`, `MIN`, `HUR`, `DAY`), SI Brochure 9th edition, Tables 7 and 8; the international yard and
   pound of 1959 (`LBR`, `ONZ` as 1/16 lb, `INH`, `FOT`, `YRD`, `FTK`); the United States gallon of 231 cubic inches
   (`GLL`); Recommendation 20's own factor (`WEE`, `PR`, `DZN`). Recommendation 20 prints `ONZ` and `GLL` rounded
   (2.834 952 × 10⁻² kg, 3.785 412 × 10⁻³ m³); the table holds the exact values. Left out: hectare (`HAR`), which
   Recommendation 20 marks deprecated; month (`MON`) and year (`ANN`), whose Recommendation 20 factors rest on a
   365.25-day year that no calendar month or year equals; and every affine unit (U7 R2). The dimension is named
   `count`, not `piece`: a pair and a dozen are counts measured in pieces, as a gram is a mass measured in kilograms.
   Codes, names, statuses and factors were read from the Recommendation 20 annex (the `datasets/unece-units-of-measure`
   mirror, data package 17.0) and the package codes from the Peppol BIS Billing 3.0 list `UNECERec20` ("including
   Recommendation 21 codes - prefixed with X", Revision 11e). The organization namespace of U3 is the same file's
   `ORGANIZATION_UNIT_CODE_PATTERN`: uppercase letters, digits and underscores, starting with a letter or a digit, at
   most 32 characters, at least 4 long or containing an underscore. The table widens only by an amendment of this
   record.
2. **`sys_unit`'s owning package, its fields and its write grants.** Its fields beyond what U3, U6, U7 R2, L1 and L2
   name, against [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D1, D3 and D6.
   ADR-0144 D3 left `sys_exchange_rate`'s owner to its card the same way. Its write grants: who creates, relabels and
   deletes an org unit. The seat's L1 settlement names only who edits a ratio, and a delete is the act L1 attaches
   refusals to.
   *Note (2026-11-19):* settled on the `sys_unit` card
   ([#35488](https://github.com/objectstack-ai/objectstack/issues/35488)), under the owning seat's contract review,
   answering [#35465](https://github.com/objectstack-ai/objectstack/issues/35465).
   - **Owner: `@objectstack/platform-objects`**
     (`packages/platform-objects/src/system/sys-unit.object.ts#SysUnit`), registered in its first manifest beside
     `sys_exchange_rate`. ADR-0029 D3 asks for one owner per object, and this is the only one. Its readers are the
     engine's write-time membership check (U5) and the display of a quantity with its unit, present in every
     composition that can write or read a record, so it has no on/off boundary of its own (D2) and no capability plugin
     (D1) would own it; it joins the per-organization reference table ADR-0144's Open item 11 settled into the same
     package. D6's decomposition, when it comes, moves both together.
   - **Fields:** `code` (text, at most 32, required, unique per organization, in U3's namespace, immutable after
     create); `label` (text, at most 80, required: L2's one org-written label); `dimension` (select over U1's closed
     vocabulary, required, immutable after create); `ratio` (number, scale 12, precision 24, at least 10⁻¹², required
     on every dimension but `package` and refused on `package`, U1's shape; editable, an edit affecting later writes
     only, L1); `decimal_places` (whole number 0 to 12, optional, the display default of U6, never a storage rule, L4);
     `retired` (boolean, default false, Open item 11). `organization_id` is injected (U3). Every authored column
     carries field history.
   - **Grants:** every member reads (`member_default` names `sys_unit`, read only; the seat's first U3 note). An
     organization owner or administrator creates, relabels, edits a ratio and retires a unit, through
     `organization_admin`'s wildcard grant, the way `sys_exchange_rate` is written; no member holds a write bit. No one
     deletes: retiring is the delete (Open item 11).
3. **The codes of the new refusals**: U5's membership refusal, U7 R1's aggregate refusal, U7 R2's refusal of a write
   with no ratio and no factor, and the refusal of a new save with a deleted org unit's code (L1, settled by the
   seat). [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) sets their codes and envelope.
   *Note (2026-11-20):* settled on the membership card
   ([#35489](https://github.com/objectstack-ai/objectstack/issues/35489)), with one code per remedy, as
   `ERR_HOME_CURRENCY_UNSET` stands beside `ERR_EXCHANGE_RATE_MISSING`. Each is registered in the ADR-0112 ledger
   under `@objectstack/objectql`:
   - `ERR_UNIT_CODE_REQUIRED`: a quantity beside a blank code;
   - `ERR_UNIT_CODE_UNKNOWN`: a code that is neither a U1 code nor one of the organization's units; when it differs
     from one only in case or surrounding spaces, that exact spelling is named, and `C62` or `EA` is pointed to `H87`;
   - `ERR_UNIT_CODE_RETIRED`: L1's "a new save with that code is refused";
   - `ERR_UNIT_DIMENSION_MISMATCH`: a member of a dimension other than the declared `unitDimension`;
   - these four answer 400. `ERR_UNIT_DELETE_REFUSED` answers 405, the status the data door already answers for the
     same verb on `sys_unit`; its suffix follows `EXTERNAL_WRITE_REFUSED`.

   U7 R1's aggregate refusal and U7 R2's no-ratio refusal stay with their cards
   ([#35491](https://github.com/objectstack-ai/objectstack/issues/35491), R2).
4. **R2's key spellings, its arithmetic and its base field.** U7 R2 names `factorField`, the pointer to a
   suite-supplied factor: an input, written by the suite. The field where the engine stores "the factor used" is an
   output, engine-written and `readonly`, the counterpart of `homeAmount.rateField`
   (`packages/spec/src/data/field.zod.ts#HomeAmountSchema`). The input pointer and the output field get two different
   names (the owning seat's settlement, 2026-11-19). The rest of the R2 block's spelling, the base-quantity field's
   declaration included, is the R2 card's, the way ADR-0144 left `rateDate` and `rateField` to its card. The same card
   states, as arithmetic, which way U1's ratio and a suite-supplied factor point; ADR-0144 D7 had to add "Parameter 3
   as arithmetic" after a workload row and a card body wrote the inverse of its rate. It also states what the
   base-quantity field holds: its unit (the dimension's base unit under a ratio, the suite's own under `factorField`,
   and mixed when a `record` field declares no `unitDimension`), and whether a raw aggregate over it is admitted, the
   way ADR-0144 D6 reads the home field.
5. **An edited old row, left to a later card (R2's).** When an old row's quantity is edited and its unit is
   unchanged, does R2 reuse the row's stored factor? The record's 1A pulls two ways here: "affects later writes only",
   the maintainer's pick, against "they change only through an explicit recompute", the seat's. Whichever R2's card
   picks is a reading of 「可改，只影响以后」. Not settled here.
6. **A number field with no `scale`, and the display default at render.** A number field that declares `unitConfig`
   (or R2's base field) may declare no `scale`; whether a scale is then required is for the R1/R2 cards. L4 names the
   field's `scale` as the ceiling and R2's rounding target. R1's display card also states what a unit's display
   default does with a stored value that has more places (1.5 beside a unit of zero decimal places), and that "never
   exceed the field's `scale`" can act only at render, since a unit row has no field to compare with.
   *Note (2026-11-20), first half:* settled on the membership card
   ([#35489](https://github.com/objectstack-ai/objectstack/issues/35489)). A number field that declares `unitConfig`
   needs no `scale`, and may keep one. ADR-0144's precedent is that a currency's decimal places are the currency's,
   not a field setting (ruling `5805782503`, `field-currency-scale-refused.test.ts`), and it never required a scale.
   No reader of a unit's own decimal places (U6) has shipped yet: the display card
   ([#35490](https://github.com/objectstack-ai/objectstack/issues/35490)) and the decimal-places setting card
   ([#35498](https://github.com/objectstack-ai/objectstack/issues/35498)) add them, so nothing reads a required scale
   today. A declared `scale` stays what L4 names it: the ceiling. The display half stays with R1's display card.
7. **The release of each declaration.** U7 lists readers; U8 binds each key to its reader's release
   ([Releases](#releases)).
8. **A unit code with no quantity beside it: a ruling is owed.** U4 puts the unit declaration on the `number` field,
   and L3 settles that the unit field "carries no marker" and that "the pointer is the declaration". So a `text` field
   that holds a unit code is judged by U5, offered a picker and reached by the backfill only when a quantity on the
   same object points at it. A material master's base unit, a product's sales unit and the unit columns of a suite's
   pack table (the table R2's `factorField` reads) have no such quantity, and the card's first evidence,
   `srm_material.uom` ([Context](#1-the-business-reason-the-cards) §1), may be one. Currency has no such gap: any
   `text` field can declare `valueDomain: 'iso_4217_currency'` on its own, and `sys_exchange_rate`'s `currency` does
   (`packages/platform-objects/src/system/sys-exchange-rate.object.ts#SysExchangeRate`). U1 rules out a fourth value
   domain; it does not rule out a marker. Admitting a standalone unit field widens U4, so the question sits between U4
   and U5 and owes the maintainer a ruling. Not settled here.
   *Note (2026-11-20):* ruled A on [#35339](https://github.com/objectstack-ai/objectstack/issues/35339) (「可以单独声明」,
   `7008524997`) and built on the membership card
   ([#35489](https://github.com/objectstack-ai/objectstack/issues/35489)). The marker is `unitConfig: { unitMode:
   'code', unitDimension? }` on a `text` field. It is the third member of the one unit key, not a fourth value domain
   (U1 keeps `ValueDomainSchema` at three members), because the membership it asks for is asynchronous and reads
   `sys_unit` rows, which no pure value-domain predicate can do. Precedent: the L3 key family (`unitConfig` /
   `unitMode` mirror `currencyConfig` / `currencyMode`), and the word "code" from U4 ("the row stores the code") and
   `sys_unit.code`. It is refused beside a `valueDomain`, which would make one column hold two vocabularies. It is
   also refused on a field that a quantity's `unitField` names (L3: "the pointer is the declaration"). U5 judges it
   whenever it is written (Open item 9 point 6); the backfill
   ([#35492](https://github.com/objectstack-ai/objectstack/issues/35492)) reaches it, and the picker card
   ([#35490](https://github.com/objectstack-ai/objectstack/issues/35490)) is to. The backfill door reaches a
   standalone `unitMode: 'code'` field the same way it reaches a `unitField`. The field has no quantity beside it, so
   its blank is owed nothing and is never written, with or without a `""` entry
   ([#35492](https://github.com/objectstack-ai/objectstack/issues/35492)).
9. **Which writes U5 judges.** The membership card states it for three cases: a code written; a quantity written
   beside a resting code that is no longer a member (an org unit deleted under L1); and a quantity written beside a
   blank code. The two precedents this record mirrors answer differently. The record validator judges a
   `valueDomain` on the written value only (`packages/objectql/src/validation/record-validator.ts`, its header). The
   currency pair guard judges only the pairs a payload touches, and only for a blank code
   (`packages/objectql/src/validation/record-currency-code.ts`, its header). Under either, an update that changes the
   quantity on a row whose stored code is no longer a member passes, while L1's settlement refuses "a new save with
   that code". That needs a third shape: the membership of the row image's code whenever the pair is touched. The
   third shape also refuses a quantity edit on every row that still holds free text before the backfill runs, so it
   orders R1's rollout. ADR-0144 D8 rule 4 refuses an amount beside a blank currency code; whether a quantity may rest
   beside a blank unit is unstated here. The same card states whether U5 also checks a code's dimension against the
   field's `unitDimension`, the "restriction" U4 allows. For the membership card (R1); not settled here.
   *Note (2026-11-20):* settled by the seat on [#35467](https://github.com/objectstack-ai/objectstack/issues/35467)
   (`7013996288`) and built on the membership card
   ([#35489](https://github.com/objectstack-ai/objectstack/issues/35489),
   `packages/objectql/src/validation/unit-code-membership.ts#assertUnitCodes`). It runs after the currency-code check,
   at insert, by-id update, predicate update and the `validate()` preview:
   - the row image is judged whenever the write carries the quantity or its unit field; a write touching neither is
     not judged (ADR-0113 D1);
   - case 1: a written code is a member only if it is a U1 code (one own-property lookup, `standardUnitOf`) or a
     non-retired `sys_unit` row of the row's organization, in exact uppercase, never folded;
   - case 2: a non-blank quantity written beside a resting code that is no longer a member is refused. The message
     names the field, never the stored value nor anything derived from it (no corrected spelling, no dimension);
   - case 3: a quantity beside a blank code is refused (`ERR_UNIT_CODE_REQUIRED`, ADR-0144 D8 rule 4). A blank
     quantity needs no code;
   - point 5: under `unitDimension`, a member of another dimension is refused. A unit field shared by two quantities
     is judged by the restriction either one declares (L3 refuses two different ones);
   - point 6: a standalone `code` field is judged as a unit field with no quantity, under its own `unitDimension`;
   - point 7: carried to the backfill card ([#35492](https://github.com/objectstack-ai/objectstack/issues/35492),
     `7035331645`) and built there:
     - (a) The `ERR_UNIT_CODE_REQUIRED` and `ERR_UNIT_CODE_UNKNOWN` refusals end with the remedy when the refused
       write edits a quantity beside a resting value it did not supply. The remedy is `os migrate unit-codes` for that
       object and field, or the REST twin
       (`packages/objectql/src/validation/unit-code-membership.ts#unitCodeBackfillRemedy`). For a resting blank, it
       names the `""` entry. A code the caller wrote carries no remedy, and neither does a resting retired code, which
       the door leaves as stored.
     - (b) A metadata save that makes a stored field a unit code field answers the 409 `DESTRUCTIVE_CHANGE`, beside
       ADR-0144's `currency_mode_to_record`. The finding is keyed on the code field, as U5 is.
       `unit_code_field_declared` is raised for a stored field that is a unit code field after the save and was not
       one before, whichever declaration made it one: a quantity, new or stored, whose `unitField` names it; a
       `unitField` re-pointed at it; or its own `unitMode: 'code'`. A field that already was a unit code field raises
       nothing. `unit_mode_to_record` is raised for a stored quantity switched to `unitMode: 'record'`, for the blank
       units beside it, whatever the history of its `unitField`: a unit code field already, or a field new in the same
       save. It is not raised when the same save raises `unit_code_field_declared` on that `unitField`, because that
       finding names the quantity, its blanks and the `""` entry, so each debt is reported once. Each names that run
       for the code field, and `force: true` lifts both
       (`packages/metadata-protocol/src/protocol-write-face.ts#detectDestructiveObjectChanges`). The detector reads no
       row.
     - No finding is raised in R1 for a `unitField` re-pointed onto a field that already was a unit code field or onto
       a field new in the same save (the sibling of `currency_field_repointed`), or for a narrowed `unitDimension`.
       The re-point onto a field new in the same save, the one that leaves stored rows beside a blank unit, is carried
       by [#35885](https://github.com/objectstack-ai/objectstack/issues/35885).

   The organization's units are read once per organization per write. The read uses an explicit `organization_id`
   predicate under a minimal system context that keeps only the caller's transaction and trace id. It is never made
   for a write whose codes are all standard. Point 7 ties the two cards to one release: the maintainer held the next
   Version Packages release until the backfill door merged (release pairing A,
   [#35492](https://github.com/objectstack-ai/objectstack/issues/35492) `7037347112`), so no release carries the
   stricter write without its door.
10. **U6's decimal places for a standard code: a ruling is owed.** U3: `sys_unit` "holds org-added units only, and the
    platform ships zero rows", and org codes live in a namespace no standard code enters. U1 is a closed spec
    constant. U6 makes a unit's decimal places "an org-editable default" and argues from Rec 20, which is to say from
    standard codes. L4 defines them as the display default "for that unit", and item 2 counts U6 among the texts that
    name `sys_unit` fields. For a standard code such as `KGM` or `H87` the value has nowhere to be stored or edited,
    and R1's display member is its first reader. The question sits between U3 and U6 and owes the maintainer a
    ruling. Not settled here.
11. **A deleted code created again.** The seat's L1 settlement allows deleting an org unit and makes a unit's code and
    dimension immutable after create. That does not survive a delete followed by a new create of the same code. A
    `sys_*` row has no recycle bin, and a deleted row frees its unique value at once
    ([ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md): "Unique keys free
    immediately"; its v1 covers "business objects — not `sys_*` objects"). The same code can then be created with
    another dimension, ratio and label. Rows resting on the old unit keep the code, take the new label in R1's
    display, fall into one group with the new unit's rows under U7 R1's grouped aggregate, and can sit under a
    `unitDimension` they no longer satisfy. That is the relabel hazard ADR-0144's D4 lock closed for currency; this
    record declines a lock for the ratio only, and L1 rules out scanning for "used", so a use check cannot close it.
    For the `sys_unit` card: either a deleted code stays retired, or re-creation is admitted and its consequence is
    stated. Not settled here.
    *Note (2026-11-19):* settled on the `sys_unit` card
    ([#35488](https://github.com/objectstack-ai/objectstack/issues/35488)), under the owning seat's contract review,
    answering [#35466](https://github.com/objectstack-ai/objectstack/issues/35466): **a deleted code stays retired.**
    L1's delete is spelled as a one-way `retired` flag on the row. The row is never removed, so it keeps holding the
    organization-scoped unique key on `code`, and the same code can never be created again with another dimension,
    ratio or label; the hazard above cannot arise. The mechanism, each part pinned: the data API serves no delete on
    `sys_unit`, single or batched (`enable.apiMethods` is `get`, `list`, `create`, `update`, `bulk`, and a batch admits
    only a granted verb), Setup offers no Delete
    (`userActions.delete: false`), and a rule refuses clearing `retired` once set. Rows resting on a retired unit keep
    their code and stored conversion, as L1 states for a deleted unit. Two consequences are left to their cards: the
    membership card (U5, [Open item](#open-items) 9) refuses a new save with a retired code, as L1's delete bullet
    requires; and the display card says whether a resting row shows the retired unit's label, which stays on file, or
    the bare code that L1 wrote for a deleted unit. Re-creation was not admitted: no measured reason favoured it, and
    an organization that needs the code's old meaning back has the retired row's history, while one that needs a new
    meaning names a new code. Not closed by this mechanism: `apiMethods` governs the data API, so a delete issued to the
    engine directly, below that door, is not refused by it; no platform path issues one, and whether an automation
    could is not measured here.
    *Note (2026-11-20):* the engine refuses a delete of a `sys_unit` row in every context, a system writer and an
    automation run included, by id and batched. The refusal is 405 `ERR_UNIT_DELETE_REFUSED`, raised before any
    middleware or hook. `organization_admin` names `sys_unit` explicitly with no delete bit, as `sys_audit_log` is
    named ([#35489](https://github.com/objectstack-ai/objectstack/issues/35489)). The maintainer ruled one exemption
    (option B, [#35812](https://github.com/objectstack-ai/objectstack/issues/35812) `7035627429`): the organization
    delete's own cascade removes its units. It is not built in R1. Until
    [#35812](https://github.com/objectstack-ai/objectstack/issues/35812) lands, the refusal holds for that cascade
    too, so an organization that holds a unit cannot be deleted.
12. **R1's backfill and its raw aggregates.** The backfill mirrors `os migrate record-currency-codes` loosely. That
    door writes one code, the operator's, into the rows whose code is blank
    (`packages/objectql/src/record-currency-backfill.ts#backfillRecordCurrencyCodes`); the unit door rewrites free
    text in place, from a mapping. Where the mapping comes from, and what an unmatched value does, are the backfill
    card's. Which aggregates count as "raw" under U7 R1's refusal is the aggregate card's, as ADR-0144's Open item 10
    was for currency.
    *Note (2026-11-20):* the backfill half is settled on
    [#35469](https://github.com/objectstack-ai/objectstack/issues/35469) (`7014013098`) and built by
    [#35492](https://github.com/objectstack-ai/objectstack/issues/35492). `os migrate unit-codes --object O --field F
    [--map-file FILE] [--org ID | --all-organizations] [--apply]` and its tenant-admin twin `POST
    /api/v1/meta/_migrate-unit-codes` (`packages/objectql/src/unit-code-backfill.ts#backfillUnitCodes`,
    `packages/rest/src/meta-unit-code-backfill-route.ts#registerMetaUnitCodeBackfillRoute`) rewrite the stored text of
    a unit code field in place. They work from the operator's mapping of stored text, exactly as written, to a unit
    code. Nothing is derived and nothing is folded: `kg`, `KG` and `kg ` are three keys. The run names the unit code
    field (the `text` field a quantity's `unitField` names, or a `unitMode: 'code'` field), never the quantity.
    - **Targets.** Each mapping target is judged by U5 before any row is written: a standard code, and any code under
      a named organization, before any row is read. With no organization named, an organization's own code is judged
      in each organization the run would write it in, after the read-only preview and before any write. A target that
      is no member, a retired unit, or a unit of another dimension than the field's `unitDimension` refuses the run
      `INVALID_FIELD`.
    - **Rows left as stored.** A row holding a unit code is never rewritten, so a second run writes nothing. A unit
      code here is a code of U1 or any `sys_unit` row of the row's organization, a retired one included (L1 keeps a
      resting row's code), or a code of another dimension. Neither is free text, and rewriting either from a mapping
      would change what the stored quantity means. Neither is a code the field admits either. Beside a quantity, U5
      refuses both at the row's next quantity edit. A standalone field has no quantity, so U5 never judges the resting
      code; the next write of the field must carry another code. So the run lists and counts each apart (`retired`,
      `other-dimension`), never as a code the field admits.
    - **Blanks.** A blank unit beside a quantity is written only from an explicit `""` entry; without one it is
      counted and named. A blank with no quantity is left.
    - **Complete.** A run is complete only when every row holds a unit code the field admits: no unmatched value, no
      blank beside a quantity, no retired unit, no code of another dimension, and no failed or unexamined row. The
      report and the CLI print their check-mark line only then.
    - **Dry run and apply.** The dry run, the default, lists each distinct stored value with its row count and what
      the mapping does with it. An apply run that meets a value with no entry is refused `VALIDATION_ERROR` on
      `mapping` before any write, naming each value, so one run converts the whole field or nothing. A preview cut
      short at its row limit is reported as truncated
      ([#35885](https://github.com/objectstack-ai/objectstack/issues/35885)).
    - **Scope.** Scope is ADR-0144 Open item 13's: one organization, or every one explicitly. An unscoped run over
      several organizations' rows is refused with each one's counts. The REST twin converts the caller's current
      organization only, behind `metadata.endpoints.maintenance` and `setup.write`, as a preview unless `apply: true`.
    - **Writes.** Each row is written through `engine.update` under a system context, so U5 judges every converted
      code.

    The aggregate half stays with [#35491](https://github.com/objectstack-ai/objectstack/issues/35491).

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
- Ruling record of the L1 decision card, with the seat's settlement of L1 and L2:
  [#35339 `7003532733`](https://github.com/objectstack-ai/objectstack/issues/35339#issuecomment-7003532733); the
  deferred label translation, [#35404](https://github.com/objectstack-ai/objectstack/issues/35404).
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
  [ADR-0112](./0112-error-code-vocabulary-and-ledger.md),
  [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md).
