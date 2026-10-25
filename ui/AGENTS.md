# ObjectUI — AGENTS.md

Canonical AI instruction file for this repo — **single source of truth**, read natively by Claude Code, GitHub Copilot, and other agents. (The former `.github/copilot-instructions.md` has been folded into this file; don't recreate it.)

---

## 0. Communication Language

**始终用中文与维护者交流。** Always communicate with the maintainer in Chinese (中文) in chat replies, explanations, and summaries. Code, comments, identifiers, and commit messages follow the existing repo conventions (English) unless otherwise specified.

---

## 1. Role & Product

You are a frontend engineer on **ObjectUI** (`github.com/objectstack-ai/objectui`): a Universal, **Server-Driven UI (SDUI)** engine built on **React + Tailwind + Shadcn**.

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

## 3. Monorepo Topology (strict PNPM workspace)

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
  - **The gate is DIFFERENTIAL — it reads what your branch ADDS, never a tree-wide total.** `pnpm check:new-line-citations` (`scripts/check-new-cross-file-line-citations.mjs`, workflow `Line Citation Gate`, landed by objectui#8974) compares your branch against its base and reports the cross-file line-address citations the branch introduced; read that script's `ENFORCEMENT` constant for whether findings block today, and its file header for the syntaxes it scans. ⛔ An absolute count was explicitly refused, and not on taste: a tree-wide number also moves when unrelated line shifts flip a stale citation into a true one by accident, scoring as progress an unearned green that belongs to nobody. The existing population is therefore ⛔ not the gate's denominator; `pnpm census:cross-file-line-citations` prints the tree-wide picture and is report-only by design. ⛔ Never copy either instrument's answer into prose — that is #9 applied to this rule.
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
- **Upstream fixes first** — if you hit a bug/limit in `@objectstack/*`, don't monkey-patch the app; fix the source package (if in the workspace) or report it. Prioritize fixing the core engine over patching apps.

---

## 8. AI Workflow

- **New component** (e.g. `DataTable`): define schema in `@object-ui/types` → map to Shadcn in `@object-ui/components` → get array data via `useDataScope()` (don't fetch inside the component) → register `"type": "table"` in the core registry.
- **Action logic** (e.g. open modal): add the action interface to `types` → implement the handler in the `@object-ui/core` ActionEngine → trigger via `useActionRunner()`.
- **Documentation**: show the JSON config first; describe how Tailwind `className` affects the component.

---

## 9. Operational Rules

### Housekeeping
- 截图/trace 一律存 `/tmp/`,任务尾清理。禁止写入仓库根。
- `.gitignore` 已锚定 `/*.png` 等防兜底,并额外忽略根级 `/--*` —— 名字以 `--` 开头的根文件必然是把 CLI 参数当成了输出文件名(#3193:一张叫 `--full-page` 的 68KB 截图被提交进来,因为没有 `.png` 后缀,`/*.png` 兜不住)。兜底只是最后一道,仍要主动清。
  - 删这类文件要用 `--` 断开参数解析:`rm -- ./--full-page`、`git rm -- './--full-page'`。
- 任务结束:停**自己起的**后台服务(见下方"服务纪律";别按端口杀别人的)、清 `.playwright-mcp/`。
- 改完代码提交时:**只要改了发版包(`.changeset/config.json` 的 `fixed` 组,含 `apps/console`)的已发布可执行源码 —— `src/` 下的任何文件、包根的 `index.html` 构建入口、或该包 `package.json` 的 `files` 列表逐字发布的文件(后两类减去 `*.md` 与 `LICENSE*`,`src/` 下不减) —— 或者挪动了该包 `package.json` 里八个发布契约字段(`sideEffects`、`exports`、`main`、`module`、`types`、`files`、`peerDependencies`、`engines`)之一的值(哪怕一个源码文件都没动),就必须新增一个 `.changeset/*.md`**;判据的权威表述是 `scripts/check-changeset-presence.mjs` 的文件头,这段话与它不一致时以它为准 —— 这一条由 `.github/workflows/changeset-presence.yml` 机械强制(objectui#3387),`pnpm changeset` 写正常 bump,**纯内部改动/只动测试就写空 frontmatter(`---` 紧跟 `---`)显式声明"不发版"**,那是合法的一等通过写法。要的是"声明一次",不是强制发版。
  - 别再按"feature 要写、bug 修复不用"来判断 —— 正是这个旧判据让三条用户可见的修复(`19716b5bf` fix(charts)、`5e7ef1141` fix(i18n)、`0e50440` #3518)搭顺风车发了出去,任何 CHANGELOG/版本号/发布记录里都查不到:平台侧的发布判据(objectstack#4731/#4843)读的就是本仓声明的 changeset。
  - 本地先自查:`node scripts/check-changeset-presence.mjs`(未提交的 changeset 也算)。

### 怎么跑测试(有些写法会静默假绿 —— 现已机械拦截)

**唯一正确的跑法:在【仓库根目录】执行,路径相对仓根书写,前面不要加 `--`。**

```bash
pnpm exec vitest run packages/<pkg>/src/<file>.test.ts   # 只跑一个文件
pnpm exec vitest run packages/<pkg>/                     # 只跑一个包
pnpm test                                                # 全量(CI 就是它,可加 --shard=1/16)
```

`--shard=K/N` 在本地也经根 config 的 `sequence.sequencer`(`scripts/test-shard-sequencer.mjs`)分腿:按 `scripts/test-shard-timings.json` 里实测的每文件耗时,不按路径哈希,开跑前打印一行 `test-shard-sequencer:` 读数。分配只由文件集、那份 timings 与 N 决定(`scripts/test-shard-partition.mjs` 文件头),所以 N 取 CI 某个 matrix 的宽度时,同一 checkout 上不带路径的 `pnpm test --shard=K/N` 跑的就是那个 matrix 全量运行时第 K 腿的文件;带了路径,文件集变了,分配也跟着变。N 以 `ci.yml` 为准 —— `test` 与 `test-coverage` 两个 matrix 各自声明宽度;示例里的 `16` 是写下时 `test` matrix 的读数,本文件不复核它(诫条 #9)。

AGENTS.md 的「只跑受影响的包」指的是**用上面的路径过滤缩小范围**,不是 `cd` 进包里。
`pnpm --filter <pkg> test` 与 `turbo run test` **不再静默假绿**(objectui#3240):每个包的
`test` 脚本都改成了显式指回仓根的 `vitest run --root ../.. packages/<pkg>/`,跑的**就是仓根
那一份配置**;它们只是比上面的写法多绕一层。⛔ 但**同一份配置不等于同一个结论**:#3240 移的
是 **vitest 的 root**,`process.cwd()` **不动**,包级形式下它仍是 `packages/<pkg>/` —— 见下面
最后一条。要和 CI 得出同一个结论,就用上面那三条仓根写法。

- **陷阱一:让 vitest 的 cwd 落在包目录里(objectui#3378)。** 今天只剩
  `cd packages/x && pnpm exec vitest` 这一种写法(改造前 `pnpm --filter <pkg> test` 和
  `turbo run test` 也在其中)。vitest 把 root 定成该
  目录,根级 projects(`unit`/`dom`/`dom-heavy`)的 include(`packages/**`、`examples/**`、
  `scripts/**`)相对它匹配不到任何文件;只有以**绝对路径**引入的 `apps/console` project 仍解析
  成功。于是跑的是 `@object-ui/console` 的 22 个文件、报 `Test Files 22 passed (22)`,而本包
  (app-shell 有 281 个)一个都没跑。**没有 "0 tests matched" 信号** —— 计数是 22 不是 0,
  `passWithNoTests` 根本不参与,按包级约定验证的 agent 会据此报「整包绿」。
- **陷阱二:把路径挂在 `--` 后面(objectui#3288)。** `pnpm --filter <pkg> test -- --run <paths>`:
  pnpm 把 `--` **原样**转发进脚本,vitest 的 CLI 解析在 `--` 处停止,后面的一切(包括你的路径)
  在 vitest 看到之前就没了 —— 不是「被忽略并警告」,是压根不存在。于是退回默认集合(叠加陷阱一
  就是别人的包),新加的测试文件零执行、输出全绿。
- **上面的陷阱现在都会直接失败**,由 `scripts/vitest-invocation-guard.mjs` 拦下。⛔ **它今天拒绝
  哪些形态不写在这里** —— 以 `scripts/__tests__/vitest-invocation-guard.test.ts` 为准,那份 pin
  测试逐条钉住每个 verdict,guard 自己的文件头也是这么指的。⚠️ 理由是本文件的诫条 **#9**:写进散文的计数
  只推导一次、此后永不复核,下一条拒绝加上来就把它证伪 —— 所以⛔ 别把本节展开的陷阱读成「就这些」,
  拒绝集比它们大。报错正文会指出机制并给出上面的正确命令。包级 `test` 脚本的存废是 objectui#3240;
  在那之前它们只失败,不撒谎。
  - **拦截点不止 `vitest.config.mts` 一处**(objectui#5406 / objectui#3240)。vitest 只加载
    「启动目录里的那份」config,所以根 config 顶部那一次调用,只覆盖得到「本目录没有任何
    config(向上找到根 config)」或「本目录 config import 了根 config」这两条路。
    - #5406 关的是第三条:11 个**独立**的 `packages/plugin-*/vitest.config.ts` 两条都不占,
      它们自带 `happy-dom` + `globals` + 本地 setup 且**完全没有 alias 表**,于是从包目录跑
      就用上了一份 CI 从不使用的 config。
    - ⭐ #3240 删掉那 17 份包级 config 之前,必须先关**第四条**:vitest 的回退不止于
      `vitest.config.*` —— 没有它就用同目录的 `vite.config.*`,而 `packages/*` 每个都有一份。
      实测 `cd packages/plugin-ai && pnpm exec vitest run` 报 `RUN v4.1.10 /…/packages/plugin-ai`,
      guard 一声不吭。所以每份 `packages/<pkg>/vite.config.ts` 现在也调用 guard,调用**以
      `process.env.VITEST` 为门**(实测:vitest 读 config 时它是 `"true"`,`vite build` 读同
      一个文件时是 `undefined`)—— 测试跑被拒,构建永远不被拒;那些 `vite.config` 里残留的
      `test` 块(`passWithNoTests: true` + 一份根 config 从不加载的 setup)也一并删掉了。
    新增任何一份 `vitest.config.*` / `packages/*/vite.config.*` 若不占其中一条路,
    `scripts/__tests__/vitest-invocation-guard.test.ts` 会红。
- **路径过滤零匹配也不再是绿的**:一旦命令行点名了文件,`passWithNoTests` 自动关闭 ——
  写错的路径 / 相对错目录的路径 → 非零退出,而不是「跑了 0 个文件然后绿」。
- **`-t` 是正则,不是字面量(objectui#9660)。** 本仓的 `describe` 名普遍以 `(objectui#NNNN)`
  结尾,整段复制粘贴进 `-t`,那对括号就成了捕获组 —— 一个测试都匹配不到,而「名字过滤零匹配」
  在 vitest 里算 **skipped、不算失败**:`Tests 22 skipped (22)` + **退出码 0**。文件过滤是匹配上
  了的,所以上一条的 `passWithNoTests` 在这里什么都管不到,屏幕上也没有任何 `0 tests matched`。
  于是「跑一下那条具名 pin 看过没过」得到的是一个**假绿**。正确写法两种:把元字符转义
  (`-t 'not prose \(objectui#7733\)'`),或者只取名字里一段**不含元字符的子串**
  (`-t 'are derived, not prose'`)。⛔ 别按退出码读结论 —— 读「passed 的计数不是 0」。
  这一形态现已由 `scripts/vitest-invocation-guard.mjs` 直接拒绝;⛔ 它今天拒绝哪些形态同样不写在这里,
  以 `scripts/__tests__/vitest-invocation-guard.test.ts` 为准。
- 确需从包目录启动,把 root 显式指回仓根:`pnpm exec vitest run --root ../.. packages/<pkg>/`
  —— 这正是 objectui#3240 给每个包级 `test` 脚本定下的写法。
  真要临时绕过 guard(自担风险):`OBJECTUI_VITEST_GUARD=off`。
- **包级测试配置只有一份,就是仓根那份。** objectui#3240 删掉了 17 个包 +
  `examples/schema-catalog` 的 `vitest.config.*`(维护者 2026-08-06 裁决 A);某个包确实需要
  不同的 environment / setup / include,就在 `vitest.config.mts` 的 `projects` 里**加一个
  project**,不要在包里新开一份 config —— 一份 config 一个结论,是这条裁决的全部内容。
- ⛔ **测试在断言里读文件系统,根定在它自己的文件上,永不定在 `process.cwd()`。** 包级形式的
  cwd 是 `packages/<pkg>/`、仓根形式是仓根,同一个断言因此读到不同的树 —— 实测两次:
  objectui#7791(PR #7796)同一个文件仓根 `7 passed`、包级 `2 failed / 5 passed`,cwd 是唯一
  变量;objectui#7799(PR #7806)按 `packages/*/src` 普查,命中 19 个同类、13 个确有缺陷。
  拼法用 PR #7796 落地、#7806 沿用的那一个:从**裸** `import.meta.url` 逐段上溯到仓根,
  ⛔ 不引入第三种;`new URL(<相对路径>, import.meta.url)` 就是第三种,别写 —— 但理由只是「拼法唯一」。
  这里曾断言它被 Vite 重写成 `http://localhost:3000/@fs/…`、`fileURLToPath` 在**两种 cwd 下都**抛
  `ERR_INVALID_URL_SCHEME`;objectui#9191 按 `vitest.config.mts` 声明的每个 project 逐一实测,未能复现
  —— node 与 happy-dom 两种 environment、两种 cwd 下 `import.meta.url` 都是 `file:` URL,文件读得到。
  `@fs` 那个形状是 Vite dev-server/浏览器变换的产物,本仓测试不声明 browser mode,不走那条路。
  ⚠️ **`process.cwd()` 那一类已由 `pnpm check:test-path-roots` 拦下,这个拼法它按设计不拦**(理由写在该脚本头部)。

### 测试纪律(flaky 测试:先找竞态,别调超时)

单跑稳定绿、全量并行下偶发红的测试,**根因几乎总是同一个**:一段**无界的模块加载被计入了一个有界的窗口**。满并行下 Vite 的 transform 管线是饱和的(单 `dom-heavy` 项目就 ~60s transform),实测一次首包 `import()` 可达 **976ms** —— 已吃掉 RTL `findBy`/`waitFor` 默认 **1000ms** 预算的 97.6%。于是断言在和模块加载器抢时间,红绿取决于机器负载而不是被测代码。

- **断言的内容落在 `React.lazy` / 动态 `import()` 边界之后 → 在测试文件的模块作用域直接 `import` 该模块**(`import '@object-ui/plugin-charts';` + 一行注释说明原因)。成本进入 import 阶段,**不受任何 test/hook 超时约束**。specifier 必须与被测组件里的**完全一致** —— ESM 按解析后的 specifier 缓存,这样组件自己的 `React.lazy` 工厂才会立刻 resolve。
- **不要用 `beforeAll` 预热**:它受 `hookTimeout`(**10s**)约束,比它取代的 `testTimeout`(**15s**)**更窄**,那只是把问题挪个窝。**这一条现在由 lint 机械强制** —— `object-ui/no-dynamic-import-in-test-hook`(error)禁止在 `beforeAll`/`beforeEach` 体内 `await import(…)`。两种写法**不会**被它拦(都是正当的,已在规则的 RuleTester 里钉住):传给注册器的**惰性工厂**(`registerLazy('x', () => import('./x'))` —— hook 只是登记 loader,并不执行导入);以及同一 hook 里调了 `vi.resetModules()`/`doMock`/`stubEnv`/`stubGlobal` 的**故意重导入**(它必须读取只在 hook 时存在的状态,提到模块作用域反而会改坏测试)。
- **禁止**用「调高超时」或「把文件塞进 `vitest.config.mts` 的 `heavyDomTests`」来修 flaky —— 两者都只是把竞态藏起来。`heavyDomTests` 只用于 registry「`<type>` not registered」这类失败。
- 失败现场会直接指认根因:dump 里若仍是 Suspense fallback(如 `Loading report renderer…`),就是本条;**hook 超时表现为「失败的*文件* + 0 个失败*测试*」**(其余全部 skipped),别误读成断言失败。
- 顺手体检:别把 `keysOf(x)` 这类整体计算写在 `.filter()` 谓词里(每个元素重算一遍)。`all-locales-key-parity` 曾因此 7.51s,提升出谓词后 **25ms**。
- **i18n 取证纪律:凡按「排版/字符记法」做普查或断言的正则,一律 `u` flag + `\p{L}` 之类的 Unicode 属性类,禁止 ASCII `\w`/`[a-z]`。** JS 的 `\w` 不论加不加 `u` 都等于 `[A-Za-z0-9_]`,匹配不到西里尔/阿拉伯/CJK 字母 —— 本仓十个包里 **五个是非拉丁文字**,所以这类正则的结论对它们**恒为「零命中」**,而且失败方向是最坏的那种:普查报告「该包不用这种记法」,断言绿着但**从不检查任何东西**。两种形态都实际发生过(objectui#3866):PR #3847 用 `/\(\w{1,4}\)/` 普查括号复数记法,给 ru 判了「全包 0 处」,实测 `\p{L}` 是 12 处、其中就有和被查 key 同构的 `{{count}} поле(й)`;同一写法写进断言后,对 zh/ja/ko/ru/ar 五包永假空转。**改法**:`/\([\p{L}]{1,4}\)/u`,并把反例连同旧写法一起钉住(`expect(RE.test('поле(й)')).toBe(true)` + `expect(/\(\w{1,4}\)/.test('поле(й)')).toBe(false)`),否则下一个人看不出两种写法不等价。**顺带记住属性类自己的边界**:`\p{L}` 只有字母(数字括号如 `(Pos1)` 不在内),`\(` 只有 ASCII 括号(全角 U+FF08/U+FF09 不在内,zh/ja 用得不少)—— 按你要查的记法选类,查不到的那半要在 PR 里写明是界外,别默认为零。
- **本地一片 parity/schema 测试失败,先怀疑 stale install**(`node_modules` 里的 `@objectstack/*` 不是 `.objectstack-sha` 钉的那份构建),不是回归 —— CI 每次按 pin 恢复或构建再全新安装,永远不会命中这个。`pnpm objectstack:status` 答「缓存里是不是 pin」,不是就 `pnpm run setup`(见下方「依赖与锁文件」)。
- **别用 `prettier` 给改动做收尾检查 —— 它对未改动内容就是红的。** 本仓没有格式化门禁:没有 `.prettierrc` / `prettier.config.*` / `.prettierignore` / `.editorconfig`,没有 workflow 跑它,`eslint.config.js` 里也没有任何格式规则(全是正确性/ratchet 规则);那条从未接线的 devDependency 已随 objectui#3657 / PR #3681 删掉,仓内(排除 `pnpm-lock.yaml`)已 grep 不到 prettier。**但命令仍然跑得通** —— 容器镜像在 `/opt/node22/lib/node_modules/` 预装了一份全局 prettier(实测 3.8.1),仓内解析不到时 `pnpm exec` 会沿 PATH 兜底,任何装有全局 prettier 的机器同理。没有配置就按 prettier **默认值**(双引号、`printWidth: 80`)判定,而本仓是单引号、行宽更宽,于是**逐字节等于 `origin/main` 的文件照样报 `exit=1`**:根因是「默认配置 ≠ 本仓约定」,**不是**「`main` 没格式化」,也不是你改坏了。**禁止**据此 `--write` —— 未改动的 `scripts/check-doc-links.mjs` 单个文件就是 389 行重排(它的测试文件 1646 行),内容是 `'x'` → `"x"` 与 80 列回绕这类与你无关的 diff,会一起混进你的 PR。正确动作:忽略这份输出;本仓真接了线的检查是 `pnpm lint` / `pnpm test` 与根 `package.json` 里的 `check:*` 那几条。前情 objectui#3657、#3682。

前情:objectui#3010(一次修掉五个文件,含一个已被「超时调到 15s」糊过、满负载下依然 15021ms 超时的例子)。

### 版本号策略(version alignment)
- **objectui 的 major 与 `@objectstack`(spec/client/formula)的 major 保持一致**:依赖到 `@objectstack ^11.x` 时,objectui 这个固定版本组(`.changeset/config.json` 的 `fixed`,39 个包一起发)的 major 必须是 `11`。心智模型:**major 相同即兼容**。
- minor/patch **独立演进**——objectstack 没动时不必跟发;objectui 自己的改动照常用 changeset 推进(从当前 major 起步,如 `11.0.0 → 11.1.0`)。
- objectstack 跨 major(→12)时,下一次 objectui 发版一并把 major 提到 `12`。
- 推论:**changeset 里不要声明 `major`** —— fixed 组任一 `major` 都会把全组推上去、脱离 objectstack 的节奏(如 17.x 期间被推到 18)。objectui 自身的破坏性变更也标 `minor`(在正文里写清 breaking 语义即可);唯一例外是跟随 objectstack 跨 major 的那一次同步升级。
- **这一条现在由 CI 机械强制** —— `scripts/check-changeset-no-major.mjs` 在任一 changeset 声明 `major` 时退出非零,由 `.github/workflows/changeset-guard.yml` 跑(它是唯一以 `.changeset/**` 为**触发**路径的 workflow。这里曾写「`ci.yml`/`lint.yml` 都把 `**/*.md` 和 `.changeset/**` 列进 `paths-ignore`,只加 changeset 的 PR 不会启动任何 workflow」——**已不成立,别照它做判断**:objectui#3523 step 2 把 `paths-ignore` 从这两个 workflow 的 `pull_request` 上删掉了,今天它**只**留在 `push` 触发上;PR 的路径判断改在 job 内做 —— `ci.yml` 的 `Decide whether this change needs a full run` 步骤,`lint.yml` 有同名的一份。所以 md-only / changeset-only 的 PR **照常启动**这两个 workflow 并产出 required context —— 实测 PR #3856(只改一个 `.md`)起了 16 个 check、PR #4339(只给 AGENTS.md 加一行)起了 17 个。真正被跳过的是重活:那个 job 内开关的排除表逐条**等于** `push` 的 `paths-ignore`(仍含 `**/*.md` 与 `.changeset/**`),changeset-only 的 PR 里这两个 workflow 每一步都 skip。这才是 changeset-guard.yml 今天仍必须独立、且以 `.changeset/**` **反向**触发的理由:它跑在那个 job 内开关之外,免安装免构建,是唯一判得到 changeset-only PR 的东西。见 objectui#3523 step 2 / objectui#3857),`pnpm test` 里另有一条仓库状态断言兜底。跟随 objectstack 跨 major 的那一次同步升级由脚本按 manifest 自行判定放行,不靠开关:只有 fixed 组成员上的 `major`、且该组当前 major + 1 正好等于组内 manifest 在 `dependencies`/`peerDependencies`/`optionalDependencies` 里声明的 `@objectstack/spec` 范围的 major 时才放行,其余照旧拦(维护者裁决,objectui#12030 评论 6149296149;判据的权威表述是该脚本的文件头);Changesets pre 模式下已被 `changeset version` 消费、挪进 `.changeset/pre/` 的 changeset 不再读。前情:objectui#3161/#3159/#3160/#3225 四个 changeset 在 17.x 期间标了 `major`(17 个包条目),足以把 39 个包发成 `18.0.0`。
- 这是约定优先于 semver 纯粹性的取舍(为可维护/好记),因此 objectui 的 major 不代表「它自身 API 的破坏性变更次数」。`@object-ui/site` 与 `@object-ui/example-*` 在 `ignore` 列表,不随组联动。

### 依赖与锁文件:`@objectstack/*` 按提交钉(objectui#12955 裁决 B,objectui#12957)

- **pin**:仓根 `.objectstack-sha` 钉一个 objectstack `main` 提交。根 `package.json` 的 `pnpm.overrides` 把**每一个** `@objectstack/*` 指向 `file:node_modules/.cache/objectstack/<名>` —— 那是该提交源码构建后、按 `pnpm pack` 的发布形状解包的目录。没有任何 `@objectstack/*` 从 npm 解析;各清单里的 `@objectstack/*` 范围只在 objectui 自己发版时起作用(objectui#12958),⛔ 别为「对齐 pin」去改它们。机制、为什么是 `file:` 目录而不是 tarball 或 `link:`、以及它拒绝什么,全在 `scripts/objectstack-pin.mjs` 文件头,本节不复述。
- **本地 setup**:干净 checkout(含每个新 worktree)跑 **`pnpm run setup`** = `pnpm objectstack:build`(构建 pin 的 `@objectstack/*` 进上面那个目录;已是 pin 就跳过)再 `pnpm install --frozen-lockfile`。⛔ 不是 `pnpm setup`:那是 pnpm 的内建命令,会去改你 shell 的 rc 文件,根本不跑这个脚本。冷构建是重活,按下面「重验证先经那把锁」的规矩跑。⚠️ 删 `node_modules` 也就删了这份构建,之后的 `pnpm install` 以 `ENOENT`/`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND` 指着 `node_modules/.cache/objectstack/<名>` 失败 —— 重跑 `pnpm run setup`。
- **换 pin**:`scripts/bump-objectstack.sh [<sha|ref>]`(读 `../objectstack`,`OBJECTSTACK_ROOT` 可改;`--help` 是它的说明)→ `pnpm objectstack:build` → `pnpm install`,`pnpm-lock.yaml` 变了就一起提交。它对解析不了、读不出的提交**拒绝且什么都不写**,对不在 `origin/main` 上的提交**只警告**。
- **用一棵现成的 objectstack 树代替 pin**:`OBJECTSTACK_ROOT=<树> pnpm objectstack:build && pnpm install --frozen-lockfile` —— 那棵树须已 install 且已 build;锁文件不变,冻结安装照样成立(objectstack#24306 的 `build-console.sh` 用的就是这个输入)。用完跑一次 `pnpm objectstack:build` 回到 pin。
- **锁文件规则**:`pnpm-lock.yaml` 里 `@objectstack/*` 只有 `file:` 目录解析、没有版本号。⚠️ 冻结安装**不核对**目录清单的依赖 —— 构建声明了锁文件没记录的依赖,`pnpm install --frozen-lockfile` 照样退出 0、就是不装它;所以 `pnpm objectstack:build` 在两者的依赖名不一致时拒绝,让你跑一次 `pnpm install` 改写锁文件。⛔ 别删 override 让某个 `@objectstack/*` 回到 npm:构建脚本拒绝 override 集合与依赖闭包不相等的任何情形。

### 多 agent 协作纪律(并行修改本仓库,务必遵守)

本仓库有**多个 agent 并行**修改 —— 分支会被切换、共享文件会在你工作时被改动(正常现象,不是 bug):

- **只改你任务需要的文件**;别去"修"无关的 diff、回退或别人的在途编辑,也别管整棵工作树。
- **必须一个任务一个 git worktree**(`git fetch origin main && git worktree add --no-track ../objectui-<task> -b <branch> origin/main`,新树里跑 `pnpm run setup` —— 见上方「依赖与锁文件」,裸 `pnpm install` 在没有 pin 构建的新树里会失败)做物理隔离 —— 这是强制而非「首选」。共享的 `main` checkout **不是**可用退路:HEAD 会被别的 agent 切换、你刚写的文件会在操作中途被 reset 掉。一个 **PreToolUse 钩子**(`.claude/hooks/guard-main-checkout.sh`)**强制**此规则:除非被编辑文件位于专属 **worktree** 否则拦截 `Edit`/`Write`/`NotebookEdit`——在共享 checkout 上开 feature 分支**也不行**(仍会被切走),且按**被编辑文件所属的仓库**判断(sibling 仓 `framework`/`cloud` 一并守住)(确属非任务的临时改动用 `OS_ALLOW_MAIN_EDITS=1` 放行)。即便在自己的 worktree 里,下面这些防御性条款仍然适用。
- **绝不 `git stash` —— stash 栈不在上一条的 worktree 隔离范围内。** `git stash` 把栈存在**共享 `.git` 目录**里的 `refs/stash`,**每个 worktree 共用同一个 LIFO 栈**:上一条的物理隔离**不覆盖它**。两个 agent 各自在自己的 worktree 里 stash,push/pop 的是同一个栈 —— 你的 `pop` 取回的是对方刚压进去的改动,你自己的改动留在栈上等着被对方取走;而 `pop` **报成功**,唯一的症状是别人的文件出现在你的 `git status` 里,随后一次 `git add -A` 就把对方的在途工作合进了你的 PR。不是假想:objectui#3430 两个并行 agent 在反向验证中间踩实,双方在途改动都丢了(只能作为 unreachable commit 捞回)。替代做法只有下面这些 —— 都不碰共享状态,都在你自己的 worktree 内,且**首选先 commit 再还原**(上面反向验证那条已把它定为标准写法):

  ```bash
  git commit -am wip                                     # 还原:git reset --soft HEAD~1
  git diff > /tmp/wip.patch && git checkout -- <paths>   # 还原:git apply /tmp/wip.patch
  git worktree add ../objectui-<task>-cmp <ref>          # 另开一棵树做对照
  ```

  三者的共同点是**先把未提交状态捕获下来**再动工作区;任何「先覆盖、事后再从某个 ref 取回」的写法都**不是**替代做法 —— 它假设你的改动已经提交,而反向验证时通常没有(objectstack#7800:那条推荐语害一个 agent 丢了在途改动)。一个 **PreToolUse 钩子**(`.claude/hooks/guard-shared-stash.sh`)**强制**此规则:拦截 push/pop/drop/clear 共享栈的 `Bash` 命令,放行拿不到别人条目的形式 —— `git stash list`/`show`/`create`,以及 `git stash apply <sha>` / `store <sha>` 且 sha 为**字面十六进制 object id**(绝不用 `stash@{N}` —— 那是你并不拥有的那个栈里的一个**位置**)。确知栈只属于你时用 `OS_ALLOW_STASH=1` 放行;改了钩子就重跑 `.claude/hooks/guard-shared-stash.selftest.sh`。
- **上一条不是孤例 —— worktree 只隔离你的 checkout 和四个 ref 命名空间,其余一切共享。** Git 的 per-worktree ref 命名空间**恰好四个**:`HEAD`、`refs/bisect`、`refs/worktree`、`refs/rewritten`。**除此之外全部共享** —— 不是 object store,不是 repo config,也不是任何别的 ref。上一条的 `refs/stash` 是本规则的一个**特例**,不是一条孤立的怪癖;只读到那一条就以为「worktree 隔离 ref、只有 stash 例外」的,恰好把结论记反了。判据只有一条命令:`git rev-parse --git-dir` 与 `--git-common-dir` **不同**说明你在 linked worktree 里,而**凡是落在 common dir 底下的东西都是共用的**(实测本仓:linked worktree 的 `--git-dir` 是 `.git/worktrees/<name>`,`--git-common-dir` 是 `.git`;`HEAD` 两棵树各有一份、读数不同,`refs/remotes/` 在 per-worktree 目录里**根本不存在**,只有 common dir 那一份)。除 stash 外,另外两个已经吃过亏的实例:

  1. **`refs/remotes/*`** —— 别的 agent 在**它自己的** worktree 里 `git fetch`,推进的是**你的** `origin/main`。于是 `git checkout origin/main -- <paths>` 在 worktree 里**不是**「还原到我的分支基点」,而是「还原到 `origin/main` **此刻**指向的地方」—— 那可能比你切分支的那个 commit 更新,别人刚合并的改动就以「revert」的名义进了你的工作区,随后一次 `git add -A` 把它们扫进你的 PR。实测本仓:四个 agent 并行时 `origin/main` **十分钟内动了三次**。⚠️ 而且 path-scoped checkout 会**顺带 stage** 它还原的内容 —— 污染到达时已经在 index 里了。
  2. ⭐ **`FETCH_HEAD`** —— **它的症状是「没有内容」而不是「内容不对」,这是前两个实例推不出来的那一半。** `FETCH_HEAD` 是「**本 checkout 里最后一次 fetch** 的结果」,谁 fetch 的都算。`git fetch X && git diff …FETCH_HEAD` 写成**一条**命令是安全的;拆成**两条**就不是 —— 中间任何一次 fetch 都把它换成了另一条分支,而 `git diff` **退出 0、什么都不打印**。那个输出最自然的读法是「这个改动根本不在」:一个关于**别人**工作的、基于看起来很干净的证据的、自信的错误结论。⚠️ 对**做评审的座位**尤其致命 —— PM 拿 PR 比对 `main` 做的正是这个操作,而它朝「活儿没做」的方向失败。

  ⚠️ **`FETCH_HEAD` 的隔离边界和前两个不一样,别照着 `refs/stash` 外推**(实测 git 2.43):`git rev-parse --git-path FETCH_HEAD` 在 linked worktree 里解析到 `.git/worktrees/<name>/FETCH_HEAD`,**B 在自己 worktree 里 fetch 并不会动 A 的 `FETCH_HEAD`** —— 这一点已经量过。它咬人的地方是**共享的主 checkout**:那里同一条命令解析到 common dir 的 `.git/FETCH_HEAD`,而每个 agent 在建自己 worktree**之前**的第一条 `git fetch` 都落在那儿,评审座位更是整天待在那儿。所以这一条按 **checkout** 说、不按 worktree 说:**同一个 checkout 里,最后一次 fetch 说了算**。

  三条做法(都是**做法**,不是禁令):

  - **钉住基点。** 建 worktree 时记下 `BASE=$(git rev-parse HEAD)`,还原一律 `git checkout "$BASE" -- <paths>`,绝不用一个会动的 remote-tracking 名字。真要以 `origin/main` 为源,就**按 commit 说**,别按 ref 名说。
  - **确实点了 remote-tracking ref,就核验到手的内容。** 规则不是「绝不点名」,而是「它会在你脚下动,所以要查清楚拿到的是什么」—— 用磁盘上的出现次数**正反两个方向**查。objectui#5235 是这个缓解措施成功的实例:`resetInFlightRef` 计数 `7 → 0`,同时确认修复前的注释文本回到 2 处;`origin/main` 若已漂到另一个版本,这两个数都对不上。
  - **fetch 进一个你自己命名的 ref。** `git fetch origin <branch>:refs/<namespace>/<id> -f`,然后读**那个** ref —— 没有任何 sibling 动得了它。这是 `FETCH_HEAD` 的解法。
  - 任何 path-scoped 还原做完之后,把还原的那几个路径和记录的基点 diff 一次,**确认为空再 stage**。

  ⛔ **这一条不会有钩子兜底**(上面 worktree 与 stash 两条各有一个 PreToolUse 钩子):安全形式就是 `git checkout` / `git fetch` 这些日常命令,而不安全的那个形式在别处完全正当 —— 机械拦截只会拦在正确用法上。所以这条规则的全部效力,就在于你还记不记得基点是**钉住的那个 commit**。
- **临时文件所在的 scratchpad 目录跨会话共享 —— 提交信息与 PR 正文一律别落到那里。** 容器发给每个会话的「scratchpad」临时目录事实上被多个并行会话映射到**同一个路径**,和上一条的 stash 栈同族:一块位于 worktree 之外的共享可写状态,worktree 隔离**管不到它**。两个 agent 各写一份同名的 `commitmsg.txt` / `pr-body.md`,后写的整份顶掉先写的;而 `git commit -F` 读到别人的文件**不报错**,每一步都报成功 —— 受害的是**另一个** agent 的产出(你的提交信息落到别人的 commit 上,你这边什么都看不出来),没有任何错误可供发现。实测在 20 分钟内撞了两次,可见的损伤是 `main` 上一条 squash commit:提交信息描述的是一张卡、diff 实施的是另一张卡,两者毫无关系;`main` 不重写,于是这条误导永久留在 git 考古里 —— 下一个人按 `git log --grep` 找那张卡,会得出「已经做过了」的错误结论。两条做法,**有先后之分**:

  1. **首选机制:让内容根本不落共享盘。** 提交信息用 `git commit -F -` 配 heredoc(或多个 `-m`),PR 正文直接作为工具参数传(用 `gh` 就把正文写成进程内的 heredoc,别先写文件再 `--body-file`)。内容不落盘,就无从被顶掉。

  ```bash
  git commit -F - <<'EOF'
  fix(scope): 一句话主题

  正文……
  EOF
  ```

  2. **次选纪律:确实需要临时文件时,文件名一律带卡号/分支号前缀**(该目录里既有的 `3309-pr.md` 就是这个惯例),**且用完即删**;写完要用之前先读回一遍,确认拿到的还是自己那份。

  两条不是并列的两个建议:前缀与删除要求每个作者每一次都记得,记性会衰减,而衰减是静默的(见上:撞车不报错);`git commit -F -` 那种形式让撞车**不可能发生**,不依赖任何人的记性。所以能用形式解决的,就别退回到纪律。这一族目前**没有钩子**兜底(上面 worktree 与 stash 两条各有一个 PreToolUse 钩子),因此这条规则的全部效力就在于你选哪种形式。
- **重验证先经那把锁 —— 它住在兄弟检出 `../objectstack` 里,本仓没有这个脚本。** 任何**重验证**(全量 `vitest run`、计时测量、整仓 build 或整套 suite)开跑之前先经 `/home/user/objectstack/scripts/pm/os-verify-lock.sh` 串行化,写法 `bash /home/user/objectstack/scripts/pm/os-verify-lock.sh -c '<命令>'`。⛔ **绝不在本仓复制一份**:被序列化的资源是**容器**,本仓和 `../objectstack` 共用同一个 —— 两份 per-repo 的锁只会让一个 objectui agent 和一个 objectstack agent **同时**跑重套件、而各自都以为自己持有锁,比不加锁更糟。⚠️ 而这把锁**只排除其他已加锁的运行**:`--status` 打印的持有者和队列里只有**走了这个入口**的那些运行,**空队列不等于空箱** —— 一个没加锁就跑 `turbo build` 的 agent 对它完全不可见,却照样落进你的计时测量里。
- **一个任务一个 feature 分支 + 一个 PR**;**绝不**把任务改动直接提交到 `main`。
- **绝不 `git push --force`/`--force-with-lease`,绝不推 `main`**(会覆盖并行 agent 的工作;`main` 共享,一律走 PR)。**禁令不按「这条分支是不是只有我一个人用」分档**:那个判断评估错的时候没有任何症状,而错掉的代价正是本节要防的那类静默丢工作 —— 所以它一律绝对,单人 feature 分支同样不例外。**要把自己的分支同步到当前 `main`,合规路线是 merge,不是 rebase**:`git fetch origin && git merge origin/main`,解完冲突照常 push。代价只是一个 merge commit —— 本仓 PR 一律 `--squash` 入队合并,它不会留到 `main` 上;换来的是任何一次 push 都不重写已经推上去的历史。**「要同步分支」从来不是 force-push 的理由**,别用 `git rebase origin/main` + `--force-with-lease` 去「把历史弄干净」。(入队合并本身并不要求你同步 —— 队列会在当前 `main` 上重建,见下面「不必为了合并去 rebase 其他在途分支」那条;主动同步的价值在于提前撞出别人刚落地的破坏。)**force-push 归分支所在的那个仓(landing repo)的 `AGENTS.md` 管**(objectui#9666,维护者裁决 C,评论 5724939229):objectui(即本条)与 cloud 一律绝对禁止,`../objectstack` 在它以 `Never force-push a *shared* branch` 开头那条的五项条件全部成立时允许 `--force-with-lease` —— 这三仓读数取自裁决当日,本仓没有任何东西复核它(诫条 #9),所以**跨仓工作的席位在给 dev 下指令之前,先读落地仓自己那条的原文**。
- **能 push 分支,却删不掉远端 ref —— 而且失败之后 git 打印的是一张成功回执。** 实测(objectui#6756,同一会话里两个 agent 独立撞到、签名相同):任何删除 ref 的 push 都被 agent proxy 以 `error: RPC failed; HTTP 403` 拒绝,且没有旁路 —— GitHub MCP 工具面只有 `create_branch`、**没有对应的 delete**,容器内也没有 `gh` CLI。⚠️ 要命的是紧接其后的最后一行:`Everything up-to-date` —— 只看输出尾部、或把「最后一行非空」当成功的调用方,会把**被拒绝的删除读成已完成的删除**。⇒ 代价不是「不整洁」,而是**认领信号被污染**:同一张卡改名重开留下的孤儿分支,在席位平时读的任何界面上都看不见(不在卡上、不在 PR 列表、不在任何队列视图),只有按卡号做前缀 glob 才现形 —— `git ls-remote --heads origin 'refs/heads/claude/issue-<n>-*'`;实测一次险些被读成「另一个席位在并行做同一张卡」,而那正是认领纪律要防的唯一一件事。**以下四点未测,别当结论用**:403 出自代理策略 / token scope / 分支保护中的哪一层、其他席位或环境是否删得掉、tag 是否同样受限、仓内还有多少陈旧 `claude/*` 分支。⛔ 本条只记录能力缺口,**不**授权任何分支清理、普查或生命周期策略 —— 那是维护者的决定。
- **每次 commit/push 前先确认当前分支**(`git rev-parse --abbrev-ref HEAD`);HEAD 可能被别的 agent 切走 —— 不是你的分支就停下重新 checkout。
- **提交信息以 model-free 的 trailer pair 收尾 —— 与 `../objectstack` 的 `AGENTS.md` 是同一条规则(objectui#9441,维护者裁决 A,评论 5724938982)。** 下面是那边以 `**Commit message:**` 开头的那两句,逐字照录、不译;唯一的删改是去掉了 `, and the pre-push hook refuses a model identifier in that pair` 这一分句 —— 本仓没有那个钩子,裁决也不加:

  > **Commit message:** an agent commit ends with the model-free trailer pair `Claude-Session: https://claude.ai/code/session_<id>` and `Co-authored-by: Claude <noreply@anthropic.com>`; no model identifier lands in a PR title or body, a comment, a changeset, a doc or a code comment. Two exemptions: a harness-written `Co-Authored-By` trailer (REPORTING: not declared a deviation; landed history is not rewritten) and a verbatim maintainer ruling preserved as a quotation block.

  ⚠️ **本仓没有任何东西强制它**(依诫条 #9 明说):没有 pre-push 钩子,也没有读提交信息的门禁。它靠 harness 自己的优先级句生效(裁决原话:「The harness's own precedence rule does the enforcing.」)—— harness 的署名提醒让位于 `CLAUDE.md` / `AGENTS.md` 里关于这几行的规则,两者冲突时照本条写。squash 入队保留 `Co-authored-by`(objectui#9666),所以分支 commit 上写的那一行会原样落进 `main` 的历史。
- 改**共享文件**(barrel/注册表):编辑→`git add`→commit 一气呵成,并核验提交确实含你的改动(`git show HEAD:<file> | grep <你的改动>`);真冲突只重加*你自己*那几行,其余交给 PR 合并。
- **要做反向验证(删掉修复 → 看预期的钉子变红 → 还原)就先把修复 commit 掉。** 提交之后,还原是 `git checkout <你的分支> -- <path>`,对着一个真实存在的 commit 取回;直接对**未提交**的改动做同一个删除(`git checkout origin/main -- <path>`)则没有任何还原点 —— 工作区就是唯一副本,而 `git stash` 一律禁用(共享 stash 栈,见本节上面「绝不 `git stash`」那条),改动当场就没了。同一天两次踩实:#4278(PR #4293)、#4243(PR #4299),两次都靠会话 transcript 逐行重打才找回来 —— transcript 不全就是净损失。#4243 那次是先 commit、再重跑一遍反向验证,最终那组红绿数字才可信。
- **本仓由 ruleset 强制走合并队列(merge queue):直接合并会被 405 拒绝。** 实测(objectui#3243,对 15/15 全绿、`mergeable_state: clean`、非 draft 的 PR #3241):

  ```
  PUT /repos/objectstack-ai/objectui/pulls/3241/merge
  → 405 Repository rule violations found
     Changes must be made through the merge queue
  ```

  实测是从 REST 端点发起的;405 正文那句 `Changes must be made through the merge queue` 拒绝的是**「直接合并」这个动作**本身,不是某个客户端,所以旧文教的 `gh pr merge --squash --delete-branch`(不带 `--auto`)这条收尾路径同样不成立(`gh` 具体报什么文案随版本变,**别按文案去猜**,认准下面的入队路径)。**撞上这个 405 不是你权限不够** —— 别去试更强的手段,也别以为要等人工审批。
- **CI 全绿即自行合并,不必等维护者确认**(授权语义没变,变的只是动作;⛔ **两条例外,命中任一就只走到 draft 为止 —— 下面那两行入队命令都不归你跑**:① **diff 命中受管面的 PR** —— 见下方「受管面」,那类 PR 停在 draft 等一条获授权的批准,再由认领席落地;② **一次派发跑出来的 PR** —— 卡上挂着 `Claim:` 评论、由被派发的 `os-dev` 一类 agent 实施的那种,**不论受管面判定如何**都停在 draft:被派发 dev 的终态交付物就是「一个 draft PR + 一份报告」,等 CI 收敛、翻 ready、入队、以及事后重挂 auto-merge 全都是**派发席**的动作 —— 因为 PM loop 的复核步骤要求落地的是**第二个 actor**;兄弟仓的派发契约 `../objectstack/.claude/agents/os-dev.md` 也正是这么写的,逐字照录:「交付物两件:该 issue 实现完毕并推成 draft PR,加下方的 JSON 报告。」「报告在本地验证走完时交付,CI 收敛等待归 PM 不归你」。⚠️ ② **不是** ① 的推论,也不被受管面判定解除:`node scripts/check-governed-queue-guard.mjs --test` 答 NOT GOVERNED 只解除 ① 要的那条**批准** —— ① 问的是**改了哪些文件**,② 问的是**谁在动手**。没有派发、卡上没有 `Claim:` 的自发改动不在 ② 内,仍按本条自行入队)—— 修改完成后**只提交你任务改动的文件**(逐路径 `git add <file>`,绝不 `git add -A` 扫入无关 diff),开 **draft** PR;等远端 CI 全绿后:

  ```bash
  gh pr ready <n>                                    # 退出 draft
  gh pr merge <n> --squash --auto --delete-branch    # 挂 auto-merge = 入合并队列
  # MCP 等价物:pull request update(draft: false) + enable_pr_auto_merge
  ```

  队列会把 PR **在当前 `main` 上重建**后再落地,重建不绿就把它踢出队列,而不是把红的落到共享 `main` 上。所以旧版那条「绝不 `gh pr merge --auto`」的前提已经反转:它防的正是队列现在替你防住的事,而在强制队列的仓库里 **enable auto-merge 就是入队的标准手段**,也是本仓实际走得通的唯一通路(仓内佐证:`.github/workflows/dependabot-auto-merge.yml` 对 Dependabot PR 用的就是 `gh pr merge --auto --squash`)。注意 path-filter 跳过的检查(显示 `skipping`)不是失败,配合 `mergeStateStatus: CLEAN` 即算全绿。
- **auto-merge 会在「合并冲突」和「draft」窗口里被静默丢弃 —— 事后必须复查并重挂。** 已两次踩实(先例 PR #3458):PR 一旦变成 conflicting、或被(重新)标记为 draft,已挂上的 auto-merge 就没了,**且不会有任何通知**。解完冲突或 `gh pr ready` 之后若不重新挂一次,PR 会一直停在那里 —— 看着"全绿待合",实际谁也没在等它。收工前复查一次:`gh pr view <n> --json isDraft,mergeStateStatus,autoMergeRequest`,`autoMergeRequest` 为 `null` 就是掉了,重挂。
- **不必为了合并去 rebase 其他在途分支** —— 队列自己会在当前 `main` 上重建,旧版「串行合并、合下一个前先 rebase 在途分支」那套编排已是历史。**但队列只拦得住文本冲突和 CI 看得见的破坏**:两个各自全绿的 PR 仍可能**语义冲突**(改了同一约定的两端;一边删掉了另一边刚开始用的导出)。所以动**共享面**(barrel/注册表/公共类型/跨包约定)时,合并前扫一眼在途 PR(`gh pr list`),有交叠就在 PR 正文里写清交叠点与取并集的办法(先例:PR #3458 对 #3456 同文件交叠的说明)。
- ruleset 的**具体配置**(谁可绕过、required checks 清单)本文不写,两半的理由不同(objectui#9520 实测):**谁可绕过**从仓内读不到(ruleset 端点对席位 token 只答「我能不能绕过」,不给名单;这一半没有仪器复核),别照抄任何推断;**required checks 清单**读得到,要看就跑 `node scripts/check-required-check-set.mjs`(`.github/workflows/required-check-set-patrol.yml` 定时跑它;`pnpm check:required-check-set` 只是它的离线 self-test,不读线上),⛔ 别把它的答案抄进本文。上面几条写的都是实测到的可观测行为。

### ⚠️ Actions workflow 注册表:`list_workflows` 回答不了「本仓到底跑不跑 X」

这条已经造成过实际损害(objectui#6069):一个 agent 被要求**删掉**一条虚假的安全工具声明,却被一张
建立在注册表读数上的卡**指去写上另一条同样虚假的安全工具声明**。那条虚假声明写在 #5408 的 dispatch
评论里(不在它的 diff 里),而 #5408 已随 PR #5963 合并。它没有酿成更大的事,只因为实施的 dev 拿
`main` 核对了替换文本,而不是信任那张卡。

**注册表按「该 workflow 在任意 ref 上的第一次运行」建条目 —— 与默认分支无关,条目此后一直留着。**
不是 push 建的,也不是合进 `main` 建的。实测:四个样本、跨越七个月,注册表条目的 `created_at` 与该
workflow **最早一次 run** 的 `created_at` **精确到秒相同**;push 被一个决定性的负例排除 ——
`pre-install-import-graph.yml` 推上分支后在**未注册状态下停了 7 分 45 秒**,直到 PR 打开、第一次 run
被调度的那一刻,条目才出现。

于是:**一个 workflow 文件只要在任何 PR 分支上跑过一次,就永久登记在册** —— 哪怕它从未进过 `main`,
哪怕那条分支早已废弃。2026-08-24 复测(`c677fe3b8`):在册的文件型条目 32 个(另有 4 个 `dynamic/*`),
`main` 上的 workflow 文件 26 个,**「在册但不在 `main`」6 个,「在 `main` 但不在册」0 个** —— 分歧是
单向的。

**`state: "active"` 的意思是「没有被 disable」。它不是关于 `main` 的任何断言。** 这就是那个 false
friend 的全部:读到 `active` 就以为「这个扫描在本仓生效」,是把「曾经跑过一次」当成了「现在在跑」。

⛔ **别据此写一个「注册表 vs `main`」的交叉校验门禁 ——「应该在册」没有可靠定义。** 「在册但不在
`main`」正是**在 PR 分支上跑过一个新 workflow 的正常结果**:每一个新增 workflow 的 PR 在合并前都会造
出这样一条。活例子:`pre-install-import-graph.yml` 于 `21:41Z` 注册,本轮测量开始时它是「在册但不在
`main`」的第 7 条;测量进行到一半,它随 PR #6159 于 `22:58Z` 合并进 `main`,这一条自己就消失了 —— 在
那 77 分钟里开着的门禁,会红在一个完全健康的 PR 上。反方向「在 `main` 但不在册」则结构性地近乎恒空:
在 `main` 上的 workflow 会跑,而一跑就注册,只有「合并到首次运行」之间的时间窗能填充它,那是竞态不是
缺陷。要把「废弃」和「在途」分开,只能靠一个分支存活性的猜测 —— 正是这张卡自己警告过的那种猜测。

⚠️ **删除方向本仓没有数据,别外推。** 「workflow 文件从默认分支被删掉之后,注册表条目会怎样」在本仓
**从未发生过、也未经测试**:`git log origin/main --diff-filter=D --name-only -- '.github/workflows/*'`
返回**空**,而 `main` 历史上出现过的路径集合与今天在册的完全一致(复测:26 = 26)。所以上面那句「条
目此后一直留着」只对**从未进过 `main`** 的文件成立 —— 它们根本没有「从默认分支删除」这个事件可供触
发。⛔ 别把它读成关于删除行为的结论。

⚠️ **API 与人类看到的 Actions 标签页是否一致,本仓无法确定 —— 这是个未解问题,不是已答问题。**
`https://github.com/objectstack-ai/objectui/actions` 与 `api.github.com` 对这些会话都返回 **403**,
MCP 工具是唯一能到达的注册表视图,所以两者的差异既没被证实也没被排除。

#### ⭐ 通用规则:相信任何「不存在」之前,先把 `total_count` 和返回数组的长度比一下

**这不是 workflow 专属的 —— 它对每一个分页列表都成立。** `list_workflows` **忽略 `per_page`**,固定
返回 30 条,同时在**同一个 JSON body 里**如实报告真实的 `total_count`。实测:`total_count: 36`,第 1
页 30 条,第 2 页 6 条,`30 + 6 = 36` —— **并集**才是完整的。

只读数组、不读计数,一次截断的列表就变成一份「确信的缺席」。#6069 那张卡本身就是这么错的:它的整个
论点正是「枚举会给出自信的错误答案」,而它自己只读了 36 条里的 30 条,把两个**已注册**的 workflow
写成了「注册表看不见它们」。**从一页被截断的结果里读出来的「没有」,根本不是一次读数。**

#### 「本仓到底跑不跑 X?」—— 一条命令,不查注册表,不上 CI

```bash
git cat-file -e origin/main:.github/workflows/X.yml     # 退出 0 = 真的在 main 上,真的会跑
git cat-file -e origin/main:.github/workflows/ci.yml    # 阳性对照:必须解析成功
```

**阳性对照不是可选项。** 没有它,一个打错的路径和一次真实的缺席给出完全相同的退出码,而你会把前者读成
后者。

**改 `.github/workflows/X.yml` 之前,先把读它的测试推导出来、别凭名字回忆:** `git grep -l 'X.yml' -- '**/__tests__/**' '**/*.test.*'`,命中逐个本地跑。
一次 workflow 编辑把一个没列出来的钉子弄红,是对这条习惯的发现,⛔ 不是对那一轮的发现;这条搜索两个方向都会错,它看不见的那半记在 objectui#9198 上,不在本条覆盖内。

#### ⛔ 对照本身还有一个洞:**枚举**和**读取**必须来自不同来源才验得动

`origin/main` 阅读规则覆盖的是文件**内容**,**不覆盖文件枚举**。把工作树 glob 喂给逐文件的 `origin/main`
读取,会给出一个**长得像全量扫描的零**:被漏掉的文件根本没进入 `git show` 的输入,于是既不会命中,也不
会出现在它自己的输出里。每一个被打开的文件都读得完全正确 —— 这正是它如此可信的原因。

```bash
for f in .github/workflows/*.yml; do            # ⛔ 文件清单来自工作树
  git show "origin/main:$f" | grep -q PATTERN   #    文件内容来自 origin/main
done
```

本仓 2026-08-29 实测(objectstack#13305):`ls .github/workflows/*.yml | wc -l` = **30**,
`git ls-tree --name-only origin/main .github/workflows/ | grep -c '\.yml$'` = **31**。差的那一个正是
`.github/workflows/governed-surface-guard.yml`,而它声明了 `ready_for_review` —— 也就是说,「翻 ready
会触发什么」这个问题的答案,恰好就是被漏在枚举之外的那个文件。据此读数把 10 个 PR 翻成 ready,每个都从
`clean` 掉到 `unstable`,而且是在 runner 容量停摆期间。

⚠️ **当时跑了零命中对照,而且它通过了。** `pull_request` 命中 5 个 workflow 文件,方法确实有效 —— 但那
5 个文件出自**同一份错误清单**,所以对照验证的是**匹配器**,而不是**枚举**。

> 一个对照必须有能力因为你担心的那个原因而失败;同源对照结构上做不到。

⇒ 可迁移的一般化:**当一次扫描的「总体」和「逐项读取」来自不同来源时,对照必须取自总体那一侧,而不是读
取那一侧。**

规范写法 —— 枚举走你要读的那个 ref,正如 `git show origin/main:` 已经是读内容的规范写法:

```bash
git ls-tree --name-only origin/main <dir>            # 枚举:与读取同源
git ls-tree -r --name-only origin/main <dir>         # 递归

git ls-tree --name-only origin/main <dir> | wc -l    # 信任任何零之前,先比一下总体
ls <dir>/* | wc -l                                   # 两个数不等 ⇒ 工作树不是总体
```

一个 PreToolUse 钩子(`.claude/hooks/guard-tree-enum.sh`)拦住这个**组合**:两半各自单独出现一律放行
(两者单独用都是正常的),用 `git ls-tree origin/main` 枚举的命令一律放行,解析不了的一律放行 —— 规则大
于钩子。有意例外:`OS_ALLOW_TREE_ENUM=1`。改这个钩子?重跑
`.claude/hooks/guard-tree-enum.selftest.sh`。

#### ⭐ 对照挂在**通道**上,不只挂在查询上 —— 而且**每次查询**都要跑一遍

上面两条写的都是**查询**级的对照(总体 vs 逐项、对照必须有能力失败)。还差一层:**通道本身也会静默
失灵,而且是间歇性的 —— 间歇比全坏更危险,因为第一次拿到命中的席位会学会信任它。**

实测(objectui#7185,同一容器、同一小时、两条 lane):MCP `search_issues` 对一个 `issue_read` 能直接
读出来的 issue 返回 `total_count: 0`;而另一条 lane 用一个**短关键词**查询在同一个工具上拿到 **3 条
命中**。⇒ ⛔ **不是通道不可用** —— 死通道不会返回 3 条。失灵的是那一次查询(失败的那条是**长的、近
乎逐字的标题**,可用的那条是短关键词)。所以规则不是「别用 search」,而是:

- **非空结果只自我验证「通道还活着」,⛔ 不验证它报出来的那个大小;任何声称总体大小的读数 —— 一个零,或一个计数 —— 都要在同一次运行里带一个会响的「已知必中」对照** —— 例如某个你能用 `issue_read` 直接读到的 issue 的近逐字标题。⛔ **没跑对照的空结果不是一次读数**:它不携带任何信息,而它渲染出来恰好就是去重步骤想要的那个答案(「没有重复」),与真负例**不可区分**,不做对照就**不可证伪**。失败形态不是「报错然后重试」,是「立了一张重复卡、没人纠正、下一个席位再立一次」。⚠️ **非零的那一半失败形态不同,而且更难看见**:一个锚在数据并不遵守的边界上的模式,给出的不是错误而是一个**自信的计数** —— 它既可能把散文算进总体,也可能漏掉另一种拼写,而一个数字读上去正好就像一次成功的测量。⇒ 计数和零一样,不带对照就不是读数。
- **一条被发布的命令,必须在它被印出的那个形态下可复现。** 读数对、而印在它旁边的命令错,是这一类最常见的一半:命令在作者脑子里跑的是一份**蒸馏过**的输入,发布出去的那一行却要落在原始语料上 —— 下一个照抄重跑的人拿到的是一个**自信的零**,而在这里零读作「这个发现根本不存在」。⇒ 发布之前,把你要印出去的那一行**原样**再跑一次;蒸馏过的输入必须和命令一起写下来,否则它不存在。
- **每次查询都跑,不是每个会话跑一次。**「这个通道十分钟前还好好的」不是关于你眼前这次查询的证据。
- **兜底通道**:零配额的 GitHub 网页 payload 通道实测可用(同一次去重里返回 8 个 issue 号,含 `search_issues` 看不见的那个),**它要跑同一条对照** —— 它只是「某一天、某一个容器里被测过可用」,不是永久答案。
- ⭐ **已诊断的成因:`word:word` 形状的 token 被当成搜索 qualifier,静默清零整条查询。** MCP `search_issues` 把你的查询文本**逐字**贴进 GitHub search 的 `q=`,所以 GitHub 的 qualifier 语法在你以为是自由文本的地方是**活的**:粘进来的 issue 文本里一个裸的 `word:word` token(`page:header`、`record:quick_actions`、`ui:text`、`check:`、`pm:` 一类)会被解析成一个 **qualifier**,与其余词 AND 在一起,匹配不到任何东西,返回一个静默的 `total_count: 0`。实测最小对 —— 词与词序完全相同,唯一差别是一对反引号:`resolve record:quick_actions does` → **0**;把中间那个 token 用反引号包起来 → **17**。**本仓格外暴露**:这个产品的组件键本身就是 `word:word`,抽样 345 条标题里 **33 条(9.6%)**带一个 ⇒ 近逐字标题的去重查询,大约**每十次就有一次**被静默清零。⇒ **把任何标题或正文文本贴进 `search_issues` 之前,先给每个 `word:word` token 加反引号,或者把冒号换成空格** —— 前导反引号会打断 qualifier 解析。⚠️ **有意写的 qualifier 照常生效、照常有用**(`in:title`、`state:closed` 实测都被正常执行)—— 危险的只是无意撞上的那些。⛔ 这条**不取代**上面的对照要求:空结果依然永远需要一个「已知必中」的对照。
- **两个看着更像的候选都已实测排除**,别再往那个方向追:**不是索引延迟** —— 长查询漏掉的那个 issue,同一次运行里短查询就返回了,而长查询七分钟后重跑仍是 0;**不是读路径与搜索路径的 scope 差异** —— 搜索路径**看得见**那个 issue。⚠️ 连带一条更正:本容器里未认证 REST `/search/issues` 的 403 **不是 GitHub 发的**,是本容器自己的出口代理在执行「会话只绑定到它配置的那些仓库」的路径白名单,它对 GitHub 的搜索 scope 什么都没说 —— 读到状态码就下结论、没读随之而来的 body,正是它一度被当成 scope 证据的原因。

#### ⛔ 「这个声明键没有渲染器读」—— 一次源码 grep 的零答不了这个问题

`SchemaRenderer` 把节点剩下的键当作 React props 交给组件(剥离元数据键的那次解构,和紧跟它的那个 spread,都在 `packages/react/src/SchemaRenderer.tsx` 里),所以**一个渲染器可以消费一个它从不指名的键**。⇒ 一次 `schema.KEY` 的 grep 看不见这条通道,只会返回一个自信的零;而对 `...props` 做一次 `grep -l` **也不是**仪器 —— 转发的和不转发的渲染器**都**命中,且粒度是**那个渲染函数的签名**而不是文件(同一个文件里可以同时住着一个转发的注册和一个不转发的注册)。⇒ 主张某个声明键惰性的卡,**必须带一次运行期读数**:objectui#6158 用的那把尺(`next build` 之后读预渲染 HTML),或者一次真 `SchemaRenderer` + 真注册表、只变那一个键的探针。⛔ 源码 grep 不算,⛔ 也不要据此去枚举「受影响的键」。重测一个已裁定的退役之前,先读 `packages/types/src/__tests__/zod-mirror-parity.test.ts` 里那些 `RUNTIME SLOT` 条目 —— 它们逐组件记着这条通道,而这个类**已经导致过一次建立在假前提上的裁定**(objectui#8236)。

### ⚠️ GitHub 会改写你写进 issue/PR 正文的字节 —— 每次发布后回读

**六种已实测的改写,共享同一个失败模式:正文在写入之后被静默改变,而且不回读就看不见**
(objectui#6970、#6452;多个 agent 在同一个工作会话里各自独立撞到,重复发现率本身就是把它写下来的
理由)。

- **① tag 形状的片段在保存时被删掉** —— 反引号和围栏代码块**都不保护**。实测:一张 `.d.ts` 的 before/after 对照表,两列的泛型参数被吃掉后**双双塌成同一个字符串**,于是一张专为展示类型变化而写的表,渲染出来正好读作「什么都没变」。⚠️ 单独占据第一行的 HTML 注释标记同样被吃掉 —— 首行位置不提供任何保护,靠标记扫描找报告的机制会因此完全看不见那条评论。
- **② `PATCH` 把 session-URL 形式的 attribution footer 降级为 bare 形式**,丢掉 session 引用。
- **③ footer 是「缺了才补」—— ⛔ 不是无条件追加第二个,也 ⛔ 不是 `PATCH` 独有。** 提交的正文**不以** footer 结尾时,平台补上**一个 bare footer**:存储的正文 = 发出的正文**逐字节拼接**那一块,**恰好多 58 字节**,unified diff 只有那几行追加的 footer、没有内容被吃 ⇒ 与 ①② 都不同,这一种是**加**,不是**减**;提交的正文**已经**以一个 footer 结尾时**不补**,回读仍然只有一个 footer。⚠️ 旧措辞「`PATCH` 无条件追加第二个 footer —— 哪怕提交的正文已经以一个 footer 结尾」把条件性**说反了**,而那是更危险的那个方向:信它的席位为了躲重复会**先把自己的 footer 剥掉**,于是发出、也存下一条**一个 footer 都没有**的正文(objectui#9563)。⇒ ⛔ **永不剥自己的 footer**,按该通道规定的形态原样发出,发完回读。
  - **哪一半在哪条通道上测过 —— ⛔ 别把空格子读成已测。**「不带 footer ⇒ +58、逐字节拼接」测于评论 `POST`、issue 正文 `PATCH`(六次写入,每次在发请求**之前**预登记了预期字节数,6/6 命中)与 PR 正文 `PATCH`;「已带 footer ⇒ 不加倍」测于评论 `PATCH` 与评论 `POST`,两次都是预登记过的。⚠️ **仍空的一格**:issue / PR 正文 `PATCH` 送一条已以 footer 结尾的正文会不会加倍,还没有人在受控条件下写过。
  - **⛔ `+0` 不等于逐字节相同;而「平台认得出一个 footer」这个判据本身没被测过。** 评论 `POST` 收到一条已以 footer 结尾的正文时会**改写分隔符**(尾部换行被删、`---` 之前插入一个换行):字节数净零、53 个字符位不同 —— 数长度读作「没变」、比相等读作「被冲掉」,两种都错 ⇒ 回读一律按**首个不同字节的下标**判,⛔ 永不按长度判,并在发请求**之前**把预期字节数写下来。至于平台把什么形态算作「已经有一个 footer」:有席位报告 session-URL 形式的 footer、以及与 `---` 之间隔了一个空行的 footer **都被当成没有**、于是触发追加(objectui#9908 在一次 `POST` 上读到两个 footer,这是它的一个可能解释)—— ⚠️ 二手读数,⛔ 别当判据用,自己测过再写进来。
- **④ `issue_write` 创建 issue 时,attribution footer 被整块删除**(不是降级,是消失)。⭐ 定位方式值得单独记住,因为它把「删除」和「截断」分开了:发出的是 body + footer + 尾部 sentinel,回读结果是 **sentinel 在、footer 不在** ⇒ 被删的是**中间**那一块,是针对 attribution 的定向剥离。⚠️ 没有这个 sentinel 对照项,唯一能得出的结论是「正文被截断了」,那会把人指向完全错误的方向(比如去查长度上限)。
- **⑤ `create_pull_request` 把 bare footer 归一化为 session-URL 形式** —— 与 ② 恰好**反向**。⇒ ⭐ 两条合起来才是完整后果:**一个 PR 正文只要被创建之后再编辑一次,就会丢掉 session 引用**,单看任一条都看不出来。⚠️ 而且那个 session id 是**席位**的,不是具体那次实现的 —— 任何想靠它回溯「是哪个 agent 做的这次改动」的机制,只会拿到席位粒度的答案,比看上去弱一档。
- **⑥ ⛔ 关单关键词解析器无视否定 —— 这一种最危险。** 解析器扫的是 `close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved` 紧跟一个 issue 引用,**它不解析句子**:一句「本 PR 并不关闭某卡」若按英文否定式写成 does-NOT-close 加卡号,合并时照样把那张卡关掉。⚠️ 前五种在检视时**看得见**,这一种看不见:损害是**延迟**的(合并那一刻才发生,可能是几天后的另一个会话),而且**反转作者的明确意图** —— 那句话之所以存在,正因为作者在小心行事;卡被静默关掉后不再出现在任何队列普查里,于是它在跟踪的后续不是「可见地被阻塞」,而是直接丢失。安全写法:`Part of #<n>`、`Refs: #<n>`、`Related: #<n>`、裸 `objectui#<n>`(不带关键词)。

**实测有效的缓解,四条 —— 合起来才够,单独任何一条都不够:**

- **泛型和占位符写成大写单词**(例如 "OPT of `z.ZodNever`"),⛔ 永不字面写成尖括号形状,并在正文里说明为什么这么写。
- **session URL 写进正文散文、并作为反引号代码跨度** —— 实测原样穿过 `PATCH`;⛔ 别指望 markdown 链接形式的 footer 活下来。
- **issue 正文里的 attribution 写成散文**,⛔ 别依赖 footer 块(见 ④)。
- **每次发布之后回读到正文末尾,并数一次尖括号命中**;开 PR 之前额外扫一遍自己的正文 —— `grep -nEi '(clos|fix|resolv)' <file>`,确认每一个靠近 `#` 的命中都是你**有意**要关的那张卡。

**占位符不是特例:普通散文和围栏代码块里的占位符同样被吃掉** —— 实测一行命令配方里的两个占位符双
双塌成一个裸 `-`,而那一行存在的意义正是给出那两个占位符。权威措辞在 `../objectstack` 的 `AGENTS.md`
(「GitHub mutates body BYTES — spell poison-shaped tokens out in words, never literally」那一条),
⛔ 本仓不复制它的正文,免得两处漂移;这里只留指针,并**逐字**保留其中最要紧、也最容易被漏掉的那半
句:

> A body reading short only through the API is probably intact — check the rendered page before "repairing" it; a rewrite destroys a correct card.

⇒ ⭐ **回读发现正文「变短」时,先看渲染后的页面,再决定要不要修。** 一次不必要的重写会毁掉一张本
来正确的卡 —— 而在受管面上,那是不可恢复的。

### ⛔ 受管面(governed surface):agent 起草,获授权批准后由认领席落地

维护者裁决(2026-08-18),**原文照录、不翻译** —— 提问明确点名了本仓:

> 任何对 agents.md 等文件的修改是不是也需要人类审核? 包括 objectui cloud仓库

> 同意

**本仓的受管面 —— 六项,已逐条对本仓实际目录核实:**

- `AGENTS.md` —— **你正在读的这个文件本身就是受管面**。
- `CLAUDE.md` —— 仓根一个。
- `.claude/**` —— **整棵树**:hooks、settings、launch 配置、内部 skills,一个不落,**不是只有 skills**。
- `skills/**` —— 仓根**发布给使用者**的那棵 skills 树(如 `skills/objectui/`),guard 里的 `skills-catalog` 一项 —— 见下方 ⚠️,这一项本段曾经写反。
- `docs/adr/**` —— 本仓**确实有**这个目录;它和上面四项同级,不因为篇数少而降级。
- `.github/workflows/**` —— CI、部署与发版 workflow 决定每次 push 跑什么、拿什么门禁挡合并队列,改它们由维护者批准(维护者 2026-10-12 裁决,原文照录:「两仓加治理行」,objectui#12255)。guard 自己的 `governed-surface-guard.yml` 也在内;Dependabot 的 `github-actions` 升级同样受管 —— `dependabot-auto-merge.yml` 照常批准并入队,`merge_group` 腿照样拒绝,它等的也是一条获授权的批准。`.github/` 下其余文件(`dependabot.yml`、`labeler.yml`、`prompts/`)**不受管**。

⚠️ **两棵 skills 树都受管 —— 别把它们和 skill 的安装位置弄混:**

- `.claude/skills/**` —— 内部 agent 工具,在 `.claude/**` 之内,**受管**。
- `skills/**`(仓根,发布给使用者的那棵,如 `skills/objectui/`)—— **同样受管**,就是 `GOVERNED_SURFACES` 里的 `skills-catalog` 一项:只改 `skills/**` 的 PR 也**停在 draft 等一条获授权的批准**,⛔ 批准前不翻 ready、不入队。`.agents/skills/` 是 skill 的**安装位置**(内容由 `skills-lock.json` 还原,第三方的那些被 gitignore),不是规程文本,**不受管**。
- 已发布的 `skills/**` **⛔ 不引任何 issue / PR 号**(维护者 2026-10-12 裁决;原则是 2026-08-12 的裁决,原文照录:「处理 issue 时犯的错应该总结成经验,保留 issue id没有意义,如果ai去查原始issue,得不偿失。」)。它的读者是客户的 agent,经 `npx skills add` 装进别人的仓库,没有任何工具能解一个 objectui 号 —— 数字只会引它去查(或编造)一段它追不到的历史,而且号会烂。一条教训写成**自含规则:失败形态 + 纪律 + 边界**;出处留在落地它的 PR 里;日期与「maintainer ruling YYYY-MM-DD」的措辞照留,`ADR-NNNN` 不是 issue 号,也照留。⚠️ 本仓没有门禁复核这一条(依诫条 #9 明说),兜底是上一条的受管面评审;复核它的命令是 `git grep -n -E '#[0-9]{3,}' -- 'skills/**'`,去掉 CSS 十六进制色值后应为空 —— 这里写的是命令,不是读数。

  两棵树名字像、内容都叫 skill,本段曾按「路径是不是以 `.claude/` 开头」把仓根那棵判成**不受管**、并要求照普通代码 PR 自行入队 —— **那是错的**,而且错在会被机械拒绝的方向上:`merge_group` 腿照样拒,照着那句话做的席位要赔上一整轮队列构建。判据以 `scripts/check-governed-queue-guard.mjs` 的 `GOVERNED_SURFACES` 为准,拿不准就直接问它:`node scripts/check-governed-queue-guard.mjs --test <paths…>`。

**硬规则 —— PR 的 diff 命中受管面时:**

⇒ **命中即停 draft;⛔ 未获授权批准不 ready 不入队不自合、永不批准,获批后认领席落地。**「获授权批准」= `GOVERNED_APPROVERS`(`os-zhuang` / `hotlong`)里某个账号的一条 latest-decisive APPROVED review,DISMISSED 与被顶掉的不算(完整判据在下面那段);在它出现之前 ⛔ 绝不 `gh pr ready`(不退出 draft)、⛔ 绝不加入合并队列、⛔ 绝不 `gh pr merge --auto` / `enable_pr_auto_merge`、⛔ 绝不自己合并。**那条批准本身就是审核记录** —— 它出现之后,`gh pr ready` + `gh pr merge --squash --auto --delete-branch` 由**认领席**执行,照常走合并队列(维护者 2026-09-13 裁决 C,原文照录、不翻译:「C. approve 后不管后续改动都由席位落地:」)。

⛔ **第五条禁令 —— 绝不自己去留下那条 approval。** 上面四条管的是**落地**,这一条管的是**批准**:`scripts/check-governed-queue-guard.mjs` 的文件头部把它写成规范条款,它 `cleared` 分支的判定文本也印着同一句。此处**逐字照录、不译**(两处措辞不得漂移):

> ⛔ An agent seat never submits an approving review on a governed-surface pull request, under any account. Every seat in this repository writes under a shared GitHub identity, so `GOVERNED_APPROVERS` is a technical control that is only as good as that normative rule — the same class as the seat-side no-merge rule, and the reason the DRAFT remedy is listed first.

sha pin **退休**之后这条**更重、不是更轻**(维护者 2026-09-04 裁,#7606 执行、#7616 把新判据写进下面那段):一条获授权的 APPROVED review 现在清掉同一 PR 其后**每一次** push,于是在一个 agent 操作的 approver 账号与一次它自己放行的受管落地之间,**只剩这条规范禁令**。

- **判据是 PR 的文件清单,不是 PR 的标题或描述。** 命中与否只看路径。
- **混合 diff:一条命中即整个 PR 分叉,没有比例判断。** 99 个普通文件 + 1 个受管文件 = 整个 PR 等那条获授权的批准。其余部分急着落地,就把受管文件**拆成单独的 PR**,别用「占比很小」给自己开口子。
- **起草不受限。** 写、推分支、开 PR、按 review 修改,每个席位照做不误;被保留的只有**落地**这一个动作。
- **CI 全绿、已 review 都不构成例外。** 这类文件是后续每一次 dispatch 读的操作规程,绿灯说明不了它该不该成为规程。
- **发现自己已经挂上了怎么办**:把 PR 转回 **draft** 是唯一能可靠退出合并队列的动作 —— 只调 `disable_pr_auto_merge` 会摘掉 auto-merge 但**不取消队列成员资格**,两个都要做。⚠️ 只回收**你自己**挂上的:本仓多 agent 共用同一 GitHub 身份,不是你设置的状态就属于别的 actor —— 去问、去报告,别替他回退。

**本仓的机械兜底只有一件,它的两条腿意思不同:`merge_group` 腿拦得住合并队列(2026-09-27 起,见下),`pull_request` 腿只告警 —— 别把 PR 页上的绿读成不受管,也别再读成「什么都没有」。** 本仓仍然没有 CODEOWNERS(核实:仓内不存在该文件),受管面上也没有钩子;但 `.github/workflows/governed-surface-guard.yml`(check 名 `Governed Surface Queue Guard`,判定逻辑在 `scripts/check-governed-queue-guard.mjs`)**是活的**:`pull_request` 腿是早期告警、**故意 exit 0**(受管 PR 停在 draft 正是健康终态,所以**绿不等于不受管**),`merge_group` 腿才是会拒绝的那条 —— 它要求 `GOVERNED_APPROVERS`(`os-zhuang` / `hotlong`)里某个账号的一条 latest-decisive APPROVED review,**留在哪个 commit 上都算**;DISMISSED 与被顶掉的批准(同一 reviewer 后续给了 CHANGES_REQUESTED)不算,该集合之外账号的 APPROVED 不算,review 列表为空或读不到则 fail closed —— 判定读的是**有没有一条人工批准记录**,不问它是对哪些字节给的(维护者 2026-09-04 裁,逐字未译:「你的门禁有问题，只需要有人工批准记录就行，不需要卡最新的提交。」;sha pin 是**退休**不是放宽,守卫里已没有任何判定读 `commit_id`)。⚠️ 已接受的代价:批准之后的 push 不再被这道门重审,一个已批准的受管 PR 可以带着批准者没读过的字节落地 —— 维护者接受这一点,而这道拒绝先印的补救仍是转回 draft、交人类合并。⚠️ 而这条拒绝腿上的判据**不止上面那一条** —— #9018(PR #9212)给 `merge_group` 腿加了**第二条、与受管面完全无关的**判据:它枚举该 merge group 要落地的**每一个** PR(逐 commit 分解,不是只读 `merge_group.head_ref`),读每个 PR 的 label,其中任何一个仍挂着 `needs:contract-review` 就拒绝(**exit 6**);label 读不到、或该 group 指不出任何 PR,同样拒绝(**exit 7**)。⚠️ 这条判据读的是**挂在 PR 上的 label**,不读任何路径、不问 diff 命中了什么 —— ⇒ **一个 diff 完全没碰受管面的 merge group,现在也可能被这道 check 拒绝**;`pull_request` 腿不受影响,不读 label。⚠️ 它拦得住,是因为这个 check 名进了 ruleset 的 required 集合 —— 下面是一段有日期的历史,不是本段替你复核的现状:ruleset 开关只有维护者能翻;2026-09-14 的读数里它还不在集合中,那时这条拒绝腿只报告、不阻止队列;ruleset 的最后一次编辑在 2026-09-27,三分钟后 objectui#6596 以 completed 关闭,2026-09-28 实测它已在集合里。**在集合里,它的拒绝(上面的 exit 6 / exit 7 同样)就会把 PR 踢出合并队列。** 它现在还在不在,跑 `node scripts/check-required-check-set.mjs` 读,⛔ 别把它的答案抄进本段。⚠️ 这是按配置推出的,不是观察到的:登记后到 2026-09-28 的 `merge_group` 运行全部通过,拒绝路径还没在队列里真正触发过一次。事后一侧:`../objectstack` 的 report-only 合并后审计(`scripts/pm/check-governed-merges.mjs`)自 objectstack#9619 起**已覆盖本仓**(四个受管仓一次扫完),它把受管面的合并列出来,但它不阻止任何事。⇒ 一个没有获授权批准记录的受管 PR 经合并队列落不了地,这一半队列替你拦;**拦不住的是批准本身**:席位共用一个 GitHub 身份,守卫分不出那条 APPROVED 是不是人留的,绕过 ruleset 的人也不经这道门(谁能绕过,见上面 ruleset 那一条)—— 所以第五条禁令的效力仍然全在于你读到了它并照做。**⛔ 别再把本段当成兜底工具的完整清单** —— 覆盖面以脚本自己的 `GOVERNED_SURFACES` 为准(它随树变化,本段不会);⚠️ 该清单曾与上面的受管面清单**并不一致**(脚本的集合含已发布 `skills/**`),这一分歧**已裁**:维护者第 5 场决裁批 #7 采 **Option A**(#6866 评论 5469339478)—— 已发布 `skills/**` **受管**,守卫的读法才是裁定的那个;该裁决**已随本段上方的清单落地**(#6866):上面六项已含 `skills/**`,与脚本的 `GOVERNED_SURFACES` 一致,曾经那条「仓根 `skills/**` 不受管、自行入队」的豁免**已作废**,⛔ 别再照它行事。

### 服务纪律(本仓库与 `../objectstack` 多 agent 并行开发)

本仓库和 `../objectstack` 都有多个 agent 同时开发,正在运行的 dev 服务很可能是**别人的**:

- **要测试就自己起临时服务**(自选空闲端口),**绝不随手停/杀别人的服务** —— 发现端口被占先 `lsof -i :PORT` 看清是谁的,不是你起的就换端口,不要 kill。
- **开发完成必须关掉自己起的服务**,只清理自己启动的进程(按记下的 PID 杀,不要按端口/进程名一锅端)。

### Local dev — console UI ↔ backend (read before debugging UI)

- **首次 / 换 pin 之后**:仓根 `pnpm run setup`(构建 `.objectstack-sha` 钉的 `@objectstack/*`,再冻结安装;见 §9「依赖与锁文件」)。console 编进去的 `@objectstack/spec`/`client` 就是这份构建,不是 npm 上的发布版。
- **启动前端**:仓根 `pnpm --filter @object-ui/console dev`(Vite,固定 **:5180**,见 `apps/console/vite.config.ts`)。
- **后端默认连 `:3000`**:vite `/api` proxy → `DEV_PROXY_TARGET || http://localhost:3000`。**要测哪个后端就把它跑在 :3000**(framework 仓:`PORT=3000 pnpm dev:crm`,或 `PORT=3000 pnpm dev` = showcase)。经 `pnpm --filter @object-ui/console dev` 传 `DEV_PROXY_TARGET` env **不**可靠(不一定透传到 vite 子进程);要把 console 指向别的后端端口,`cd apps/console` 后内联设 env 才灵(已实测——见下「每个 agent 独立测试栈」)。
- `framework` 的 `:3001/_console` 服务的是**已发布的** console(`packages/console/dist`),**不是本仓 src**;改 src 必须用上面的 :5180 dev 服务验证(或在 framework 跑 `pnpm objectui:refresh` 重新拉构建——慢)。
- 路由用 app 的 **`name`**(如 `showcase_app`,不是 `showcase`);直接 URL 进对象可能落到 Setup「对象不存在」——先经启动台/应用切换进入该 app 设好 currentApp。
- **清 localStorage 会登出**(session token 存 localStorage;首页应用磁贴也读 localStorage 缓存,跨会话会显示过期的 app 列表)。
- better-auth 用 `localhost`(非 `127.0.0.1`)否则 Invalid origin。
- 浏览器验证:优先用桌面 preview(`preview_*`,`.claude/launch.json` 里配 `showcase-console`);chrome-devtools MCP 掉线时切 preview。

### 每个 agent 独立测试栈(端口隔离,多 agent 并行的推荐做法)

上面是**单栈**约定(后端 :3000 + 前端 :5180);多 agent 并行时端口会打架。要彻底隔离,每人起**自己端口**的一整套栈(后端 + console),互不干扰。**下面这套已实测端到端跑通**(console 代理登录 + 从自己后端拉到 `showcase_account` 的 Northwind/Contoso):

1. **后端(`../objectstack`)—— `--fresh` 临时库 + 自选端口**,数据与端口都隔离、退出自动清:
   ```bash
   # showcase(带 showcase_field_zoo / showcase_account 等):
   cd ../objectstack/examples/app-showcase
   pnpm exec objectstack dev --seed-admin --fresh -p 4010
   #  --fresh        临时 sqlite 库(os.tmpdir()/objectstack-dev-*),SIGINT/SIGTERM 自动删,绝不碰别人的 .objectstack/data/dev.db
   #  -p <port>      监听端口(等价 OS_PORT / PORT;dev 模式端口被占会自动顺延)
   #  --seed-admin   默认开;空库播种 admin@objectos.ai / admin123
   # CRM:  cd ../objectstack/examples/app-crm && pnpm exec objectstack dev --seed-admin --fresh -p <port>
   # 要持久库(跨重启保留):去掉 --fresh,改用 --database "file:/tmp/agent-<port>.db"(或 OS_DATABASE_URL)
   ```
   干净 checkout 首次需先 `pnpm run setup`(build `@objectstack/spec`;⛔ 不是 `pnpm setup`,那是 pnpm 的内建命令,只改 shell rc、不跑这个脚本);已装过的直接可跑。

2. **Console(你的 objectui worktree)—— 自选端口 + 指向你的后端**:
   ```bash
   cd apps/console
   DEV_PROXY_TARGET=http://localhost:4010 pnpm exec vite --port 5190 --strictPort
   #  必须 cd 进 apps/console 让 env 直达 vite;用 `pnpm --filter … dev` 传 env 不可靠
   #  --strictPort   端口被占直接报错,绝不静默顺延撞到别人的端口上
   ```
   自检:`curl 'http://localhost:5190/api/v1/data/showcase_account?$top=2'`(经 console 代理打到你的 :4010,应返回 Northwind/Contoso)。

3. **Live E2E —— 全 env 参数化指向你的端口**(见 `playwright.live.config.ts` / `e2e/live/global-setup.ts`):
   ```bash
   LIVE_APP_URL=http://localhost:5190 LIVE_API_URL=http://localhost:4010 pnpm test:e2e:live
   #  凭据用 LIVE_EMAIL / LIVE_PASSWORD 覆盖(默认 admin@objectos.ai / admin123)
   ```

4. **桌面 preview**:给 `.claude/launch.json` 加一条你自己的 console 配置,仿现成的 `console-build-test`(`cd apps/console && DEV_PROXY_TARGET=http://localhost:<后端> pnpm dev --port <前端> --strictPort`)。

**纪律**:端口自选空闲高位(用前 `lsof -i :PORT` 确认没人占);收工只按**自己记下的 PID** 收(`kill $(lsof -ti tcp:<你的端口>)`),`--fresh` 临时库随进程退出自动清;**绝不动 :3000 / :5180**(通常是别人的单栈)。

### Edit sizing
Keep single `edit`/`create` payloads under ~20000 bytes. If an edit fails, break it into multiple smaller ones.
