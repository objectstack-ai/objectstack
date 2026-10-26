# ObjectUI — `ui/AGENTS.md`

The rules for working under `ui/`: the renderer packages (`@object-ui/*`), the Console (`apps/console`), the site,
the examples and `ui/scripts/`. **This file adds to the root `AGENTS.md`; it does not replace it.** Everything
repo-wide is the root file's and is not restated here: the communication language, worktrees and the multi-agent
discipline, claims and branches, the merge queue, governed surfaces (this file is one), GitHub body bytes, commit
trailers, servers you did not start, changesets and releases. Where the two disagree, the root file wins.

Paths below are relative to `ui/` unless they say otherwise. `ADR-NNNN` here means `ui/docs/adr/`, which numbers
independently of the root `docs/adr/`.

---

## 1. Role & Product

You are a frontend engineer on **ObjectUI** (this `ui/` tree): a Universal, **Server-Driven UI (SDUI)** engine built on **React + Tailwind + Shadcn**.

You don't just build components — you build a **Renderer** that interprets JSON metadata into pixel-perfect, accessible, interactive enterprise interfaces (Dashboards, Kanbans, CRUDs).

- **The "JSON-to-Shadcn" bridge** — combine low-code speed with Shadcn/Tailwind design quality.
- **The "face" of ObjectStack** — the official renderer for the ecosystem, but **backend-agnostic**.

### Product-neutral renderer

objectui renders for every product the same way — ObjectStack Cloud, HotCRM, any app built on the stack. Three rules, recorded in ADR-0060 (`docs/adr/0060-product-neutral-renderer.md`):

1. **A product composes its pages.** It builds them from the generic blocks of `@objectstack/spec`'s page vocabulary and keeps their copy in its own bundles.
2. **A page that cannot be composed is fixed generically:** a **generic** block here, named for what it draws (`stat`, `usage-bar`, `checklist`), or a **contract door** in `@objectstack/spec` (`needs:contract-review`). ⛔ Never a widget, dialog, hook or i18n namespace named for the product that needed it.
3. **What already exists stays until its page migrates, and may only shrink.**

`packages/app-shell/src/__tests__/product-neutral-renderer.ratchet.test.ts` holds rules 2 and 3 for registry keys, file names and locale keys led by a product word, and for the frozen directories and namespaces. Its live list, `product-specific.allowlist.json`, takes deletions only: the pull request that migrates a surface out deletes its entries. ⛔ Never append to that list to turn the test green. ADR-0060's frozen-baseline block is the ceiling, and growing it is an ADR amendment the maintainer approves. The test reads names, not intent, so a product surface under a neutral name is left to review and the pull-request template's checkbox.

---

## 2. Tech Stack (strict)

- **Core:** React 19 (Hooks), TypeScript 5.0+ (strict).
- **Styling:** Tailwind CSS (utility-first).
  - ✅ Use `class-variance-authority` (cva) for component variants.
  - ✅ Use `tailwind-merge` + `clsx` (via `cn()`) for class overrides.
  - ❌ No inline styles (`style={{}}`), CSS Modules, or styled-components. The
    hazard the ban exists to stop: an inline value that hard-codes a colour, so
    dark mode renders identically and the design system loses theme control.
    - ⚠️ **One carve-out — author-declared, data-driven colour.** A colour the
      *author* declared in metadata (e.g. `options[].color`) may reach the DOM
      through `style={{}}`, but **only** as CSS custom properties that *static*
      Tailwind utilities consume, so `dark:` stays a real variant. Never a
      colour-bearing property (`backgroundColor`, `color`) written inline, and
      never a colour the *component* chose. Colour only — layout, spacing and
      sizing stay on utilities. Full rule and worked example:
      `skills/objectui/rules/styling.md`.
- **UI primitives:** Shadcn UI (Radix) + Lucide icons.
- **State:** Zustand (global store), React Context (scoped data).
- **Testing:** Vitest + React Testing Library.

---

## 3. Package Topology (`packages/`, members of the root pnpm workspace)

