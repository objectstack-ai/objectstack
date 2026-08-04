---
"@objectstack/objectql": minor
"@objectstack/lint": patch
---

fix(objectql,lint)!: a `json_schema` validation rule's `format` keyword is now ENFORCED — records that passed before can start failing (#5029)

> **⚠️ BEHAVIOUR CHANGE ON DEPLOYED DATA — READ BEFORE UPGRADING.** A `format`
> keyword inside a `json_schema` validation rule used to enforce **nothing**.
> It now enforces. If any deployed object carries such a rule, writes that
> succeeded on the previous version can be **rejected** after this upgrade —
> including writes from flows, seeds, imports and integrations, not just the UI.
> Nothing about the metadata changed; the runtime simply started honouring what
> the metadata always said. See "Before you upgrade" below.

## What was broken

`packages/objectql/src/validation/rule-validator.ts` built its shared ajv as
`new Ajv({ allErrors: true, strict: false })` and stopped there. In ajv 8 the
`format` keyword is **not built in** — it ships in the separate `ajv-formats`
package — and under `strict: false` an unregistered format is not an error: ajv
logs one line at compile time and **drops the keyword**.

So this rule:

```ts
{
  type: 'json_schema',
  name: 'support_config_shape',
  field: 'support_config',
  message: 'Support config is invalid.',
  schema: {
    type: 'object',
    properties: { email: { type: 'string', format: 'email' } },
    required: ['email'],
  },
}
```

compiled fine, ran on **every** write, enforced `type` and `required` — and
enforced **nothing at all** for `format`. `{ email: 'not-an-email' }` was
accepted, for every record, forever. The only signal was a stderr line at
compile time naming no rule and no object.

This is the #4649 / #4762 family one level in, and the partial failure is what
made it nasty: the rule visibly rejects a bad `type` / missing `required`
payload in dev, so it reads as *working* while the `format` half never fires.
`format` is also one of the most reached-for JSON Schema keywords (`email`,
`uri`, `uuid`, `date`, `date-time`, `ipv4`), so this was not an exotic corner —
and it is exactly the shape an AI writing metadata reaches for first.

## What changed

- **`@objectstack/objectql`** now depends on `ajv-formats` and registers it on
  the shared instance (`addFormats(ajv)`). The **default (full)** format set is
  used deliberately: `fast` mode trades correctness for speed on precisely the
  formats authors reach for most, and a format that "mostly" matches is the same
  declared ≠ enforced defect with a smaller hole.
- **`@objectstack/lint`** — the #4762 publish gate
  (`validate-rule-compilability.ts`) compiles every `json_schema` rule with the
  SAME ajv environment the runtime uses, on purpose, so it registers the same
  plugin. This is not cosmetic parity: `ajv-formats` also installs the
  `formatMinimum` / `formatMaximum` keywords, so a gate without it treats them
  as unknown keywords (`strict: false` ⇒ silently ignored) and would publish a
  schema the runtime then refuses to compile — a rule that passes review and
  enforces nothing, which is the failure that gate exists to prevent. The parity
  test now reads the plugin registration out of the runtime's source, so the two
  cannot drift apart silently.

**Authoring is unchanged.** `format` stays a legal, publishable JSON Schema
keyword; the publish gate does not refuse it (option 2 on #5029 was considered
and rejected — refusing standard JSON Schema would push authors into private
spellings). What changed is only that the declaration is now true.

## Before you upgrade

1. Find the rules at risk: any `object.validations[]` entry with
   `type: 'json_schema'` whose `schema` contains a `format` key, at any depth
   (including inside `$defs` / `$ref` and a `conditional`'s `then` /
   `otherwise` branch).
2. For each, audit the existing column against that format. Rows already stored
   are **not** re-validated — nothing is rejected retroactively, and no
   migration runs — but the **next write that touches the field** is checked,
   which includes an unrelated PATCH that merely resends the JSON blob.
3. If a format was aspirational rather than real, remove that `format` key (or
   relax it) *before* upgrading. Deleting the keyword is now a meaningful,
   visible act rather than a no-op.

## Known limitation, recorded deliberately

A **misspelled** format name is still ignored. `format: 'emial'` compiles under
`strict: false` — ajv logs `unknown format "emial" ignored` and drops it — in
both the runtime and the publish gate, so a typo still enforces nothing. That
behaviour is unchanged here and pinned by test in both packages, so it is a
known boundary rather than an oversight; closing it is an authoring-time
decision of its own and is tracked separately.
