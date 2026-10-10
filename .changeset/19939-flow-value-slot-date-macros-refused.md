---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': patch
---

A flow VALUE slot now refuses the date macros as well — `{TODAY()}`, `{NOW()}`, with an optional `± N` day offset — so it reads no single-brace `{…}` token at all. Each is refused at `objectstack validate`, at `registerFlow` and by the executor, naming its CEL string form: `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())`, `isoDatetime(addDays(now(), N))`.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused, flow-text-slot-single-brace-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff to refuse the date macros and name their CEL string forms; the text-slot entry is amended where its remedy computed a date macro through the value-slot spelling this change refuses. No new D3 entry and no D2 conversion. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** The template dialect is retired from the value slots: one dialect per slot, with a remedy for every spelling. The date macros were the last spelling kept, because CEL had no string form for a timestamp: `today()` and `now()` reach the data engine as a `Date` object, not the ISO text the macros wrote. The CEL stdlib now has one — `isoDate(t)` (`YYYY-MM-DD`) and `isoDatetime(t)` (`YYYY-MM-DDTHH:mm:ss.sssZ`), on the UTC calendar the macros rendered on — so the macros can be refused with a remedy that writes the same text.

**What is refused.** In every value slot — `create_record` / `update_record` `fields`, the `assignment` node's `assignments` map, and both legacy `assignment` shapes — a string carrying a date macro, alone or beside other text and tokens. A string that mixed a date macro with another token used to be kept whole, the run-user token included (`'Due {TODAY()} by {$User.Id}'`); it is refused now, with a remedy for every token.

**Where the remedy parts from the template.** For no offset or a whole number of days the CEL form writes the template's text byte for byte, at every instant (measured live through both engines over DST transitions, month and year ends and a leap day). The refusal names the three places it does not:

- a fractional offset: the template added it to the day of the month and truncated the sum, `addDays` truncates the offset itself — going back, a day apart on most days of a month — and `daysFromNow(1.5)` / `daysAgo(1.5)` are refused at build;
- a variable offset (`{TODAY() + days}`): the template looked the offset up as one variable name and added 0 days, without a word, when it found none or the value was not a number; CEL reads the path, and fails the run on an absent variable or a value that is not a number;
- an offset that is neither a number nor a variable name (`{TODAY() + 3d}`): the template added 0 days.

**Where an envelope is literal data, the remedy names none there.** The refusal used to prescribe an envelope at whatever position it refused a token. Inside an object or list value, and in the legacy `assignment` shapes, the executor reads an envelope as data: the prescribed metadata registered and stored the envelope object. The refusal there now names what evaluates — the whole value built as one CEL map or list literal (mixed values each wrapped in `dyn(…)`), or the assignment moved into the `assignments` map. This holds for every token, not only the date macros. An envelope-shaped object in those positions is still data, unchanged.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `'{TODAY()}'` | `{ dialect: 'cel', source: 'isoDate(today())' }` | nothing |
| `'{TODAY() + 7}'`, `'{TODAY() - 3}'` | `{ dialect: 'cel', source: 'isoDate(daysFromNow(7))' }`, `{ dialect: 'cel', source: 'isoDate(daysAgo(3))' }` | nothing for a whole number of days; a fraction truncates differently, and `daysFromNow` / `daysAgo` refuse one at build |
| `'{NOW()}'` | `{ dialect: 'cel', source: 'isoDatetime(now())' }` | nothing |
| `'{NOW() + 2}'`, `'{NOW() - 1}'` | `{ dialect: 'cel', source: 'isoDatetime(addDays(now(), 2))' }`, `{ dialect: 'cel', source: 'isoDatetime(addDays(now(), -1))' }` | nothing — `addDays` keeps the time of day, where `daysFromNow` would land on midnight |
| `'{TODAY() + days}'` | `{ dialect: 'cel', source: 'isoDate(addDays(today(), days))' }` | an absent `days`, or one that is not a number, fails the run where the template silently added 0 |
| `'Due {TODAY()} by {$User.Id}'` | `{ dialect: 'cel', source: "'Due ' + isoDate(today()) + ' by ' + current_user.id" }` | guard the run user where a flow can run without one |
| `payload: { due: '{TODAY()}' }` (a string inside an object value) | `payload: { dialect: 'cel', source: "{'due': isoDate(today())}" }` | an envelope written at `payload.due` would be stored as an object |
| a text slot's `assignments: { due: '{TODAY() + 7}' }`, then `'Due {{ due }}'` | `assignments: { due: { dialect: 'cel', source: 'isoDate(daysFromNow(7))' } }`, then `'Due {{ due }}'` | the text-slot remedy published earlier on this line computed the date through the value-slot spelling this change refuses |

**The one-line fix: write a date macro as `isoDate(…)` / `isoDatetime(…)` in a CEL envelope, with a whole number of days.**

**Who is affected, measured.** This repository's examples carry no date macro in a value slot; its own test fixtures and docs that did are migrated in this change. The census taken for this retirement's first change measured 15 date-macro value-slot sites in hotcrm at `c529de2` (8 `{NOW()}`, 3 `{TODAY()}`, 3 `{TODAY() + N}`, 1 `{TODAY() + var}`); they migrate there. Deployed metadata and other repositories were not measured here.

**Still accepted, unchanged.** A CEL value envelope and every literal. The single-brace dialect, date macros included, keeps resolving where it still lives — a `filter` value, a `notify` `recipients` entry, an `http` body, a `subflow` input. The value-slot retirement's earlier entries on this line list the date macros as still accepted, and the text-slot entry computes a date through them; this entry supersedes those lines.

### The kit

- **The refusal.** `valueSlotTemplateRefusals` / `flowNodeValueTemplateRefusals` (`@objectstack/spec/automation`) keep no token; the text-slot judge's date-macro remedy (`textSlotTemplateRefusal`) names the CEL envelope. `FlowValueSlotSchema` / `AssignmentValueSchema` say so in their descriptions.
- **The ledger.** The step-18 D3 entries `flow-value-slot-template-dialect-refused` (amended to refuse the date macros and name their forms) and `flow-text-slot-single-brace-refused` (its date remedy). No key is removed, so there is no tombstone, and there is no D2 conversion.
- **`@objectstack/lint`.** `flow-double-brace-interpolation`'s hint in a value slot names the CEL envelope for the holes the author meant, where it named `{record.title}`, which the slot refuses; `flow-bare-dollar-reference`'s value-slot hint asks the judge at the string's own position, so a nested or legacy-shape string gets the spelling that evaluates there.
- **`@objectstack/service-automation`'s README.** Its *Expressions* section names the date macros' CEL forms.