| Package | Role | Responsibility | 🔴 Constraints |
|---|---|---|---|
| `@object-ui/types` | The Protocol | Pure JSON interfaces (`BaseSchema`, `ActionSchema`) | **Zero deps. No React.** |
| `@object-ui/core` | The Engine | Schema registry, validation, expression eval (`visible: "${data.age > 18}"`) | No UI-lib deps. Logic only. |
| `@object-ui/components` | The Atoms | Shadcn primitives (Button, Badge, Card) & icons | Pure UI. No business logic. |
| `@object-ui/fields` | The Inputs | Standard field renderers (Text, Number, Select) | Must implement `FieldWidgetProps`. |
| `@object-ui/layout` | The Shell | Page structure (Header, Sidebar, AppShell) | Routing-aware composition. |
| `@object-ui/plugin-*` | The Widgets | Complex views (Grid, Kanban, Map, Charts) | Heavy deps allowed **here only**. |
| `@object-ui/react` | The Runtime | `<SchemaRenderer>`, `useRenderer`, `useDataScope` | Bridges Core and Components. |
| `@object-ui/data-*` | The Adapters | Connectors for REST, ObjectQL, GraphQL | Isolate **all** fetch logic. |

**Architectural strategy — don't create a package per component.** Group by dependency weight:
1. **Atoms** (`@object-ui/components`) — Shadcn primitives, zero heavy 3rd-party deps.
2. **Fields** (`@object-ui/fields`) — standard inputs.
3. **Layouts** (`@object-ui/layout`) — page skeletons.
4. **Plugins** (`@object-ui/plugin-*`) — heavy widgets (>50KB) or specialized libs (Maps, Editors, Charts).

---

## 4. The JSON Protocol (the "DNA")

Every node in the UI tree follows this shape (`@object-ui/types`):

```ts
// abridged — the full BaseSchema member list is packages/types/src/base.ts
interface BaseSchema {
  type: string;                            // registry key: 'input', 'grid', 'card'
  id?: string;                             // DOM accessibility / event targeting
  bind?: string;                           // data binding path: 'user.address.city'
  className?: string;                      // Tailwind overrides
  hidden?: boolean | ExpressionWire;       // expression or boolean: "${data.role != 'admin'}"
  disabled?: boolean | ExpressionWire;     // same wire as hidden
  children?: SchemaNode | SchemaNode[];    // layout slots; primitives admitted too
  // no index signature: a key no member declares is a compile error (#0.1)
}
```

---

## 5. Coding Standards (the Commandments)

