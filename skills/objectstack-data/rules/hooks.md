# Data Lifecycle Hooks (Reference)

> **Note:** This document is a reference pointer. Complete documentation has been moved to the canonical hooks skill.

---

## Complete Documentation

For comprehensive data lifecycle hooks documentation, see:

**→ [objectstack-data/references/data-hooks.md](../../objectstack-data/references/data-hooks.md)**

The canonical reference includes:
- All 8 lifecycle events (beforeFind, afterFind, beforeInsert, afterInsert, beforeUpdate, afterUpdate, beforeDelete, afterDelete)
- Complete Hook definition schema
- HookContext API reference
- Registration methods (declarative, programmatic, file-based)
- 10+ common patterns with full examples
- Performance considerations and optimization tips
- Testing strategies (unit and integration)
- Best practices and anti-patterns

---

## Quick Reference

### Hook Definition

```typescript
import { P } from '@objectstack/spec';
import { defineHook, HookContext } from '@objectstack/spec/data';

const hook = defineHook({
  name: 'my_hook',              // Required: unique identifier
  object: 'account',            // Required: target object(s)
  events: ['beforeInsert'],     // Required: lifecycle events
  handler: async (ctx: HookContext) => {
    // Your logic here
  },
  priority: 100,                // Optional: execution order
  async: false,                 // Optional: background execution (after* only)
  condition: P`record.status == 'active'`, // Optional: conditional execution (CEL)
});
```

Prefer `defineHook()` over a bare `: Hook` literal (the same rule as
`defineDatasource`): it validates when the module is imported, so
constraint-level mistakes a bare annotation can't catch — a non-`snake_case`
`name`, a misspelled key routed through a spread — fail while you author
instead of at deploy, and the export carries defaults already materialized.

### Logic: `body` (preferred) or `handler` (deprecated)

A hook's logic comes from **either** an inline `handler` function **or** a
metadata-native `body`. Prefer **`body`** for new code — it is what a
metadata-only runtime executes, and it ships as plain JSON inside the build
artifact. `handler` (inline function) is deprecated; when both are present the
runtime uses `body`.

```typescript
// Sandboxed body: `source` is the function body, run in an isolated QuickJS VM.
{
  name: 'fill_position_on_hire',
  object: 'candidate',
  events: ['afterUpdate'],
  body: {
    language: 'js',                          // 'js' (sandboxed) | 'expression' (pure CEL)
    source: `
      if (!ctx.result || ctx.result.stage !== 'hired') return;
      // afterUpdate ctx.result is PARTIAL — re-query for the lookup FK.
      const rec = await ctx.api.object('candidate').findOne({ where: { id: ctx.result.id } });
      if (rec && rec.position_id)
        await ctx.api.object('position').update({ id: rec.position_id, status: 'filled' });
    `,
    capabilities: ['api.read', 'api.write'], // declare every ctx API the body touches
  },
}
```

