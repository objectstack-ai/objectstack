---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

feat(spec): the filter comparand-type door (#7872) — the shared compile face now defines the accepted literal comparand-type set as the measured superset `string | number | bigint | boolean | null | Date` and refuses everything else loudly (`INVALID_FILTER` / 400), for every driver at once.

Previously the five drivers answered an unsupported comparand type five ways (measured, #7956): the SQL family refused by policy, driver-memory crashed on `BigInt` (a raw mingo `TypeError`) and silently answered zero rows for five other types, and driver-mongodb let the BSON encoder silently edit the query — `{qty: undefined}` reached the wire as `{}`, i.e. MATCH EVERYTHING.

What changes for callers:

- `parseFilterAST` (`@objectstack/spec/data`) now judges everything it returns — the object-form passthrough included — and the ObjectQL engine runs the same walk on object-form filters at its lowering seam, covering every engine verb on both doors. New exports: `normalizeFilterComparandTypes`, `isAcceptedFilterComparand`, `ACCEPTED_FILTER_COMPARAND_TYPES`, `ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE`, `FILTER_COMPARAND_BIGINT_EXACT_LIMIT`, and the `FILTER_COMPARAND_TYPE_CASES` conformance table all five driver suites now run.
- A filter carrying `undefined`, a function, a `Symbol`, a `Map`/`Set`/class instance, or a plain object in a scalar operator slot is now refused with `code: 'INVALID_FILTER'`, `status: 400`, and guidance naming the accepted set — it previously crashed, answered a silent wrong row count, or matched everything, depending on the driver.
- A `bigint` comparand is accepted and narrowed copy-on-write to its exact JS number at the door (so it now works on driver-memory too, instead of crashing); a bigint beyond ±2^53 is refused loudly instead of silently losing precision.
- `FieldReference` comparands (`{ $field: … }`), nested-relation/deep-equality structure, arrays outside `$in`/`$nin`/`$between`, and unknown/retired operators are deliberately untouched — their recorded rules and refusals stand.
- driver-sql and driver-turso source their comparand allow-list membership and refusal wording from the door instead of keeping local copies; their envelopes and direct-caller behavior are unchanged.
