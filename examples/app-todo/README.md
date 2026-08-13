# ObjectStack Todo Example

A comprehensive Todo application demonstrating the ObjectStack Protocol with task management, automation, dashboards, and reports.

## 🎯 Purpose

This example serves as a **quick-start reference** for learning ObjectStack basics. It demonstrates:
- Object definition with essential field types and validations (record
  state lives in validation rules per ADR-0020 — there is no `workflow` type)
- Actions for task management (complete, defer, clone, etc.)
- Dashboard with key metrics and visualizations, backed by the dataset
  semantic layer (ADR-0021)
- Reports for status, priority, owner, and time-tracking analysis
- Automation flows for reminders, escalation, and recurring tasks
- i18n bundles for **en / zh-CN / ja-JP** (the ja-JP bundle is unique
  in-repo)
- Full configuration using `objectstack.config.ts` with the standard **by-type** layout

For a **comprehensive enterprise example** with advanced features (AI agents, security profiles, sharing rules), see the **[HotCRM reference app](https://github.com/objectstack-ai/hotcrm)** (separate repository).

## 📂 Structure

Follows the **by-type** directory layout — the ObjectStack standard aligned with Salesforce DX:

```
examples/app-todo/
├── src/
│   ├── objects/                     # 📦 Data Models
│   │   ├── task.object.ts           #    Task object (fields + validation rules)
│   │   └── task.hook.ts             #    Data hooks
│   ├── views/                       # 👓 List-view lenses (incl. Overdue — ADR-0017)
│   ├── datasets/                    # 🧮 Semantic layer feeding dashboard/reports (ADR-0021)
│   ├── actions/                     # ⚡ Complete, Start, Defer, Clone, Mass Complete, Export
│   ├── apps/                        # 🚀 Navigation, branding
│   ├── dashboards/                  # 📊 Metrics, charts, task lists
│   ├── reports/                     # 📈 By status / priority / owner / completed / time tracking
│   ├── flows/                       # 🔄 Reminder, escalation, completion, quick-add
│   ├── translations/                # 🌍 en · zh-CN · ja-JP bundles (+ completeness spec)
│   ├── data/                        # 🌱 Seed data
│   └── docs/                        # 📚 Package docs (ADR-0046)
├── test/
│   ├── seed-check.ts                # 🧪 Seed/boot verification script (tsx)
│   └── mcp-actions.e2e.ts           # 🤖 MCP business-action E2E (pnpm test:mcp)
├── objectstack.config.ts            # Application manifest
└── README.md
```

## 📋 Features Demonstrated

### Object Definition
- **Task Object** (`task`) with 20+ fields covering all common patterns

### Field Types Covered
- ✅ **Text** (`subject`) — Task title (required, searchable)
- ✅ **Markdown** (`description`) — Rich description
- ✅ **Select** (`status`, `priority`, `category`) — Single-select with colors
- ✅ **Multi-Select** (`tags`) — Multiple tag selection
- ✅ **Date / DateTime** (`due_date`, `reminder_date`, `completed_date`)
- ✅ **Boolean** (`is_recurring`)
- ✅ **Number** (`estimated_hours`, `actual_hours`, `recurrence_interval`)
- ✅ **Percent** (`progress_percent`) — Progress tracking
- ✅ **Lookup** (`owner`) — User assignment
- ✅ **Color** (`category_color`) — Color picker with presets
- ✅ **Rich Text** (`notes`) — Formatted notes

### Actions (8)
- **Complete Task** / **Start Task** — Status transitions
- **Defer Task** — Reschedule with reason
- **Set Reminder** / **Clone Task** — Utility actions
- **Mass Complete** / **Delete Completed** / **Export CSV** — Bulk operations

### Dashboard
- 4 Key Metrics (total, completed today, overdue, completion rate)
- Charts (status pie, priority bar, weekly trend line, category donut)
- Task tables (overdue, due today)

### Reports (5)
- Tasks by Status / Priority / Owner
- Completed Tasks
- Time Tracking (estimated vs actual hours matrix)
- (Overdue Tasks is deliberately **not** a report — a flat record list is a
  ListView lens, ADR-0021; see `src/views/task.view.ts`)

### Automation Flows (4)
- **Task Reminder** — Daily scheduled reminder for tasks due tomorrow
- **Overdue Escalation** — Auto-escalate tasks overdue by 3+ days
- **Task Completion** — Auto-create next occurrence for recurring tasks
- **Quick Add Task** — Screen flow for fast task creation

### Validations & Automation
- Completed date required when status is "completed" (validation rule)
- Recurrence type required for recurring tasks (validation rule)
- Auto-set `completed_date` on the completion transition, cleared on reopen
  (data hook). Completion and overdue state are read from `status` / `due_date`
  directly — the app declares no derived boolean flags (#7226)
- Auto-detect overdue tasks and send urgent notifications (flow)

## 💡 How to Run

### Prerequisites
- Node.js 22+ and pnpm 8+
- Install from monorepo root: `corepack enable && pnpm install`

### Type Check
```bash
cd examples/app-todo
pnpm typecheck
# Expected: No errors — all types validated against @objectstack/spec
```

### Build
```bash
pnpm --filter @objectstack/example-todo build
# Expected: Build succeeds, generates dist/ output
```

### Explore the Config
Open `objectstack.config.ts` to see how all pieces connect via `defineStack()`.

## 🤖 MCP Demo — business actions over the open AI surface

The open framework exposes AI via **`@objectstack/mcp`** (BYO-AI; the
in-product chat lives in the cloud distribution — ADR-0063). This example
ships a real end-to-end proof, **no API key required**:

```bash
pnpm --filter @objectstack/example-todo test:mcp
```

What it does (`test/mcp-actions.e2e.ts`):

1. Boots a self-host composition of ONLY the open framework —
   `@objectstack/runtime` + ObjectQL + a driver + this seeded app + `@objectstack/mcp`
2. Drives the real `MCPServerRuntime` over JSON-RPC — the same code path an
   external MCP client (e.g. Claude) hits
3. Lists the app's business actions as MCP tools, then executes one via
   `run_action` → `engine.executeAction` → the registered handler → the
   real driver, **permission-enforced** end to end

Point any MCP client at the running server and the same tools are live —
that is the community-edition "ask in natural language, act on real data"
path.

## 📖 Learning Path

1. **Start Here** — Simple task management with full protocol coverage
2. **Next Step** — [HotCRM](https://github.com/objectstack-ai/hotcrm) — Enterprise features, AI agents, security
3. **Then** — [Official Documentation](../../content/docs/) — Complete protocol reference

## 🔗 Related Resources

- [Project Structure Guide](../../content/prompts/plugin/project-structure.prompt.md) — Standard directory layout
- [Metadata Protocol](../../content/prompts/plugin/metadata.prompt.md) — File suffix system
- [Object Schema Reference](../../packages/spec/src/data/object.zod.ts)
- [Field Types Reference](../../packages/spec/src/data/field.zod.ts)
- [HotCRM](https://github.com/objectstack-ai/hotcrm) — Full-featured enterprise reference (separate repo)

## 📝 License

Apache-2.0