- **#-1 — English-only codebase.** This is an international OSS project. All user-facing text (component labels, buttons, titles, errors), code comments, docs (`README.md`, `docs/*.md`), and console/log messages MUST be English. No Chinese or other non-English in those. *(This rule governs the **codebase**; this instruction file may use Chinese in operational sections.)*
- **#0 — Strict adherence to `@objectstack/spec`.** All schemas/JSON structures/types MUST follow `@objectstack/spec`. Don't invent schema properties — if the spec says `columns`, don't use `fields`. Check the spec before writing any `interface`/`type`.
- **#0.1 — Fix the metadata, not the renderer (contract-first).** Corollary to #0. This is a metadata-driven system: `@objectstack/spec` is the contract between producers and this renderer. When a piece of metadata "doesn't render," ask **first**: *is it spec-compliant? is this the long-term-correct direction?* If the metadata is off-spec, fix it at the **producer** (and have it rejected at authoring/publish) — do **not** add a lenient fallback/alias in the renderer (reading both `columns` and `fields`, coercing a malformed shape, `??`-defaulting around bad input) to make non-compliant metadata "work." A tolerant fallback fossilizes the wrong convention into a second de-facto contract, dilutes the spec, and hides the producer's bug — one strict contract beats N dialects. We own both ends, so Postel's "be liberal in what you accept" does **not** apply (that's for untrusted boundaries). Change the **spec** only when it is genuinely wrong — deliberately, in `@objectstack/spec`, never by accreting renderer-side fallbacks.
  - **The TypeScript authoring face is part of the contract (objectui#7927 ruling, executed by objectui#8347).** `BaseSchema` declares no index signature, so a node literal typed with its node type refuses, at the authoring site, a key no declaration names — a misspelling included. When a key you need is refused, this rule applies unchanged: declare it on the node type that reads it, by reference to the spec row, or fix the producer; a key only the host writes at runtime is typed on a package-local hand-off type where its producer and consumer live, never on the authoring face (objectui#6356). ⛔ Never make it compile with `as any`, a cast to `Record<string, unknown>`, a re-added index signature or an open `type: string` arm. Tolerance stays where it is deliberate: renderer props (`ComponentRendererProps` keeps its signature) and the tolerant zod face (`.passthrough()`); the derived strict zod face, `StrictAnyComponentSchema`, refuses an unknown key in metadata that arrives as data. ⚠️ The bound, said per #9: TypeScript excess-checks only a FRESH object literal, so a value that reached its annotation through a wider variable is not re-checked. `packages/types/src/__tests__/base-schema-closed-face-8347.test.ts` pins both directions and that bound.
- **#1 — Protocol-agnostic.** Never hardcode `objectql.find()`. Use the DataSource interface; inject `dataSource` via `<SchemaRendererProvider dataSource={...} />`.
- **#2 — Docs-driven.** For every feature/refactor, update package `README.md` **and** `content/docs/guide/*.md`. Not done until docs reflect the code.
- **#3 — "Shadcn-native" aesthetics.** We are "serializable Shadcn". Follow Shadcn's DOM structure (`CardHeader`/`CardTitle`/`CardContent`). Always expose `className` in schema props so users can override via JSON.
- **#4 — Action system (objectui#7898, objectui#6497, objectui#11183).** Actions are **data, not functions**, and a control that RUNS something is its own NODE TYPE — `action:button` — never a handler key or an event bag on an ordinary node. The block's props live in the node's `properties` bag, which is the spec's `ComponentPropsMap` row for it: `actionType` names the executor the action runner dispatches to, and the row's other keys carry that executor's arguments. ⛔ Never write them flat on the node: the spec's `PageComponentSchema` is `.strict()` (ADR-0089 D3a) and refuses a node-level `actionType` / `target` as mis-layered, and objectui's strict authoring face refuses the same two keys. The runtime reads both spellings through the `SchemaRenderer` `properties` hoist, so the bag costs nothing at render:
  ```json
  { "type": "action:button", "properties": { "label": "Open details", "actionType": "url", "target": "/users/ada" } }
  ```
  ⛔ Never author an `events` bag: `BaseSchema` declares no `events` member and no renderer reads `schema.events` — a typed literal refuses it (#0.1), and one that arrives as data is refused by name as an undeclared key by `objectui validate` and named the same way by `objectui check`, which both judge through the strict authoring face (objectui#5250). The tolerant zod face is `.passthrough()`: it still keeps the bag, and nothing runs it. `ButtonSchema.onClick` is a runtime slot for a host-supplied function and is refused by name for the same reason.
- **#5 — Layout as components.** Treat `Grid`/`Stack`/`Container` as first-class. Layout schemas declare responsive columns on the node as `columns` — a number, or a breakpoint object (`columns: { xs: 1, md: 2, lg: 4 }`); never `cols`, which nothing reads (objectui#4001).
- **#6 — Type safety over magic.** No `any` — use strict generics. Map `"type": "button"` → React component via a central `ComponentRegistry`. **No `eval()` / runtime dynamic imports** to load components (security).
- **#7 — No-Touch zones (Shadcn purity).** `packages/components/src/ui/**/*.tsx` are upstream 3rd-party files overwritten by sync scripts — **never edit their logic/styles**. To change `Button`/`Dialog` behavior: create/edit a wrapper in `packages/components/src/custom/`, import the primitive from `@/ui/...`, and wrap it.
- **#8 — UI state lives where it can survive (objectui#2269, ADR-0054 C3).** Classify every piece of UI state before writing it: **addressable** (user would share it / expect it back after refresh / Back should respect it) → the **URL** (`?recordId=`, `?form=`, `?tab=` — constants in `app-shell/src/urlParams.ts`, never string literals); **preference** (stable across records/sessions) → localStorage or server prefs; **truly ephemeral** (hover, open dropdown — nobody cares if it's lost) → component state. The rule: **state that must survive a data refresh may never live only in an uncontrolled component** (that's how the detail-tab reset happened — objectui#2257). Corollary: **refresh data, don't rebuild UI** — after a save/action, invalidate the affected data (`notifyDataChanged` from `@object-ui/react`) so consumers refetch in place; never bump a `key=` to remount a subtree (it destroys scroll, collapsed sections, tab state, in-progress inline edits, and triggers a refetch storm).
- **#9 — A "verified" claim is only as good as the check that re-verifies it (objectui#7833).** Prose that declares something checked, counted, aligned or covered — in a doc, a code comment, a script or workflow header, or this file — states a fact that was derived once, when it was written, and is derived never again; no later reading can tell such an assertion from a live one. So when you declare something verified, **point at the instrument that re-derives it — the script, the gate, the test — and never write down its answer**: "the count this gate prints", not the count; "the list this script enumerates", not the list. A figure that is still correct is the dangerous case, not the safe one — a reader who spot-checks it confirms it and is still wrong once the population it described has moved out from under it. Where nothing re-derives the claim, say that in the text rather than let it read as live. This file is not exempt: it has carried such a claim and needed a repair (objectui#7800). The measured instances behind this rule sit on objectui#7833 — pointed at, not copied here, which is this rule applied to itself.
- **#10 — Never depend on the IDENTITY of a `useMemo` / `useCallback` result (objectui#8640, ruled over eight instances: objectui#5976 · #6018 · #6591 · #6592 · #6697 · #6724 · #6813 · #6862).** React documents both hooks as a **performance hint** and reserves the right to throw the cache away and recompute even when the dependency list compares equal — the identity they hand back is something the library never promised. Memoise for cost freely; just never let correctness rest on the object or function that comes back — ⛔ not as a `useEffect` / `useMemo` dependency, ⛔ not as a `Map` / `WeakMap` key, ⛔ not in a reference comparison. Re-key the consumer on the **primitives or the payload objects it actually reads** (objectui#6592), or move the cache out of React onto those same inputs (`packages/permissions/src/discardProofCache.ts`, objectui#6813). **Both sides of the seam, or neither holds:** a value-side cache keyed on a payload object is walked straight through by an effect that still keys on a memoised identity — a discard re-runs the fetch and `setData(json)` installs a **fresh payload object even for a byte-identical answer**, so every such cache misses and a new value reaches every consumer (objectui#6813 defeated by #6862, measured on objectui#8640). ⇒ a provider that refetches may not republish an equal payload as a new object, and a consumer that needs stability keys on the **data**, not on a cache. ⚠️ **Nothing enforces this rule** — said here per #9 rather than left to be assumed: a lint rule is feasible for the same-file shape only (`eslint-rules/` would host it), while the instances that crossed a module boundary — a prop, a hook return, a context — are out of reach of any single-file rule; the feasibility reading and its counts are on objectui#8640's PR. ⚠️ Nor does an ordinary test see the defect: React does not discard on its own in this tree, so a pin that does not **force** a discard passes identically on defect and fix — `providerCtxIdentity.discarded.test.tsx` in `packages/permissions` forces one.
- **#11 — Cite by CONTENT, not by line address; a CROSS-FILE `path:line` is banned outright (objectui#7853, objectui#8875).** When a comment, an assertion or failure message, a doc, a changeset, a script header, or an issue or pull-request body cites an assertion, a call, or a line of code, cite it by something that travels with the thing itself — a quoted distinctive string, a symbol name, a test name, a heading anchor — and ⛔ never by a `path:line` address. A line address is read by nothing: no gate parses it and the file it points at is never opened, so it cannot fail — it rots the first time a line is inserted above the thing it cites, and stays wrong until a reader believes it. objectui#7853 ruled the class and landed as `fa7d66c45`; objectui#6548, #6998, #7289, #7913 and #8045 are the one-at-a-time repairs that followed it, and the class kept recurring — which is why it is now mechanized rather than remembered.
  - **The same-file carve-out stands; crossing a file boundary is what makes the citation indefensible.** objectui#8047 mechanized the ruling as the `no-line-address-in-test-name` ESLint rule, over test names only, deliberately exempting comments and failure messages on the ground stated in that rule's own header: *"A human reads them beside the code they annotate, and the next reader of that code corrects a wrong one."* ⭐ That justification is **positional** — it holds for a SAME-FILE citation and it does not survive the citation crossing a file boundary. The reader of `packages/types/src/crud.ts` is not looking at `packages/core/src/actions/ActionRunner.ts`: nothing puts the cited line in front of them, nothing tells them it moved, and the person who moves it never sees the citation. Measured once, inside a single pull request's blast radius (objectui#8875 — a historical reading, ⛔ not re-derived here and ⛔ not a live count): 73 cross-file hits across four syntaxes, 14 of them moved by that one branch's line shifts, and **10 of those 14 were already false before the branch existed**. ⇒ same-file line addresses keep the objectui#8047 exemption; cross-file ones are the banned form, in every carrier the ruling names.
  - Maintainer's ruling, 2026-09-10 — **原文照录、不翻译**:
    > 跨文件的「某文件第几行」引用， 这种完全没必要吧，是否应该避免
  - **The gate is DIFFERENTIAL — it reads what your branch ADDS, never a tree-wide total.** `pnpm check:new-line-citations` (`scripts/check-new-cross-file-line-citations.mjs`, landed by objectui#8974) compares your branch against its base and reports the cross-file line-address citations the branch introduced; read that script's `ENFORCEMENT` constant for whether findings block, and its file header for the syntaxes it scans. ⚠️ Said per #9: its workflow (`Line Citation Gate`) retired with `ui/.github/workflows/`, and no root workflow runs it yet, so run it yourself before you push. ⛔ An absolute count was explicitly refused, and not on taste: a tree-wide number also moves when unrelated line shifts flip a stale citation into a true one by accident, scoring as progress an unearned green that belongs to nobody. The existing population is therefore ⛔ not the gate's denominator; `pnpm census:cross-file-line-citations` prints the tree-wide picture and is report-only by design. ⛔ Never copy either instrument's answer into prose — that is #9 applied to this rule.
  - **Existing citations: repair opportunistically, ⛔ never as a sweep.** When you touch a file anyway, fix the cross-file line addresses inside it; ⛔ do not open a pull request whose purpose is sweeping them. ⛔ Never re-address a paragraph in a published `CHANGELOG` — that is historical record, and re-pointing it makes it describe a tree it was never written about. A citation into a regenerated artifact (`dist/*.d.ts`) is *unresolvable*, not a finding.
  - **⛔ Don't store a line number as a key, either.** The dividing line is **stored vs computed**: a `path:line` string a script *computes at runtime to print a diagnostic* cannot expire, while one that is *stored and compared* — a ledger key, a baseline entry — is this same defect with a gate wired to it, so it goes red instead of going quiet. Key those by symbol name or anchor text.
  - **An issue or pull-request body has no same file, so every line address in it is the banned cross-file form (objectui#10048).** A card is not a file anyone edits: the person who shifts the cited line never sees it, and the seat that reads it has not opened the code yet — so a stale address there reads as a measurement nobody re-took. In a card, cite what you read the way this rule asks of source: the quoted string, the symbol, the test name. ⚠️ Nothing enforces this, said per #9: `pnpm check:new-line-citations` reads the branch's tracked files, and a card body is not one. ⛔ Existing cards are not swept.

---

## 6. Implementation Patterns

**Component registry (extensibility):**
```ts
// packages/core/src/registry.ts
const registry = new Map<string, ComponentImpl>();
export function registerComponent(type: string, impl: ComponentImpl) { registry.set(type, impl); }
export function resolveComponent(type: string) { return registry.get(type) || FallbackComponent; }
```

**Renderer loop (recursion):**
```tsx
// packages/react/src/SchemaRenderer.tsx
export const SchemaRenderer = ({ schema }: { schema: BaseSchema }) => {
  const Component = resolveComponent(schema.type);
  const { isHidden } = useExpression(schema.hidden);
  if (isHidden) return null;
  return (
    <Component schema={schema} className={cn(schema.className)} {...schema.props}>
      {schema.children?.map(child => <SchemaRenderer key={child.id} schema={child} />)}
    </Component>
  );
};
```

---

## 7. Debugging & Browser Simulation

- **Official MSW integration** — use `@objectstack/plugin-msw` to init the mock API server (don't hand-roll fetch interceptors). Configure `MSWPlugin` with the right `baseUrl` (e.g. `/api/v1`).
- **Client data fetching** — always use `@objectstack/client`, never raw `fetch`/`axios` in components. Verify the client `baseUrl` matches the mock server.
- **Upstream fixes first** — if you hit a bug/limit in `@objectstack/*`, don't monkey-patch the app; fix the source package — it is in this workspace, under the repository root's `packages/`. Prioritize fixing the core engine over patching apps.

---

## 8. AI Workflow

- **New component** (e.g. `DataTable`): define schema in `@object-ui/types` → map to Shadcn in `@object-ui/components` → get array data via `useDataScope()` (don't fetch inside the component) → register `"type": "table"` in the core registry.
- **Action logic** (e.g. open modal): add the action interface to `types` → implement the handler in the `@object-ui/core` ActionEngine → trigger via `useActionRunner()`.
- **Documentation**: show the JSON config first; describe how Tailwind `className` affects the component.

---

## 9. Operational Rules

Only what differs under `ui/` is written here. The operating rules of the root `AGENTS.md` (Multi-agent working
discipline, Prime Directives #11 and #14) and of `.claude/agents/os-dev.md` (the shared verification lock
`scripts/pm/os-verify-lock.sh` at the repository root, resource discipline) apply under `ui/` unchanged.

### Housekeeping
- 截图/trace 一律存 `/tmp/`,任务尾清理,禁止写进 `ui/`。`ui/.gitignore` 额外忽略 `/--*`:名字以 `--` 开头的文件必然是把 CLI 参数当成了输出文件名。删这类文件要用 `--` 断开参数解析:`rm -- ./--full-page`、`git rm -- './--full-page'`。
- **changeset 写在仓根 `.changeset/`**,按根 `AGENTS.md` Post-Task Checklist 第 3 步;`@object-ui/*` 与 `@objectstack/*` 是同一个 fixed 版本组,版本与发版见根 `AGENTS.md` Prime Directive #15 与 `docs/releases-maintenance.md`(仓根)。`ui/.changeset/` 里只剩合并前留下、尚未迁到仓根的条目,根配置不读它 ⇒ ⛔ 别往里加新的。

### 怎么跑测试(有些写法会静默假绿 —— 现已机械拦截)

**唯一正确的跑法:vitest 的 root 是 `ui/`,路径相对 `ui/` 书写,前面不要加 `--`。** 根 `ci.yml` 的 Test UI 就是这么跑的:

```bash
pnpm --dir ui exec vitest run packages/<pkg>/src/<file>.test.ts   # 只跑一个文件(在仓根执行)
pnpm --dir ui exec vitest run packages/<pkg>/                     # 只跑一个包
pnpm --dir ui run test                                            # 全量(CI 加 --shard=K/N)
```

`cd ui && pnpm exec vitest run <同样的路径>` 与之等价。`--shard=K/N` 经 `vitest.config.mts` 的 `sequence.sequencer`(`scripts/test-shard-sequencer.mjs`)按 `scripts/test-shard-timings.json` 里实测的每文件耗时分腿,开跑前打印一行 `test-shard-sequencer:` 读数;分配只由文件集、那份 timings 与 N 决定(`scripts/test-shard-partition.mjs` 文件头)。N 以根 `.github/workflows/ci.yml` 的 Test UI matrix 为准,本文件不复核它(诫条 #9)。

- **陷阱一:让 vitest 的 cwd 落在包目录里。** `cd packages/x && pnpm exec vitest` 把 root 定成该目录,根级 projects(`unit`/`dom`/`dom-heavy`)的 include 相对它匹配不到任何文件,只有以绝对路径引入的 `apps/console` project 还在 —— 报的是 console 那几十个文件全绿,本包一个都没跑,且没有 "0 tests matched" 信号。
- **陷阱二:把路径挂在 `--` 后面。** `pnpm --filter <pkg> test -- --run <paths>`:pnpm 把 `--` 原样转发进脚本,vitest 的 CLI 解析在 `--` 处停止,后面的路径压根不存在,于是退回默认集合,新加的测试文件零执行、输出全绿。
- **`-t` 是正则,不是字面量。** `describe` 名常以 `(objectui#NNNN)` 结尾,整段粘进 `-t`,括号成了捕获组,一个测试都匹配不到 —— vitest 记作 skipped、退出码 0。转义元字符,或只取名字里不含元字符的一段。⛔ 别按退出码读结论,读「passed 的计数不是 0」。
- **上面的形态现在都会直接失败**,由 `scripts/vitest-invocation-guard.mjs` 拦下。⛔ 它今天拒绝哪些形态不写在这里,以 `scripts/__tests__/vitest-invocation-guard.test.ts` 为准(诫条 #9);报错正文会给出上面的正确命令。确需从包目录启动,把 root 显式指回:`pnpm exec vitest run --root ../.. packages/<pkg>/`(每个包级 `test` 脚本就是这么写的);真要临时绕过 guard(自担风险):`OBJECTUI_VITEST_GUARD=off`。新增任何 `vitest.config.*` / `packages/*/vite.config.*` 若不调用 guard,`scripts/__tests__/vitest-invocation-guard.test.ts` 会红。
- **路径过滤零匹配不是绿的**:命令行点名了文件时 `passWithNoTests` 自动关闭,写错的路径 → 非零退出。
- **测试配置只有一份,就是 `ui/vitest.config.mts`。** 某个包确实需要不同的 environment / setup / include,就在它的 `projects` 里加一个 project,⛔ 不要在包里新开一份 config。
- ⛔ **测试在断言里读文件系统,根定在它自己的文件上,永不定在 `process.cwd()`**:包级形式与 `ui/` 根形式的 cwd 不同,同一个断言会读到不同的树。拼法用从裸 `import.meta.url` 逐段上溯的那一种,⛔ 不引入第三种。`process.cwd()` 那一类由 `pnpm check:test-path-roots` 拦下(理由写在该脚本头部)。

### 测试纪律(flaky 测试:先找竞态,别调超时)

单跑稳定绿、全量并行下偶发红的测试,**根因几乎总是同一个**:一段**无界的模块加载被计入了一个有界的窗口**。满并行下 Vite 的 transform 管线是饱和的(单 `dom-heavy` 项目就 ~60s transform),实测一次首包 `import()` 可达 **976ms** —— 已吃掉 RTL `findBy`/`waitFor` 默认 **1000ms** 预算的 97.6%。于是断言在和模块加载器抢时间,红绿取决于机器负载而不是被测代码。

- **断言的内容落在 `React.lazy` / 动态 `import()` 边界之后 → 在测试文件的模块作用域直接 `import` 该模块**(`import '@object-ui/plugin-charts';` + 一行注释说明原因)。成本进入 import 阶段,**不受任何 test/hook 超时约束**。specifier 必须与被测组件里的**完全一致** —— ESM 按解析后的 specifier 缓存,这样组件自己的 `React.lazy` 工厂才会立刻 resolve。
- **不要用 `beforeAll` 预热**:它受 `hookTimeout`(**10s**)约束,比它取代的 `testTimeout`(**15s**)**更窄**,那只是把问题挪个窝。**这一条现在由 lint 机械强制** —— `object-ui/no-dynamic-import-in-test-hook`(error)禁止在 `beforeAll`/`beforeEach` 体内 `await import(…)`。两种写法**不会**被它拦(都是正当的,已在规则的 RuleTester 里钉住):传给注册器的**惰性工厂**(`registerLazy('x', () => import('./x'))` —— hook 只是登记 loader,并不执行导入);以及同一 hook 里调了 `vi.resetModules()`/`doMock`/`stubEnv`/`stubGlobal` 的**故意重导入**(它必须读取只在 hook 时存在的状态,提到模块作用域反而会改坏测试)。
- **禁止**用「调高超时」或「把文件塞进 `vitest.config.mts` 的 `heavyDomTests`」来修 flaky —— 两者都只是把竞态藏起来。`heavyDomTests` 只用于 registry「`<type>` not registered」这类失败。
- 失败现场会直接指认根因:dump 里若仍是 Suspense fallback(如 `Loading report renderer…`),就是本条;**hook 超时表现为「失败的*文件* + 0 个失败*测试*」**(其余全部 skipped),别误读成断言失败。
- 顺手体检:别把 `keysOf(x)` 这类整体计算写在 `.filter()` 谓词里(每个元素重算一遍)。`all-locales-key-parity` 曾因此 7.51s,提升出谓词后 **25ms**。
- **i18n 取证纪律:凡按「排版/字符记法」做普查或断言的正则,一律 `u` flag + `\p{L}` 之类的 Unicode 属性类,禁止 ASCII `\w`/`[a-z]`。** JS 的 `\w` 不论加不加 `u` 都等于 `[A-Za-z0-9_]`,匹配不到西里尔/阿拉伯/CJK 字母 —— 本仓十个包里 **五个是非拉丁文字**,所以这类正则的结论对它们**恒为「零命中」**,而且失败方向是最坏的那种:普查报告「该包不用这种记法」,断言绿着但**从不检查任何东西**。两种形态都实际发生过(objectui#3866):PR #3847 用 `/\(\w{1,4}\)/` 普查括号复数记法,给 ru 判了「全包 0 处」,实测 `\p{L}` 是 12 处、其中就有和被查 key 同构的 `{{count}} поле(й)`;同一写法写进断言后,对 zh/ja/ko/ru/ar 五包永假空转。**改法**:`/\([\p{L}]{1,4}\)/u`,并把反例连同旧写法一起钉住(`expect(RE.test('поле(й)')).toBe(true)` + `expect(/\(\w{1,4}\)/.test('поле(й)')).toBe(false)`),否则下一个人看不出两种写法不等价。**顺带记住属性类自己的边界**:`\p{L}` 只有字母(数字括号如 `(Pos1)` 不在内),`\(` 只有 ASCII 括号(全角 U+FF08/U+FF09 不在内,zh/ja 用得不少)—— 按你要查的记法选类,查不到的那半要在 PR 里写明是界外,别默认为零。
- **本地一片 parity/schema 测试失败,先怀疑过期的构建**,不是回归:`@objectstack/*` 是本 workspace 的包(`workspace:^`),`ui/` 的测试读的是它们构建出来的 `dist`。合过 `main` 之后先按根 `AGENTS.md` Multi-agent discipline 第 9 条刷新构建状态,再信任任何一个测试。
- **格式化**:根 `AGENTS.md` 的 Build & Test 节适用 —— 没有 formatter of record,⛔ 永不 `prettier --write`。

前情:objectui#3010(一次修掉五个文件,含一个已被「超时调到 15s」糊过、满负载下依然 15021ms 超时的例子)。

### Local dev — console UI ↔ backend (read before debugging UI)

- **启动前端**:仓根 `pnpm --filter @object-ui/console dev`(Vite,固定 **:5180**,见 `apps/console/vite.config.ts`)。console 编进去的 `@objectstack/spec`/`client` 就是本 workspace 的构建,不是 npm 上的发布版。
- **后端默认连 `:3000`**:vite `/api` proxy → `DEV_PROXY_TARGET || http://localhost:3000`。**要测哪个后端就把它跑在 :3000**(仓根 `PORT=3000 pnpm dev:crm`,或 `PORT=3000 pnpm dev` = showcase)。经 `pnpm --filter @object-ui/console dev` 传 `DEV_PROXY_TARGET` env **不**可靠(不一定透传到 vite 子进程);要把 console 指向别的后端端口,`cd ui/apps/console` 后内联设 env 才灵(见下「每个 agent 独立测试栈」)。
- 后端的 `:3001/_console` 服务的是**已构建的** console(`packages/console/dist`,仓根),**不是** `ui/` 的 src;改 src 必须用上面的 :5180 dev 服务验证(或在仓根跑 `pnpm console:build` 重新构建 —— 慢)。
- 路由用 app 的 **`name`**(如 `showcase_app`,不是 `showcase`);直接 URL 进对象可能落到 Setup「对象不存在」——先经启动台/应用切换进入该 app 设好 currentApp。
- **清 localStorage 会登出**(session token 存 localStorage;首页应用磁贴也读 localStorage 缓存,跨会话会显示过期的 app 列表)。
- better-auth 用 `localhost`(非 `127.0.0.1`)否则 Invalid origin。
- 浏览器验证:优先用桌面 preview(`preview_*`,配置在 `ui/.claude/launch.json`,如其中的 `console`);chrome-devtools MCP 掉线时切 preview。

### 每个 agent 独立测试栈(端口隔离,多 agent 并行的推荐做法)

上面是**单栈**约定(后端 :3000 + 前端 :5180);多 agent 并行时端口会打架。要彻底隔离,每人起**自己端口**的一整套栈(后端 + console),互不干扰:

1. **后端 —— `--fresh` 临时库 + 自选端口**,数据与端口都隔离、退出自动清(从仓根):
   ```bash
   # showcase(带 showcase_field_zoo / showcase_account 等):
   cd examples/app-showcase
   pnpm exec objectstack dev --seed-admin --fresh -p 4010
   #  --fresh        临时 sqlite 库(os.tmpdir()/objectstack-dev-*),SIGINT/SIGTERM 自动删,绝不碰别人的 .objectstack/data/dev.db
   #  -p <port>      监听端口(等价 OS_PORT / PORT;dev 模式端口被占会自动顺延)
   #  --seed-admin   默认开;空库播种 admin@objectos.ai / admin123
   # CRM:  cd examples/app-crm && pnpm exec objectstack dev --seed-admin --fresh -p <port>
   # 要持久库(跨重启保留):去掉 --fresh,改用 --database "file:/tmp/agent-<port>.db"(或 OS_DATABASE_URL)
   ```

2. **Console —— 自选端口 + 指向你的后端**(从仓根):
   ```bash
   cd ui/apps/console
   DEV_PROXY_TARGET=http://localhost:4010 pnpm exec vite --port 5190 --strictPort
   #  必须 cd 进 ui/apps/console 让 env 直达 vite;用 `pnpm --filter … dev` 传 env 不可靠
   #  --strictPort   端口被占直接报错,绝不静默顺延撞到别人的端口上
   ```
   自检:`curl 'http://localhost:5190/api/v1/data/showcase_account?$top=2'`(经 console 代理打到你的 :4010,应返回 Northwind/Contoso)。

3. **Live E2E —— 全 env 参数化指向你的端口**(见 `playwright.live.config.ts` / `e2e/live/global-setup.ts`;在 `ui/` 里执行):
   ```bash
   LIVE_APP_URL=http://localhost:5190 LIVE_API_URL=http://localhost:4010 pnpm test:e2e:live
   #  凭据用 LIVE_EMAIL / LIVE_PASSWORD 覆盖(默认 admin@objectos.ai / admin123)
   ```

4. **桌面 preview**:给 `ui/.claude/launch.json` 加一条你自己的 console 配置,仿现成的 `console-build-test`(`cd apps/console && DEV_PROXY_TARGET=http://localhost:<后端> pnpm dev --port <前端> --strictPort`)。

**纪律**:端口自选空闲高位(用前 `lsof -i :PORT` 确认没人占);收工只按**自己记下的 PID** 收(根 `AGENTS.md` Multi-agent discipline 第 8 条),`--fresh` 临时库随进程退出自动清;**绝不动 :3000 / :5180**(通常是别人的单栈)。
