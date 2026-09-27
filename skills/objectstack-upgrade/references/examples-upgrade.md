# Upgrade — worked examples and templates (moved verbatim from SKILL.md)

### 2.3 A worked R1 — the retired field-mapping `transform`

The shape in a protocol-16 project:

```jsonc
{
  "connectors": [{
    "name": "sap_erp",
    "fieldMappings": [
      { "source": "order_value", "target": "order_total",
        "transform": { "type": "javascript", "expression": "value / 100" } }
    ]
  }]
}
```

The chain deletes the key (`field-mapping-transform-removed`) and the schema
tombstones it, so the parse error *is* the prescription: the union had five
members and **no runtime ever executed any of them**. The customer wrote it
because they wanted a transformation, and that need is real regardless.

The prescription names one live target; the rest is the business decision:

| If the intent was… | The v17 home is… |
|:--|:--|
| per-row value shaping on an import | **Import mapping** `mapping.fieldMapping[].transform` — a string enum, settings in `params`; the REST import path runs `none`/`constant`/`map`/`split`/`join`, passes `lookup` to reference resolution, rejects `javascript` (400). |
| multi-source, multi-stage transformation | **nothing** — the L2 ETL layer retired at 17, unexecuted. Do it where it runs: warehouse ELT, a `flow`, a job. |
| nothing — the value was already correct | delete the key and record that the transformation never ran. |

That third row is frequently the truth: the member never executed, so the
connector has been landing raw values for as long as it has been running.
Whether the downstream data is wrong is a question only the owner can answer —
exactly the kind of finding the report exists to surface.

### 3.4 The report — the human half

The upgrade is not finished by a passing command; it is finished by a document a
maintainer can read in five minutes and a year from now. Write
`.upgrade/REPORT.md`:

```markdown
# Protocol 16 → 17 upgrade — <project>

**Status:** complete | complete with N open decisions
**Spec:** <installed @objectstack/spec version>  ·  **Chain:** 16 → 17
**Verified:** `os validate` green · `tsc --noEmit` green · replay-from-17 applies 0 mechanical changes

## 1 · Mechanical (applied by the chain)

| Site | Change | Conversion |
|:--|:--|:--|
| `objects[crm_lead].fields.name` | `required: true` → `+ storage.notNull: true` | `field-required-notnull-explicit` |
| … | | |

_N sites, M conversions. Ported into sources from `os migrate meta --out`._

## 2 · Semantic residue (decided)

### `connector.fieldMappings[].transform` — RESOLVED
- **Site:** `src/connectors/sap.ts:24`
- **Prescription:** <verbatim from the tombstone>
- **Options:** import-mapping `transform` · ETL step · delete
- **Decision:** delete — owner confirmed the values arrive pre-scaled.
  _Decided by: <who>, <date>._
- **Verified:** `os validate` green; connector sync run against staging, 200 rows, values unchanged.

## 3 · Open decisions

| Item | Site | Options | Recommendation | Blocking? |
|:--|:--|:--|:--|:--|
| `agent.tools` → which skill | `src/ai/support-bot.ts:12` | `case_management` · new skill | `case_management` | no — parses without it |

## 4 · Pending, per deployment

- [ ] `os migrate files-to-references` — media values only warn until it passes.
- [ ] `os migrate value-shapes` — stored reference/JSON values unchecked until it passes.
- [ ] `os migrate meta --stored --apply` — rows rehydrate correctly today; this makes it durable.

## 5 · Not changed, and why

- <retired surface the project never used>  — no occurrences.
```

## The v17-canonical shapes, compiled

What the protocol-16 shapes in this skill's examples look like after the
upgrade. This block is type-checked against the published spec, so it cannot rot
into teaching a shape that no longer compiles:

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';
import { defineAgent } from '@objectstack/spec/ai';

// `conditionalRequired` → `requiredWhen`; `required` now also states the
// physical constraint explicitly via `storage.notNull`.
export const Lead = ObjectSchema.create({
  name: 'crm_lead',
  sharingModel: 'public_read_write',
  label: 'Lead',
  fields: {
    name: { type: 'text', required: true, storage: { notNull: true } },
    status: { type: 'select', required: true, storage: { notNull: true } },
    due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' },
    notes: { type: 'textarea' },
  },
});

// Agent capability is reached through skills — there is no inline tool list.
export const SupportBot = defineAgent({
  name: 'support_bot',
  label: 'Support Bot',
  role: 'Front-line support triage',
  instructions: 'Answer support questions and open cases when needed.',
  skills: ['case_management'],
});
```