Sandbox essentials (full contract in
[references/data-hooks.md → Sandboxed Hook Bodies](../references/data-hooks.md#sandboxed-hook-bodies-body--what-the-sandbox-ctx-can-call)):

- **`ctx`** exposes `input`, `previous` (`undefined` on insert → `!ctx.previous`
  detects *create*), `result` (⚠️ **partial** on afterUpdate — re-query for
  unwritten fields), `user`, `session`, `event`, `object`, `api`,
  `log` (`ctx.log.info(msg)`), `crypto` (`randomUUID`).
- **`ctx.api.object(n)`** repo: `find` / `findOne` / `count` / `insert` /
  `update({ id, ...fields })` / `upsert` / `delete`. Query key is **`where`**
  (object + `$`-operators) — **not** `filter: [[…]]`.
- **`capabilities`** (declare what the body uses, else it throws) — the five legal
  tokens: `api.read`, `api.write`, `api.transaction`, `crypto.uuid`, `log`.
  There is **no hashing capability**: `crypto.hash` was removed in spec 17
  because the sandbox never implemented it.
- Cross-object writes obey the **target's** sharing model — a `public_read`
  target rejects the write with `FORBIDDEN`, and **admin is not exempt**.
- No `console` (use `ctx.log`), no `fetch` (use Connectors), no `import` /
  `require` / module-scope helpers — a `body` must be self-contained.

### 8 Lifecycle Events

| Event | When Fires | Use Case |
|:------|:-----------|:---------|
| `beforeFind` | Before any read (`find` **and** `findOne`) | Filter queries, log access |
| `afterFind` | After any read (`find` **and** `findOne`) | Transform results, enrich data |
| `beforeInsert` | Before creating a record | Set defaults, validate |
| `afterInsert` | After creating a record | Send notifications |
| `beforeUpdate` | Before updating a record (single **or** bulk `multi:true`) | Validate changes |
| `afterUpdate` | After updating a record (single **or** bulk) | Trigger workflows |
| `beforeDelete` | Before deleting a record (single **or** bulk `multi:true`) | Check dependencies |
| `afterDelete` | After deleting a record (single **or** bulk) | Clean up related data |

> **One read event, one write event per kind.** `beforeFind`/`afterFind` fire for
> `findOne` too (the event attaches to record materialization, not the method), and
> the write events fire on bulk `multi:true` operations as well. A bulk write hands
> hooks **no** row-scoping predicate: it lives on the engine-internal
> `OperationContext.ast`, so the RLS / sharing filters composed onto it bind
> the driver call itself, where no handler can widen them — scope a batch through
> `options.where` at the caller. The `after*` events instead dispatch **once per
> matched row**, each on a single-record-shaped context whose `input.id` names that
> row. There is no `beforeFindOne`, `beforeCount`, `beforeAggregate`, or
> `*Many` event.
>
> **Don't reach for a hook when a declarative mechanism already fits:**
> - Read authorization / row filtering → **RLS / permission rules**, not a `beforeFind` hook.
> - Field masking → **field-level metadata** (secret/masked fields), not an `afterFind` hook.
> - Delete guards → a **`beforeDelete`** hook (this is the right tool).

### Common Patterns

See the full documentation for complete examples of:

1. **Setting Default Values** — Auto-populate fields on insert
2. **Data Validation** — Custom validation rules beyond declarative
3. **Preventing Deletion** — Block deletes based on conditions
4. **Data Enrichment** — Calculate and set derived fields
5. **Triggering Workflows** — Fire notifications and integrations
6. **Creating Related Records** — Maintain referential integrity
7. **External API Integration** — Sync with external systems
8. **Multi-Object Logic** — Cascade updates across objects
9. **Conditional Execution** — Use `condition` property
10. **Data Masking** — PII protection in read operations

---

## Registration

Three methods available:

### 1. Declarative (in Stack)

```typescript
// objectstack.config.ts
export default defineStack({
  hooks: [accountHook, contactHook],
});
```

### 2. Programmatic (in Plugin)

```typescript
ctx.ql.registerHook('beforeInsert', async (hookCtx) => {
  // Handler logic
}, { object: 'account', priority: 100 });
```

### 3. Hook Files (Convention)

```typescript
// src/objects/account.hook.ts
export default {
  name: 'account_logic',
  object: 'account',
  events: ['beforeInsert'],
  handler: async (ctx) => { /* ... */ },
};
```

---

## Best Practices

✅ **DO:**
1. Use `before*` for validation, `after*` for side effects
2. Set `async: true` for non-critical background work
3. Use `ctx.api` for cross-object operations
4. Handle errors gracefully with meaningful messages
5. Test hooks in isolation and integration

❌ **DON'T:**
1. Don't perform expensive operations in `before*` hooks
2. Don't create infinite loops (hooks triggering themselves)
3. Don't use `object: '*'` unless absolutely necessary
4. Don't throw in `after*` hooks unless critical
5. Don't assume `ctx.session` exists

---

## See Also

- **[objectstack-data/SKILL.md#lifecycle-hooks](../../objectstack-data/SKILL.md#lifecycle-hooks)** — Complete hooks system overview
- **[objectstack-data/references/data-hooks.md](../../objectstack-data/references/data-hooks.md)** — Full data hooks documentation
- **[objectstack-platform/references/plugin-hooks.md](../../objectstack-platform/references/plugin-hooks.md)** — Plugin hook system
- **[objectstack-automation](../../objectstack-automation/SKILL.md)** — Flows and Workflows for advanced automation

---

**For complete documentation with detailed examples, context API reference, testing strategies, and performance optimization, see the canonical reference:**

→ **[objectstack-data/references/data-hooks.md](../../objectstack-data/references/data-hooks.md)**
