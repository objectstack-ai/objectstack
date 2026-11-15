---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

feat(objectql)!: a record-mode amount an object extension adds is judged against its object as served, so a bad follow pair is refused at the run that completes it

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered record-currency-follow-extension-judged-as-served -->

**BREAKING** for an `objectExtensions` entry (or a stored `object_extension` item) that adds a record-mode amount (`currencyConfig.currencyMode: 'record'`, `currencyField: 'MASTER_DETAIL.CODE'`) whose parent field holds no ISO 4217 code, does not exist, or is reached through the extension's own new master_detail. The record-currency follow door (ADR-0144 D2 and D6, amended) asked an `extend` layer about its own roll-ups only and returned before the following-amount half, so such an amount was admitted and served; every write of it was then refused `ERR_CURRENCY_CODE_REQUIRED`, and the next no-change upgrade of the parent's owner was refused over the extension's field. Every object layer is now judged as its object served with the layer in its slot: the base, every enabled extension, and the incoming body. It is also BREAKING for a roll-up author: a published single save of an `object_extension` item that adds a `sum` / `avg` / `min` / `max` roll-up D6 refuses, or adds a record-mode amount a registered parent's such roll-up reads, is now refused 422 where it was stored (the last line below).

The fix: name in the second segment of `currencyField` a field of the master_detail target that declares `valueDomain: 'iso_4217_currency'` (the refusal lists the candidates), or install the package that supplies that field before the extension, or in the same artifact. For a roll-up D6 refuses: roll up through the master_detail the amount follows (`summaryOperations.relationshipField`, on the parent it follows), use `function: 'count'`, or roll up a stored home-currency amount field of the child instead; the refusal says which applies.

What moves (each line FROM → TO). The first four lines hold at the end of an install / upgrade / reload run, in the batch writer, and on a published single save of an `object_extension` item; the others name their askers:

- an extension-only package adding an amount that follows a parent field holding no code, a missing field, or a field reached through its own new master_detail: FROM admitted (served) TO refused 422 `INVALID_METADATA`, naming the child object and the amount; nothing of the install stays.
- the other registration order, the extension registered first (no verdict while nothing owns the extended object) and the owner after it: the owner's install FROM admitted TO refused 422 over the extension's amount.
- an extension following a code field another extension supplies: refused when that supplier is not installed or is disabled; admitted when it is installed and enabled, or arrives in the same artifact.
- a parent upgrade that removes or de-codes a field an extension's amount follows: still refused 422; the sentence now names the extension's package and field.
- at the end of a run ONLY (an install, upgrade or reload): a no-change upgrade of the parent's owner, the child's owner or the extension's package over a pair a cold boot admitted, or an upgrade that only adds an unrelated code field to the parent: FROM refused 422 TO installed. A run is not refused over a pair it leaves as it found it (the pair is compared, not the refusal sentence: for a following amount, the object and field declaring it, the pointer, and the object the pointer's master_detail reaches; for a roll-up, the object and field declaring it and the child object and field it reads). An upgrade of the child's owner that re-points the master_detail onto another parent lacking the code makes a new pair and is still refused 422, as before. The same re-point upgrade of an extension package (its own master_detail, pointer string unchanged) moves FROM installed (`main` never asked an extension layer's following half) TO refused 422.
- on a published single save of an `object_extension` item and in the batch writer (a package publish, a duplicate, an import), which judge a layer against its slot left empty: re-publishing an UNCHANGED extension whose amount a cold boot admitted over a bad parent field: FROM saved (single save answered 200, the batch writer saved the row in its own result; the extension's following half was never asked) TO refused 422. An own object body re-published unchanged over such a pair was already refused there, and still is.
- a published single save of an `object_extension` item on a `/meta` face now also meets D6's roll-up door (`recordCurrencySummaryRefusal`), as the batch writer's extension row already did, in both directions: an extension adding a `sum` / `avg` / `min` / `max` roll-up of a child amount, or adding an amount a registered parent's such roll-up reads, where that child amount is declared `currencyMode: 'record'` (in each row's own currency, or following a parent's code but not read on that parent through the master_detail it follows): FROM stored and answered 200 (its registration then failed with a `console.warn` only) TO refused 422 `INVALID_METADATA`, nothing stored.

Unchanged: the same amount in an own object body is refused 422, and so is a package that owns the parent and extends the child in one install; an extension of an object no package owns is no verdict; the cold boot is not asked. No stored-row migration or heal ships with this change.
