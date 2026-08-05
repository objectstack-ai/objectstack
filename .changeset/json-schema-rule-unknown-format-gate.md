---
"@objectstack/lint": patch
---

fix(lint): a MISSPELLED `format` in a `json_schema` validation rule is refused at publish time (#5178)

#5029 registered `ajv-formats` so a `json_schema` validation rule's `format`
keyword is really enforced. It did **not** close the other half, and said so:
under `strict: false` — which is load-bearing, because author-written schemas
legitimately carry vendor keywords — an **unrecognised** format name is a
non-event. ajv logs one line at compile time and **drops the keyword**:

```
$ node -e "const Ajv=require('ajv'); const addFormats=require('ajv-formats');
  const ajv=new Ajv({allErrors:true,strict:false}); addFormats(ajv);
  const v=ajv.compile({type:'object',properties:{e:{type:'string',format:'emial'}}});
  console.log('validates {e: zzz} =', v({e:'zzz'}));"
unknown format "emial" ignored in schema at path "#/properties/e"
validates {e: zzz} = true
```

So an author who types `emial`, `e-mail`, `datetime` for `date-time`,
`urireference` for `uri-reference`, `ipv_4` for `ipv4` or `Email` for `email`
gets a rule that is declared, appears in the metadata, appears in every "what
protects this object" listing, runs on every write, enforces `type` and
`required` — and enforces nothing for the keyword they actually wrote. The
record is **accepted**, which is the silent direction: nothing in the metadata,
the UI or a test run says the constraint is inert. A typo is also the single
most likely mistake in a hand-written or AI-generated JSON Schema.

**New gate — `validateRuleSchemaFormats`**, a `gating` entry in
`AUTHORING_RULES`, so it runs on all three authoring commands (`os validate`,
`os build`, `os lint`) with no per-command wiring. One rule id:

| id | fires when |
|:---|:---|
| `validation-rule-json-schema-unknown-format` | a `json_schema` rule's schema names a `format` the runtime's ajv has not registered |

Each finding names the rule, the object, the **RFC 6901 JSON Pointer** to the
offending keyword, and the **nearest registered name**:

```
objects.account.validations.support_shape.schema#/properties/email/format
  `json_schema` validation 'support_shape' on object 'account' names
  `format: 'emial'` at `#/properties/email/format`, which is not a registered
  format. … the schema compiles, the rule ships and runs on every write, its
  `type`/`required` keywords are enforced, and this constraint is enforced on
  no record, ever. The record is ACCEPTED, so nothing downstream reports the
  gap either.
  hint: Did you mean `format: 'email'`? The registered names are: binary, byte,
  date, date-time, … — the default `ajv-formats` set, the one
  `rule-validator.ts` registers (#5029).
```

**The vocabulary is enumerated, never written down.** The registered set is read
off a live instance of the very ajv the publish gate builds to mirror the
runtime (`registeredFormatNames()`), not from a hardcoded list. A list would be
a third opinion that nobody updates: the day `ajv-formats` adds a name, it
starts refusing a format the write path enforces — a gate that turns working
metadata red gets switched off, and then protects nothing. Enumerating means the
gate follows the plugin across an upgrade with no edit at all.

**The walk is JSON-Schema-aware, because `format` is not a magic word.** Every
subschema position is visited — `properties`, `items` (both the 2020-12 schema
form and draft-07's tuple array), `anyOf`/`allOf`/`oneOf`/`prefixItems`,
`$defs`/`definitions`, `additionalProperties`, `patternProperties`,
`if`/`then`/`else`, `not`, `contains`, `propertyNames`, `dependentSchemas`,
draft-07 `dependencies` — at any depth, plus the rules nested in a
`conditional`'s `then`/`otherwise`. Positions that hold arbitrary **data** are
deliberately never read: a `format` inside `default`, `const`, `enum` or
`examples` enforces nothing and was never meant to, so reporting it would invent
a defect out of a legal document. A non-string `format` (`format: 42`) is left
to `validation-rule-json-schema-uncompilable`, which already refuses it in
ajv's own words.

**The runtime is untouched, and so is the #4762/#5029 compile parity.** Option 2
on #5178 (make an unknown format a runtime compile error) was rejected: it fires
at runtime and fail-**open**, since `checkJsonSchema` catches, logs and skips —
trading one silent gap for another. And this is a separate judgement laid
*beside* the existing compile, never folded into it: `validateRuleCompilability`
still compiles each schema in the runtime's exact environment and still
**publishes** a typo'd format, because a typo'd format compiles there too. Its
`#5029` pin ("a MISSPELLED format name is published, not refused") passes
verbatim. Two questions, two rules — "does ajv accept this schema?" and "will
this `format` keyword do anything?" — sharing one traversal and one ajv
environment so they can never disagree about which rules exist or what
"registered" means.

`ajv` / `ajv-formats` stay **lazy**, and this rule is lazier than its neighbour:
the registered vocabulary is only fetched once a schema actually names a
`format`, so a `json_schema` rule that names none loads neither package. Pinned
by the package's `lazy-deps.test.ts` in all three of its layers.

**Upgrading:** if `os validate` / `os build` / `os lint` newly rejects a
`json_schema` validation rule, the format name in it was never being enforced —
fix the spelling to the name the finding suggests, or express the constraint
with `pattern`, which is enforced. No metadata that was working changes
behaviour.
