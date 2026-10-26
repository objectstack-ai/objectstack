# @object-ui/plugin-chatbot

## 18.1.0

### Minor Changes

- 47138b7: The Console's first page load no longer downloads the chat UI (objectui#13410). The `plugin-chatbot` chunk (169.6 KB gzipped, the third-largest eager chunk) and most of `vendor-markdown` used to load on every page, including for users who never open a chat, because the console shell imported a handful of small helpers from the `@object-ui/plugin-chatbot` package root, and the root re-exports the renderer that registers the chat components when it is evaluated. Measured on the Console's production build, the eager closure drops by 254,055 gzipped bytes (3,326,111 to 3,072,056). The chat now loads when it is first shown: opening the dock, visiting `/ai…` or `/s/:token`, or rendering a `chatbot`, `chatbot-enhanced` or `chatbot-floating` node.
  
  `@object-ui/plugin-chatbot` adds a side-effect-free `@object-ui/plugin-chatbot/core` subpath: `useAgents`, `resolveDefaultAgentName`, `PLATFORM_DEFAULT_AGENT`, `agentHasCapability`, the agent alias helpers (`AGENT_ALIAS_GROUPS`, `agentAliasGroup`, `agentRouteName`, `resolveAgentParam`, `isBuiltinAgentName`, `isBuildAgent`, `isAskAgent`), `AI_USAGE_REFRESH_EVENT`, `emitAiUsageRefresh`, `publishHealthFromResponse` and `detectPendingApproval`, with their types. Importing it registers nothing and reaches no chat UI module. The package root still exports every one of these names, unchanged.
  
  `@object-ui/app-shell` takes those names from `/core`, and the ChatDock loads its default chat body on first render instead of importing it. `resolveApiBase` is still exported from the same places.

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- fc3c2cc: Five fixes on the AI build surface, from the 2026-10-05 cloud acceptance run (objectui#11658).
  
  - **The first AI build lands on the running app.** The built-moment transition still moves the conversation into the Studio workbench at `/studio/PKG/interfaces`. The Interfaces canvas now opens in **Run** mode with the properties panel collapsed, where it used to open in Design with the panel open. One click on **Design** brings back the design overlays and the properties panel. Every other way into Studio, the "Design in Studio" button included, still opens in Design. The transition asks for this with router state, which the pillar reads once at mount; it is not a URL param, so a reload or a shared link opens the designer.
  - **The in-app composer names the task.** Inside an app, the composer placeholder reads "Ask about your data, or ask me to change this app…". This covers the console dock in a running app, the Studio dock and `/ai/build?package=`. It used to read "Ask {agent}…", which showed as「向 构建 提问…」in Chinese. The cold-start build surface and the ask agent keep the placeholders they had. New key: `console.ai.askOrChangeApp`.
  - **The AI usage popover shows one figure.** The popover shows the share of the single AI pool used so far (`console.ai.usage.poolUsed`, for example "19% used"). It no longer shows the build / data-Q&A split, because that split cannot honestly say which part a single-composer turn used. The keys `console.ai.usage.meterBuild`, `meterAsk` and `breakdownTitle` are retired from all ten packs. `useAiUsage` still reads `breakdown` from the wire and validates it strictly, but nothing renders it.
  - **The usage gauge no longer looks like a loading spinner.** The header glyph is now a closed outline in the tone colour with a pie wedge inside it. It used to be a stroked arc over a faint track, which at low usage had the outline of a spinner.
  - **The plan card's scope chip is localized.** The extend-mode chip on the proposed-plan card and on the live design panel reads the pack's `chatbot.plan.extendTarget` sentence, where it used to show the English literal "Adding to existing app". It names the target app by its label, and the internal name moves to the chip's tooltip. `ChatbotEnhanced` gains an optional `resolveAppLabel(appName)` prop, and the console passes one over its metadata apps. A host `planExtendLabel` still takes precedence, but the prop no longer defaults to an English string.
- 848ba0e: The chat launchers show a marker while a proposed plan awaits the user's approval (objectui#11666, item 6 of objectui#2458). A user who closed the chat with a blueprint still waiting on them used to get no sign of it from the launcher they return to.
  
  What a user sees: while the newest proposed plan of a conversation still offers "Build it", the console's assistant button (the floating launcher on app pages and Home) and the ChatDock edge launcher Studio uses carry a small amber dot. Assistive tech reads it as the button's description, from the new `console.ai.dock.planAwaitingApproval` key in the active language. With no plan awaiting, neither launcher shows anything. The dot goes away when the plan stops awaiting: the user approves it, its build runs, or a newer proposal takes its place and is itself approved or built. Opening the chat clears nothing by itself, and neither does opening another conversation. Deleting the conversation from the `/ai` sidebar drops it.
  
  Where the reading comes from: the chat's own plan card. `ChatbotEnhanced` derives "awaiting approval" from the same producer its card header and body read (`resolveProposalCardState` reads `pending`), and reports it to its host. The console's chat pane publishes that reading on the assistant bus, per conversation and per signed-in user, and the launchers read the bus. They import no chat code. The reading is exact for everything that happens in the tab. It does not see a decision made in another tab or on another device, and a page reload starts it empty until a chat on that conversation is opened again. The durable copy is the server conversation, which the launchers do not read.
  
  **Clause-②: yes (widening).** Two published surfaces widen:
  
  - `@object-ui/plugin-chatbot`: the exported `ChatbotEnhancedProps` type gains one optional member, `onPlanApprovalPendingChange`, a callback that takes one boolean and returns nothing. `ChatbotEnhanced` calls it once on mount and again whenever the boolean changes. Without it nothing changes.
  - `@object-ui/i18n`: every built-in locale pack gains one key, `console.ai.dock.planAwaitingApproval`. The `en` pack is exported from the package entry, so the key also joins the translation-key type derived from it.
  
  `@object-ui/app-shell` adds no export: the bus functions the pane and the launchers use (`publishPlanApprovalPending`, `usePlanApprovalPending`) ship inside `dist/` but are not on the package entry, and the exported `assistantBus` object and `AssistantSnapshot` type are unchanged. No prop, export or key is removed, and no existing member changes type.
- 6d5eb34: The chat build panel reads cloud's post-apply verification loop, and an unknown build phase no longer reads as "Building" (objectui#11988, the receiver objectstack-ai/cloud#2172's ruling A orders).
  
  After `apply_blueprint` finishes, cloud's agent loop reports its verification hops on a second `data-build-progress` part with the id `build-verify`, beside the build tree. A hop is `{ phase: 'verify', hop, tool }` and the exit is `{ phase: 'done' }`. The receiver used to take the last `data-build-progress` part whatever its id, and turned every phase other than `data` and `done` into `structure`. So the first verification hop replaced the finished tree with "Building your app…".
  
  - **The tree and the verification part are read apart, by part id.** The `build-verify` part never displaces the tree, whichever order the two parts arrive in. A message that carries only the tree maps and renders exactly as before.
  - **The build panel shows a verification line under the tree.** It reads "Checking the change… step N" while a hop runs, with the hop's tool name as its tooltip, and "Checked the change" once the `done` frame arrives. A `build-verify` part on a message that has no build tree is not drawn as a tree.
  - **Phases are read against the spec's vocabulary.** The receiver's phase table and frame type are typed by `@objectstack/spec/ai`'s own `BuildProgressPhase` and `BUILD_PROGRESS_FRAME_TYPE`, so a phase the spec adds or drops fails the type check here instead of drifting. The spec's runtime module is not imported, because it would put its whole AI schema module on the console's first load. A phase outside the vocabulary, or a frame without one, is now `unknown` and shows as a warning line ("Unknown build phase") on the tree header or on the verification line. It is no longer coerced to `structure`.
  - **Type change.** `ChatBuildProgress.phase`, reached through `ChatMessage['buildProgress']`, widens from `'structure' | 'data' | 'done'` to `'structure' | 'data' | 'verify' | 'done' | 'unknown'`: the spec's phase vocabulary plus `'unknown'`, held equal to the spec's union by a compile-time test. `ChatBuildProgress` also gains an optional `verify` member, `{ phase, hop?, tool? }`. The published typings name no new `@objectstack/spec` symbol, so the package's spec range is unchanged.
  - **New language-pack keys, in all ten packs:** `chatbot.build.verifying`, `chatbot.build.verifyStep`, `chatbot.build.verified` and `chatbot.build.unknownPhase`.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- ac59073: **The AI build conversation stays on the conversation and reads more compactly** (objectui#12724).
  
  - **No automatic navigation after a build.** When a build finishes, the page no longer moves you into Studio. The finished build card offers two buttons: 打开应用 / Open app (primary), which opens the app on its first navigation item, and 在 Studio 中查看 / View in Studio. Both are in-app navigations. The conversation is still bound to the built app, so Studio's copilot resumes the same thread.
  - **One collapsed line per phase.** A turn's tool activity reads as one line, for example "设计方案 · 4 步 · 0:48 · 读取编写规范 · 列出对象 ×3 …". Repeated calls of a tool fold into one step with a count, and a chevron expands the per-tool rows. The rows open on their own while a step is running. The elapsed time shows only for a turn this page watched; a reopened conversation shows no time.
  - **The finished build card.** Its header reads 「已搭建并上线 · APP」 / "Built and live · APP" once the build is published, and "Built APP" otherwise. Below the buttons, a line lists the build's next steps as things you can say, followed by the sentence 「之后的修改先存草稿，由你在 Studio 发布」. The progress bar is gone once the build is done. A whole-app build no longer repeats its next steps as a list on the draft card.
  - **The plan card.** The header names the app the plan builds and shows 等待确认 / Awaiting confirmation until you decide. Each object gets a row with one chip per field from the plan's `blueprint.objects[].fields`. The plan's views get their own rows, and the reply hint sits beside 开始搭建 / 调整方案. A plan without field rows (for example one restored from the local cache) shows the object chips with field counts, as before.
  - **The composer.** Outside an app, the build agent's placeholder reads 「描述你想搭建的应用，或要改的地方…」 / "Describe the app you want to build, or what to change…" and no longer names the agent. Inside an app it still reads "Ask about your data, or ask me to change this app…". The key hint reads 「↵ 发送 · Shift+↵ 换行」.
  
  `@object-ui/plugin-chatbot`: `ProposedPlan` gains optional `appLabel`, `views` and `objects[].fields`, and `ChatbotLabels` gains an optional `newlineHint`. `@object-ui/i18n`: new `console.ai.describeAppToBuild`, `console.ai.newlineHint`, `console.ai.viewBuiltAppInStudio`, `chatbot.phase.*`, `chatbot.plan.awaitingConfirm` / `objectsAndFields` / `views` and `chatbot.build.builtAndLive` / `nextStepsLead` / `nextStepQuote` / `draftPosture` in every pack. `console.ai.designBuiltApp` is retired.
- 44cb469: **The AI build cards draw the plan and result details the build agent now sends** (objectui#12724).
  
  - **The plan card.** Each object's fields are chips. A field whose sample data is held to a format shows it in mono type (「ISBN 13 位数字」, 「邮箱 邮箱格式」). A field the agent added on its own (you did not name it) has a dashed chip marked 「补充」 / "suggested". An object that declares its name field gets a 「名称：书名」 / "Name: Title" line. Each view shows one line saying what it does, for example 「列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序」. The assumptions are a bulleted list, and the count line ends with the sample data the build will stage (「示例数据 12 条/对象」).
  - **The result card.** A finished build shows a 「核对通过 7/7」 / "Checks passed 7/7" chip and the lines the agent verified on the built app, objects in one column and views and sample data in the other. Those lines replace the list of staged artifacts. When the agent re-checks the build later in the same turn, the card shows that newer check. 打开应用 opens the app the build landed in, and 在 Studio 中查看 opens its package.
  - **Step names.** The steps in the progress line read as short sentences in your language, for example 「记下后续检查项」 for the agent's to-do step and "List the existing objects" in English. Before, the English names were the tool names with their underscores removed.
  
  Each of these reads a field of the build agent's plan or result. When an older agent does not send that field, the card looks as it did before.
  
  `@object-ui/plugin-chatbot`: `ProposedPlan` gains optional `planCard` and `viewIntents`. `@object-ui/i18n`: new `chatbot.plan.suggestedField`, `chatbot.plan.nameField` and `chatbot.build.checksPassed` in every pack, and every pack's `chatbot.tool.*` values are reworded.
- 3da39ae: **The copilot's change card says when a change will be saved as a draft, and the applied card offers review and undo** (objectui#12894).
  
  - **The change card.** When the copilot proposes a change, the card is headed 「修改方案 · 2 项」 / "Change plan · 2 changes" and lists one row per change: a ＋ / ✎ / － symbol, the kind (字段 / 视图 …), the object and field it touches, and its type and parameters in small type (「number · 续借次数 · 默认 0 · 不必填」). For an app that is already live and holds records, the change is saved as a Studio draft: the card says so in an amber note, and its main button reads 「存为草稿」 / "Save as draft".
  - **The applied card.** After you confirm, the card shows what happened, for example 「已存为草稿 · 2 项未发布」 with 「已有 12 条记录的续借次数为空」 and 「核对：结构 ✓」. It offers 「查看变更并发布」 / "Review changes and publish" and 「撤销」 / "Undo" when the host provides them. Undo discards every unpublished draft of the app package, so when other drafts are pending the button says how many, and the card asks before it runs.
  
  Each of these reads a field the copilot's tools now send. When an older version does not send it, the card looks as it did before.
  
  `@object-ui/plugin-chatbot`: `ProposedChanges` gains optional `posture` and `primaryAction`; `ReplayOutcome` gains optional `draftState`, `existingRows` and `appliedCard`; `ChatbotEnhancedToolInvocation` now references both types instead of repeating them; `ChatbotEnhancedProps` gains optional `onReviewDrafts` and `onDiscardDrafts`. `@object-ui/i18n`: new `chatbot.changes.*` keys in every pack.
- 76f91f8: feat(plugin-chatbot): a drafted result's Preview button appears for any draft kind, and the draft preview bar names what is pending on the surface it shows (objectui#12968)
  
  Clause-②: yes — `ChatbotEnhancedProps` gains the optional `onPreviewDraft`.
  
  **`@object-ui/plugin-chatbot`.** A drafted tool result whose items include no app now draws a
  Preview button beside Publish and Review when the host passes `onPreviewDraft(items, { appSegment })`.
  The click hands the host the drafted `{ type, name }` items and the owning package id, the app's route
  segment. A draft set that includes an app keeps `onPreviewDraftApp`, unchanged, and a host that passes
  no `onPreviewDraft` draws what it drew before. Preview publishes nothing. The confirm path previews
  too: `detectReplayOutcome` lifts a drafted replay's `drafted[]` items into the exported `ReplayOutcome`
  as the optional `items`, and the applied card (or, from an older cloud, the drafted badge) draws the
  same Preview over them through the same `onPreviewDraft` / `onPreviewDraftApp` rule.
  
  **`@object-ui/app-shell`.** In draft preview (`?preview=draft`), the DraftPreviewBar's message names
  how many pending drafts belong to the surface it shows: an object's list, view or record, a page, a
  dashboard or a report. The count is read from the same pending-drafts list as before. The preview's
  deep-link table (`preview/draftSurface.ts`, `draftPreviewPath`) maps drafted items to the route that
  shows them: a page to that page, a view to the object's list on that view, a field or object to the
  object's default list, anything else to the app. The console wires it: `ChatPane` passes
  `onPreviewDraft`, and a field, view or page draft's Preview opens the Live Canvas at that path, in
  draft preview; `LiveCanvas` takes the full preview path beside the app segment (`path`). An app
  draft's Preview opens the app as before.
  
  **`@object-ui/i18n`.** `preview.draftBar.pendingHere`, a plural family, in all ten packs.
- 51269f0: The AI build chat's pending-drafts bar no longer covers the composer's input (objectui#12978).
  
  On the full-page chat (`/ai/build`), with a pending draft, the bar that offers 发布 floated over the composer (`absolute bottom-20`): it sat on the input's first line, so the placeholder and the first line typed were hidden. It is now a row of the composer's own area, laid out in flow directly above the input, so the conversation gives up the room instead, at every width. The console dock mounts the same chat pane and gets the same row. The package's own Studio still draws no bar (objectui#12965).
  
  **`ChatbotEnhanced` gains `promptHeaderSlot`** (optional `ReactNode`): a host's row rendered in flow at the top of the prompt area, above the input and outside its form. Unlike `promptOverlaySlot`, which stays absolute-positioned for palettes, it takes layout space. Content that renders nothing takes no space. Hosts that do not pass it render exactly as before.
  
  **Clause-②: yes (widening)**: one optional prop, `promptHeaderSlot`, added to `ChatbotEnhancedProps` in `@object-ui/plugin-chatbot`. No export is added or removed, and no existing prop changes.
- b4e0787: The runtime chat contracts have their own names, apart from `@object-ui/types`' authoring `ChatMessage` / `ChatToolInvocation` (objectui#6349, batch 5). The shape `<ChatbotEnhanced>` renders is declared as `ChatbotEnhancedMessage`, and its tool invocations as `ChatbotEnhancedToolInvocation` — the names this package already published them under. `ChatbotEnhancedMessage` is no longer deprecated.
  
  **Type changes, breaking for some consumers.**
  
  - `ChatMessage` is no longer exported from `@object-ui/plugin-chatbot`. It denoted the same type as `ChatbotEnhancedMessage`, while `@object-ui/types` publishes a different `ChatMessage` (the JSON/SDUI authoring contract), so one name stood for two contracts across the two packages. Replace `import { type ChatMessage } from '@object-ui/plugin-chatbot'` with `ChatbotEnhancedMessage`; the shape is unchanged. The compiler names the replacement (TS2460: declared locally, exported as `ChatbotEnhancedMessage`). For authored messages, import `ChatMessage` from `@object-ui/types` and convert them with `toRuntimeMessages`.
  - `ChatbotEnhancedToolInvocation` keeps its name and shape; only its declaration was renamed from `ChatToolInvocation`, a name this package's entry never exported.
  
  The README and the plugin-chatbot docs page now teach `ChatbotEnhancedMessage`. No runtime behaviour changes.

### Patch Changes

- d39ac2e: The AI Approvals inbox shows the error, not an empty queue, when its read fails, and its poll stops on an answer that will not change (objectui#11736).
  
  On a deployment with no AI service, the open edition answers `501` on `/api/v1/ai/pending-actions`. `AiPendingActionsInbox` rendered the error alert and, beneath it, "No actions waiting". That reads as a live approval queue that happens to be empty, on a deployment that has none. `usePendingActions` also re-armed its five-second interval whatever the read answered, so the page asked the dead endpoint every five seconds for as long as it stayed open.
  
  - The inbox shows the empty state only when the read answered. When the read failed, the error alert stands alone.
  - `usePendingActions` now arms each poll after the previous read settles, according to its answer:
    - A refused read stops the poll. That is `501`, or any `4xx` except `408` and `429`, such as `401`, `403` or `404`. A manual `refresh()` that succeeds, the re-fetch after `approve` or `reject`, or a change to the hook's options starts it again.
    - A transient failure backs the poll off. That is no answer at all, `408`, `429`, or a `5xx` other than `501`. The delay doubles with each consecutive failure, up to 120 seconds, or up to `pollInterval` if that is longer.
    - A read that succeeds polls again after `pollInterval`, as before, and resets the backoff.
  
  The policy is in the hook, so every caller of `usePendingActions` gets it, not only the inbox. With a working endpoint nothing changes: an empty queue still shows "No actions waiting", and the poll keeps its interval.
  
  **Clause-②: no.** No export, prop, option, return member or language-pack key is added or removed, and no accepted input widens.
- 8f8f760: Three more controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the list view and the chatbot): `ListView`'s "Color by field" and its "Rows per page" selector (the fallback for views without a grid pager), and `ChatbotEnhanced`'s model picker.
  
  The three were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour. "Color by field" now matches its twin in the compact toolbar's View settings popover, which made the same change earlier.
  
  What they write is unchanged. Each option gives the same value as before: "None" still clears the row-colour config, a field keeps the config's colours, each page size still reaches `onPageSizeChange` and refetches at that size, and each model still reaches `onModelChange` as its id. Re-picking the current option writes nothing. The model picker keeps its accessible name, the `model` label. A row-colour rule on a field the caller may not read still shows as "None" and is never offered.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead: "None" for a row-colour field outside the list's columns, the first size for a page size in force that is not one of the options (an undeclared size, for instance), and the first model for a selected model the environment no longer offers.
  
  **Clause-②: no.** No published face moves: the package entries export the same names, the two components take the same props, and no i18n key is added. What moves is the three controls' own markup, described above.
- d17952c: Studio no longer logs a red "Failed to load resource" line for things it already knows are absent (objectui#12508).
  
  - **A draft-only object is not asked for its published layers.** The Data pillar used to read `GET /meta/object/NAME/layers` for every selected object, so the console showed a 404 right after "New object" saved a draft. For an object that has a pending draft and is not in the package's published list, the pillar now reads the draft and skips the layers. A published object is read as before.
  - **A list view of a draft-only object is not asked for its published layers.** Opening such an object in the Interfaces pillar used to read `GET /meta/view/NAME.default/layers` and get a 404. Nothing of a draft-only object is published, so its views have no layer either, and the list-view panel no longer asks. A failed layer read (a 5xx or a network error) still shows as the panel's load failure.
  - **No `/ai/models` request on a server without an AI service.** The chat pane now asks for the AI-model list only once the agent catalog names an agent. A server without `@objectstack/service-ai` answers that catalog empty, so the console no longer asks it and gets a 501. `useAiModels` also remembers a 501 for the session: it no longer retries it five times, and a later mount does not ask again. Other failures, such as a 503 while the server is still starting, are still retried.
- c83e3fe: `ChatbotEnhanced`'s `onDesignBuiltApp` doc comment now describes what the finished build card draws since objectui#12724: "Open app" (打开应用) is the primary action and "Design in Studio" (在 Studio 中查看) the secondary one, primary only when the host passes no `onOpenBuiltApp` (objectui#12842). It no longer cites an ADR section that does not exist. Comment only; no behaviour changes.
  
  Clause-②: no
  No prop, export or language-pack key moves.
- 6db875e: Opening the console no longer starts nine reads the page does not show in the same moment as the page's own reads (objectui#12980, part 3).
  
  - **The bell.** The inbox and the pending-approvals count are read once the boot splash is gone and a frame has painted. Until they land the badge draws nothing, as it does while any read is in flight, and never a `0`. The Activity tab's feed, which the badge does not use, is read when the bell is about to open: a pointer over it, focus, or a click. Until then it does not ask whether `sys_activity` exists either, which inside an app is its own `meta/object/sys_activity` read.
  - **The header's dashboard, page and report lists.** The header reads each only on the route type that names one, for the phone bar's title. Any other route reads none of them.
  - **The navigation sync.** It reads the page and dashboard lists after the first paint. It still waits for both to load before it compares them.
  - **The agent catalog.** `useAgents` sends `GET /api/v1/ai/agents` after the first frame has painted, not while the page mounts. The AI entry points stay hidden until the catalog answers, as before.
  - **The user's language row.** The `sys_user` read that applies the signed-in user's language runs after the first paint. It stays a separate read because `GET /auth/me/localization` does not say whether its `locale` came from the user's column or from a fallback.
  - **The console's locale list and the timezone prompt's settings read.** Both wait for the first paint. The locale list asks for the session at the moment it sends, so a sign-out while it waits sends nothing.
  
  Nothing is added to a package entry: no export, prop or type member.
- 5f599db: The AI build plan card draws a stage field's lifecycle on its chip (for example 「借出 · 已还 ✓完成 · 逾期 ⚠」), read from the plan card's `lifecycle` key. A chip without the key draws as before (objectui#12994).
- 4b7ce47: The AI build plan card now draws a composed record title's line (for example 「名称：自动生成「{图书} · {读者} · {借出日期}」，表单里不出现」) in place of the plain 「名称：LABEL」 line, read from the plan card's `nameField.generated` key that objectstack-ai/cloud writes since cloud PR #3047. An object without the key draws as before.
- 6f877f1: An assistant answer reads well in the narrow assistant panel (objectui#13032). Headings inside a chat answer render at chat size (15–16px, bold, set apart by weight and spacing instead of the article-page 20–30px scale). Tables use 13px text and keep their first column frozen while the other columns scroll, and when the columns overflow the panel the table's expand control becomes a labelled, clearly visible "Expand" button. A finished answer taller than two heights of the conversation viewport is folded, with "Show full answer" and "Collapse" controls; an answer is never folded while it is still streaming. The scroll-to-bottom button now sits in its own row below the message list instead of floating over it, so it never covers text, a table or a heading. The four new strings ship in all ten locale packs.
- 633b8f1: A record link in an assistant answer opens that record inside the console (objectui#13037).
  
  An answer names a record with one fixed link form, `/record/OBJECT/ID`, for example `[Wayne Enterprises](/record/account/acc_42)`. The href must match `^\/record\/([a-z_][a-z0-9_]*)\/([A-Za-z0-9_-]{1,128})$` exactly: the object name in the spec's object-name grammar and a record id of letters, digits, `_` or `-`. A click hands the object and the id to the chat's `onOpenRecord`, the opener the `open_record` card already uses, so the console resolves the app and its own mount and navigates in the same tab, with no link dialog.
  
  Nothing else about links changes. An external link, any other same-origin path, and a record form carrying a query string, a fragment or more path keep streamdown's link-safety dialog and new tab, and so does the record form in a chat whose host gives no `onOpenRecord`. Nothing is added to the package entry.
- 912bfd4: The chat's step line no longer shows the agent's tool-loading step, and no longer counts it (objectui#13038).
  
  On the build agent, a data question calls `load_tools` first to attach the data tools. That call read as "Load tools" (zh 「加载更多工具」) among the turn's steps, and it was counted in the step total. It is the agent's own plumbing, not a step the user asked for. The phase line and its expanded rows now leave it out, and the count drops by one. A phase that so far called only `load_tools` draws no line, instead of "0 steps". Every other step reads as before.
  
  Nothing declares a tool as plumbing today, so the renderer keeps a private list holding `load_tools` only. Nothing is added to the package entry: no export, prop, type member or language-pack key.
- 1f1c4b5: Doc comments now name the runtime message type `ChatbotEnhancedMessage`, its name since objectui#6349 batch 5, instead of `ChatbotEnhanced.ChatMessage` (objectui#6349, batch 6).
  
  No type or runtime behaviour changes.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [f1781be]
- Updated dependencies [fbad078]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [38bb373]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [6f3299f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
- Updated dependencies [8cd4db4]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0

## 17.7.0

### Minor Changes

- b46c58f: BREAKING (`@object-ui/types`, `@object-ui/plugin-chatbot`): the authoring `ChatToolInvocation.state` union sheds the AI SDK's three runtime-only approval states — `approval-requested`, `approval-responded` and `output-denied` — so a schema-authored tool invocation can no longer claim an approval the runtime has nothing to back (objectui#10018, the residual clause of the objectui#8426 ruling, decision batch #86).
  
  (The bump is `minor` by this repo's release model — objectui's major is pinned to the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  **Break 1 — authored approval states are refused.** `ChatToolInvocation.state` (and so `ChatMessage.toolInvocations[].state` and `ChatbotSchema.messages`) no longer admits the three approval states, and the Zod mirror `ChatToolInvocationSchema` refuses them as an `invalid_value` at `state`. The refusal holds with or without an `approval` envelope: the envelope does not make a runtime-only state authorable. A chat runtime still produces these states — from the SDK's approval envelope, or promoted from an ObjectStack pending-action result — and still renders them; only the authoring face stops declaring them. Migration: author the state the tool call is actually in (`input-streaming`, `input-available`, `output-available`, `output-error`, or a legacy `partial-call` / `call` / `result`), and leave approval states to the runtime.
  
  **Break 2 — `onSend` handlers typed against the authoring `ChatMessage[]`.** The messages a chat runtime hands back can carry those three states, so they are no longer a subtype of the authoring `ChatMessage`. `ChatbotSchema.onSend`'s `messages` is now typed as the authoring message widened by exactly those states, and `useObjectChat`'s `ObjectChatMessage` is no longer assignable to the authoring `ChatMessage`. A handler that declares its parameter as the authoring `ChatMessage[]` stops type-checking. Migration: let the parameter be inferred from the slot, or declare it as `ObjectChatMessage[]` from `@object-ui/plugin-chatbot` when passing `onSend` to `useObjectChat`.
  
  Not breaking: `UseObjectChatOptions.initialMessages`, `SeamToolInvocation` and `toRuntimeToolState` now take the seam's state vocabulary (authoring plus runtime), which is the same set of values they accepted before, so every existing caller still compiles. `UseObjectChatOptions.initialMessages` also moves from the authoring `ChatMessage` to the exported `SeamChatMessage`, so nine optional runtime-only keys are now declared on that option: `buildProgress`, `blueprintProgress` and `charts` on a message, and `pendingActionId`, `draftReview`, `proposedPlan`, `proposedChanges`, `builderHandoff` and `replayOutcome` on each tool invocation. Nothing changes at runtime, because the hook's two builders behave exactly as before: local mode's `normalizeMessages` forwards `toolInvocations` whole (so the six tool-invocation keys survive) but copies only the base message fields (so `buildProgress`, `blueprintProgress` and `charts` are dropped), and API mode's `aiInitialMessages` rebuilds each message as SDK parts that carry none of the nine. Each key was already declared on `SeamChatMessage`; what changes is that a host passing one in an object literal is no longer told it is an excess property. No new name is exported: the three runtime-only states are named only by a non-exported alias in `@object-ui/types`, pinned equal to `ChatbotEnhanced`'s runtime union by `chat-message-contract.test.ts`. The effect on out-of-repo authors and hosts was not measured.
- e6203d7: An incremental edit is no longer read as a whole-app build. An `apply_edit` result says `kind: 'edit'` on its envelope, and its `drafted[]` may list the `app` artifact the edit re-staged, because an `add_object` op re-stages it for the nav merge. An `apply_blueprint` build carries no `kind`. The chat now takes the producer's field as the only thing that separates the two, instead of guessing a build from which artifact types were staged (objectui#10109):
  
  - `detectBuiltAppPackage` returns `undefined` for an envelope that says `kind: 'edit'`, in both the drafted and the auto-publish (`status: 'published'`) postures.
  - `DraftReview` has a new optional `kind?: 'edit'`, and `detectDraftResult` fills it from the envelope. The edit still gets its draft card, its items and its `packageId`, so one-click publish still works.
  - `ChatbotEnhancedToolInvocation['draftReview']` (`ChatToolInvocation.draftReview`) is now typed as `DraftReview` instead of an inline copy of its fields, so it declares `kind` too. The two were field-identical before this change, and the published tool-invocation type now describes exactly what the chat mapper puts on it.
  - `buildProgressFromDraftReview` builds no finished "Built X" panel for a draft review whose `kind` is `'edit'`, so a reloaded edit shows the same thing it showed live.
  
  An envelope without `kind` behaves as before. `DraftReview.kind` declares only the value these readers act on, and an envelope that says anything else leaves it unset.
- 64dae8e: Six user-visible fixes across the maker surface, the assistant rail and the
  dataset captions.
  
  **The maker's start chips now promise only what ADR-0112 v1 builds
  (cloud#1984).** Two of the five asked for automation the first version has no
  flows or actions for — the ticket chip said 「状态流转」, the inventory chip said
  「低库存预警」 — and the measured behaviour was not a refusal but a silent
  degrade: a status kanban and a low-stock view. The chip promised an alert and
  delivered a page. All five are reworded in all ten packs (and in the call-site
  `defaultValue` fallbacks, which are a second copy of the same strings) to ask
  for objects, fields, views, pages, dashboards and sample data, keeping each a
  real business scenario — the ticket chip now asks for a status field and a board
  grouped by it, the inventory chip for a view that filters below the reorder
  point. A note beside the keys says to revert when v2 re-adds flows.
  
  **Five newer AI tools get their step labels (objectui#7481).** A zh conversation
  read `✓ Get authoring rules 已完成` between 「读取元数据结构」 and 「列出对象」:
  `get_authoring_rules` (cloud#1837), plus `load_tools`, `open_record`,
  `test_flow` and `toggle_flow`, are registered by the cloud AI runtime but are
  newer than the pinned spec's tool registry, so they had no `chatbot.tool.*`
  entry in any pack and fell through to the English title-caser.
  
  **The assistant rail follows the thread when you send (objectui#7480).** The
  rail and the full-page maker are the same component; what differs is width. A
  reply that still ends on screen in the wide column runs two or three times
  taller in a ~360px rail, so `StickToBottom`'s lock is escaped by the time the
  user types and the new bubble, the tool steps and the streaming answer all land
  below the fold. Every send path now re-arms the lock — including the plan-card
  "Build it" and 确认修改 approvals, whose own code comments already named this
  miss. Message APPENDS deliberately do not, so a user reading back through the
  thread mid-answer is never yanked to the bottom.
  
  **Console toasts move off the assistant composer (objectui#7482).** 「客户更新
  成功」 sat on the ChatDock composer's send button and stayed there. One defect,
  two symptoms: `apps/console` pinned the toaster to `bottom-right` — an override
  that predates ADR-0057 P3a — so a toast both covered the button and, because
  sonner pauses a toast's dismiss timer while the pointer is inside the toaster
  region, never got to run its 4s timer with a pointer resting on the composer
  underneath. The override is gone; the console takes `ConsoleToaster`'s own
  documented top-right anchor, and the 4s success duration is now pinned.
  
  **Built-in aggregate captions follow the locale everywhere (objectui#7534).**
  objectui#7258 taught `buildChartSeries()` to resolve a server-minted default
  measure through the locale map, so a chart legend read `计数` while the table
  beneath it, the KPI caption, the pivot header and the dataset preview still
  printed the server's hard-coded English `Count`. `buildDatasetFieldHelpers()`
  takes the same optional `builtinAggregateLabels`, resolving through the one
  `resolveMeasureLabel` order, and the five call sites pass it. Omitting the
  argument reproduces the previous output byte for byte, and an author-declared
  measure still keeps its own label verbatim (objectui#4106).
  
  **The activity feed stops asking for an object the environment does not have
  (objectui#7476).** A tenant environment has no `sys_activity`, so every page
  load issued a request that 404'd. Everything downstream was already correct —
  the adapter memoizes the missing collection, its logger demotes the failure, the
  feed retires as an ANSWER and the panel renders its earned empty state — so what
  is left is the request itself, and `data-objectstack` states the rule for it:
  the cure for a doomed request is not issuing it. New `useObjectPresence` reads
  the object registry the shell loads for the nav anyway; only a registry that has
  ANSWERED and lists other objects without this one skips the read. Every
  uncertainty — no provider, empty registry, still loading, errored — reads as
  before, because a wrong skip would cost a real deployment its feed.
- 95bad12: feat(plugin-chatbot)!: `useObjectChat` drops the never-honoured `maxToolRoundtrips` option (objectui#5605)
  
  **BREAKING (authoring).** `UseObjectChatOptions.maxToolRoundtrips` is removed, so a host
  that passes it to `useObjectChat` no longer type-checks. The three chat registrations
  (`chatbot`, `chatbot-enhanced`, `chatbot-floating`) no longer forward the key, and the
  one-time console notice that authoring it used to log is gone. The authored key is now
  refused by name in `@object-ui/types` (see that package's entry). The notice's reset
  helper was never exported from the package entry, so no other export moves.
  
  **Migration:** remove `maxToolRoundtrips`; cap tool loops on the agent
  (`planning.maxIterations`).
  
  The option never capped anything. The hook gives `useChat` no client tool loop, so every
  tool round-trip of a turn runs on the server agent inside one streamed response, and the
  value reached neither `useChat` nor the request body.
  
  The stage-one deprecation (`.changeset/max-tool-roundtrips-deprecate-5605.md`) never
  shipped: that changeset is still pending, and no `CHANGELOG.md` in this repository
  mentions the key's deprecation.
- 52a43de: `ChatbotSchema` names the `chatbot` node's local-display and legacy
  auto-response keys — a new, additive published surface (objectui#6169, the
  #6172 family ruling: every component node has exactly one named, importable
  authoring-face type).
  
  `ChatbotSchema` (`@object-ui/types`) now declares ten keys that previously
  existed ONLY inside an anonymous inline intersection local to
  `packages/plugin-chatbot/src/renderer.tsx`'s `chatbot` registration, invisible
  to anything outside that one file:
  
  - `showTimestamp`, `userAvatarUrl`, `userAvatarFallback`, `assistantAvatarUrl`,
    `assistantAvatarFallback`, `maxHeight` — display fields.
  - `autoResponse`, `autoResponseText`, `autoResponseDelay` — the local
    auto-response (demo/playground) fields, already live via a real consumer
    (`packages/app-shell/src/console/ai/AiChatPage.tsx`).
  - `onSend` — the send-callback, now typed on the published authoring face
    rather than against the plugin's internal runtime message type. Its
    `messages` element is the authoring `ChatMessage` widened by the three
    runtime-only approval states a chat runtime hands back (objectui#10018).
  
  Each was read-site-censused before being declared (renderer.tsx and/or
  `useObjectChat.ts` reads every one); none were dead, so none took the
  ADR-0049 retirement route. `disabled` — also present in the original
  intersection — is NOT redeclared: it is already `BaseSchema.disabled`
  (`boolean | string`), read generically for every node type, and redeclaring
  it here would have narrowed away the inherited expression-string case.
  
  **What an external consumer can now do that they could not before:** import
  `ChatbotSchema` from `@object-ui/types` and get these ten keys with real,
  checked types — previously any reference to them required either duplicating
  the anonymous type by hand or falling back to `any`. The Zod mirror
  (`@object-ui/types/zod`) gained the same ten keys in lockstep, so a `chatbot`
  node parsed through it is now validated on these keys rather than silently
  passed through unchecked (`BaseSchema`'s Zod mirror is `.passthrough()`).
  
  `packages/plugin-chatbot`'s `chatbot` registration (`renderer.tsx`) now types
  its `schema` prop as `ChatbotSchema` directly, dropping the anonymous
  intersection. No behavior change: `renderer.tsx:87`'s
  `body: schema.requestBody` forwarding — the subject of the already-merged
  #6193 — is untouched, and the render function reads the exact same keys it
  already read.
  
  This is additive (new optional keys on an interface that already carried a
  `[key: string]: any` index signature, and a new Zod-validated subset of
  previously-passthrough keys), so it ships as `minor` even though it changes
  published type surface: objectui's major is pinned to `@objectstack`'s
  (`scripts/check-changeset-no-major.mjs`), and objectui's own breaking changes
  ship as `minor` with the break spelled out — there is no break here to spell
  out, only a widening from anonymous-and-unchecked to named-and-validated.
  
  Out of scope, deliberately: the `chatbot-enhanced` and `chatbot-floating`
  registrations' own anonymous intersections (different key sets, a decision
  for a separate card in the same family), and the `surface` row on
  `content/docs/plugins/plugin-chatbot.mdx`'s Properties table, which names a
  key no registration in this package currently reads (filed separately).
- 7d8e546: `surface` becomes authorable on the `chatbot-enhanced` node, so the capability the docs
  have been documenting is one an author can actually reach (objectui#6687, maintainer
  ruling 2026-08-29).
  
  `content/docs/plugins/plugin-chatbot.mdx`'s `Properties` table listed `surface`
  (`'card' | 'plain'`, "bordered panel or a frameless full-page workspace"), but the key had
  **zero read points**: none of the three `ComponentRegistry.register('chatbot*', ...)` sites
  in `renderer.tsx` forwarded it, and `ChatbotSchema` did not declare it. `surface` was real
  only as a prop of the React component — `ChatbotEnhanced.tsx` defines `ChatbotSurface`,
  defaults it to `'card'`, and branches six layout decisions off `isPlainSurface` — so it was
  reachable by a hand-written React host and by nobody writing metadata. An author who wrote
  `surface: 'plain'` got the `'card'` default, with no error and no signal.
  
  Measured on both declaration faces before the fix, each with a control that had to hit:
  `schema.surface` appeared 0 times in `renderer.tsx` against `schema.placeholder` at 3 (one
  per registration) and `schema.processVisibility` at 1; and `ChatbotSchema`
  (`packages/types/src/complex.ts`) declared 34 keys, not this one. Two faces agreeing is
  what made the zero a reading rather than a bad query.
  
  The ruling adopted **wiring it** over deleting the row — the row names a real, shipped
  capability, and hiding it back inside the component would withdraw it from authors. It also
  matches this page's two existing resolutions of the same defect class, neither of which
  deleted a row: `requestBody` (objectui#6193) kept its row and documented the seam, and
  `maxToolRoundtrips` (objectui#5605) kept its row, marked it inert, and warns once at runtime.
  
  - `chatbot-enhanced` declares `surface?: ChatbotSurface` on its inline schema-extension
    type and forwards `schema.surface` to `<ChatbotEnhanced>`. The union is **imported** from
    `ChatbotEnhanced.tsx` rather than re-spelled, so there is one contract rather than two
    dialects that can drift (AGENTS.md #0.1).
  - The key joins the registration's `inputs` (designer + autocomplete surface) with
    `defaultValue: 'card'`, and deliberately **not** its `defaultProps` — mirroring
    `processVisibility`, so nothing materializes the key onto new nodes.
  - **The absent case is unchanged**: an unauthored `surface` is forwarded as `undefined`, so
    `<ChatbotEnhanced>`'s own `surface = 'card'` default still applies. This is pinned as
    hard as the authored direction, because it is what a careless
    `schema.surface ?? 'plain'` or a `defaultProps` entry would silently regress for every
    existing document.
  - `chatbot` and `chatbot-floating` do **not** gain the key: they render `<Chatbot>` and
    `<FloatingChatbot>`, which have no such chrome to switch. The docs row is therefore
    scoped to say the key applies to the enhanced registration — the table never again claims
    more than the registrations deliver.
  
  `renderer.surface.test.tsx` pins all of it through the real SDUI host rather than a bare
  component render, and asserts the rendered chrome rather than the forwarded prop, so a
  regression where the key is forwarded but no longer acted on is still red.
  
  ⚠️ **Dated note, 2026-09-27 — `maxToolRoundtrips` no longer keeps its row — objectui#5605.**
  Later in this same release `maxToolRoundtrips` is retired behind a tombstone: its props-table
  row is gone, it no longer warns at runtime, and authoring it on any chat node is refused by
  name with the agent's `planning.maxIterations` as the remedy. The sentence above that says it
  "kept its row, marked it inert, and warns once at runtime" is kept as the reading of this
  change; the objectui#5605 retirement entry states what an author gets now.
- d3499b3: `chatbot-floating` now fences its `<FloatingChatbot>` spread the same way its
  two sibling registrations (`chatbot`, `chatbot-enhanced`) already do —
  `{...toDomProps(props)}`, at the head of the element, instead of a raw
  `{...props}` spread at the end. This is a deliberate,
  user-visible behavior change, not a refactor:
  
  - **A message sent through a floating chatbot now actually renders.**
    Previously the authored `messages` seed (whatever array was on the node
    when it was authored) silently overrode the live runtime messages on every
    render, because the raw spread landed AFTER `messages={runtimeMessages}`.
    Neither the user's own message nor an `autoResponse` reply ever appeared —
    the identical send on `chatbot-enhanced` worked correctly. Fixed.
  - **`displayMode`, `systemPrompt` and `model` stop leaking as DOM attributes**
    on the panel's root element (`systemPrompt` / `model` are still read
    normally, by name, for the request they configure — only the second,
    unfiltered forward is gone). Closes objectui#4425's leak class on the one
    `plugin-chatbot` registration that had not closed it yet.
  - **Three undeclared keys go dark on `chatbot-floating` nodes:**
    `processVisibility`, `surface` and `showAvatars` reached the panel's
    `ChatbotEnhanced` through the raw spread even though `ChatbotFloatingSchema`
    never declared them. `ChatbotFloatingSchema` documents this explicitly and
    always has — the face never promised these keys — so this closes an
    accidental channel rather than removing declared behavior. A document that
    relied on any of the three to affect a floating node loses that effect;
    author them on a `chatbot-enhanced` node instead, where they are part of
    the declared, tested contract.
  
  `@object-ui/types`: `ChatbotFloatingSchema`'s doc comment is updated to match
  — no type-shape change, so nothing that imports the type needs to change.
- 0ea7054: Remove 37 runtime dependencies that no file in the declaring package consumes, and gate
  the direction so the next one cannot land (objectui#8198).
  
  `check:phantom-deps` judges imports that are not declared; nothing judged the reverse,
  so a declaration could outlive its last consumer indefinitely. That is what happened to
  `recharts` in `@object-ui/components` after objectui#7397 deleted its only importer — it
  was removed by hand on objectui#7625, and nothing would have reported the next one. The
  new `pnpm check:unused-deps` asks the reverse question over `dependencies` and
  `optionalDependencies` of every released package.
  
  **Potentially breaking, for consumers relying on hoisting.** Nothing these packages ship
  changes: their Vite `external` predicates are path-based and never read `dependencies`,
  so no built artifact moves. What changes is the install graph — a project that imports
  one of the removed packages while depending only on the ObjectUI package that used to
  drag it in will no longer resolve it. Declare it directly; that is the correct
  dependency edge in either case. The removals, by package:
  
  - `@object-ui/plugin-designer`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@object-ui/fields`
  - `@object-ui/plugin-chatbot`: `react-markdown`, `react-syntax-highlighter`, `remark-gfm` (and the orphaned `@types/react-syntax-highlighter`)
  - `@object-ui/plugin-report`: `@object-ui/plugin-grid`, `clsx`, `react-i18next`, `tailwind-merge`
  - `@object-ui/plugin-map`: `@objectstack/spec`, `lucide-react`, `zod`
  - `@object-ui/runner`: `class-variance-authority`, `clsx`, `tailwind-merge`
  - `@object-ui/core`: `lodash`, `zod`
  - `@object-ui/layout`: `clsx`, `tailwind-merge`, and `react-dom` — which it pinned at an exact version in `dependencies` while also declaring it as a peer range, i.e. a library hard-depending on the renderer it asks its host to supply
  - `@object-ui/plugin-dashboard`: `clsx`, `tailwind-merge`, and the same `react-dom` defect
  - `@object-ui/plugin-ai`: `@object-ui/react`, `clsx`, `tailwind-merge`
  - `@object-ui/fields`: `clsx`, `tailwind-merge`
  - `@object-ui/console`: `@object-ui/react-runtime`, `sucrase`
  - `@object-ui/auth`: `@object-ui/types`
  - `@object-ui/plugin-calendar`: `@object-ui/fields`
  - `@object-ui/plugin-editor`, `@object-ui/plugin-markdown`: `@object-ui/react`
  - `@object-ui/react`: `react-hook-form`
  
  Every one was verified by a whole-package grep before removal — the name appeared nowhere
  under the package but its own manifest and CHANGELOG — and the whole workspace builds,
  type-checks and tests green afterwards.
- 411a132: `uiMessagesToChatMessages` / `uiMessageToChatMessage` now accept `@ai-sdk/react`'s
  `UIMessage[]` — the exact input the exported mappers are documented for
  (objectui#8214).
  
  **Not breaking.** The parameter type only got looser: every argument that compiled
  before still compiles. `minor` rather than `patch` because a published signature
  accepts input it refused before, which is a capability a consumer can newly rely on.
  
  `mapMessages.ts`'s local `AnyPart` is written to absorb whatever a producer hands the
  mapper — every other member is `string` / `unknown` — but `state` was typed against the
  OUTPUT contract (`ChatToolInvocation['state']`, the tool-invocation lifecycle). The AI
  SDK's own text and reasoning parts carry `state: 'streaming' | 'done'`, which is not in
  that union, so the deliberately-permissive input interface was on that one property
  STRICTER than the union it exists to absorb and the whole `UIMessage[]` assignment was
  refused (TS2345). An app that followed the README and drove `useChat()` itself had to
  add an `as never` / `as any` of its own, permanently disabling checking on that seam.
  
  `AnyPart.state` is now `string`, and the one read site narrows through an `isToolState`
  guard whose table is a `Record` over `ChatToolInvocation['state']` — so the output stays
  exactly as checked as before, and the table cannot drift from the union it guards.
  
  Small behaviour fix that falls out of the guard: a part carrying an unrecognized state
  string (an AI SDK v4 snapshot's `'result'`, say) used to pass through verbatim into
  `ChatToolInvocation.state`, fall past every branch in `getToolState`, and render a
  finished call as "Running" forever. It now normalizes to `undefined`, which is the
  documented "infer from `errorText` / `result`" case.
- 69a6fc1: feat(plugin-chatbot): `ChatbotEnhanced` takes an optional `surfaceContextTitle`, the tooltip of the surface-context chip
  
  The chip that `surfaceContextLabel` renders above the composer now accepts an
  optional `surfaceContextTitle`, rendered as the chip's `title`. A host can show
  a readable label on the chip and keep an internal identifier reachable on hover.
  The prop is additive: a caller that does not pass it renders the chip exactly
  as before, with no `title`.
- 4dbab84: Build the chat runtime's discriminated tool parts at the PRODUCER, and delete the last
  `as any` on the `useChat` call (objectui#8426; director seat, decision batch #86,
  2026-09-08, option A — contract-first).
  
  `useObjectChat`'s API-mode builder declared its part array as
  `Array<Record<string, unknown>>` and pushed plain objects into it. That is not the
  store's part union, and the mismatch was absorbed by a cast on the `messages` option
  rather than reported. Measured 2x2 on this branch, each leg mutated on disk with hash
  proof: with both that cast and the blanket one objectui#8378 removed gone, both
  type-check programs turn red with one `TS2322` each — `Record<string, unknown>` is not
  assignable to the store's part type. The builder now CONSTRUCTS each part, so the
  option is checked and the cast is gone.
  
  **Breaking, deliberately — `UseObjectChatOptions.initialMessages`.** A message's
  optional `parts` member is now declared as the store's own part array instead of
  `Array<Record<string, unknown>>`. Nothing in this repository sets it (the schema
  renderer passes `schema.messages`; app-shell passes the output of
  `hydratedMessagesToChatMessages`, whose literal declares no `parts`), so this is
  visible only to a host that hands `useObjectChat` pre-built parts — which is exactly
  the population the cast was hiding the mismatch from. Per this repo's version policy a
  breaking change ships as `minor`; migration is to build real parts (or drop `parts` and
  let the builder synthesize them from `content` / `toolInvocations`).
  
  Three behaviour changes ride with it, each measured rather than assumed:
  
  - **The three approval states are now reachable.** `approval-requested`,
    `approval-responded` and `output-denied` require the runtime's `approval` envelope
    alongside them; `ChatToolInvocation` gained that envelope in objectui#9229, and the
    builder now constructs those arms from it. Before this, such an invocation was
    emitted as an untyped object the store could not hold.
  - **The legacy authoring states are folded, not passed through.** `partial-call`,
    `call` and `result` are not runtime states; passing them through left the round-trip
    reader refusing them, so the invocation came back with no state at all. They now fold
    onto `input-streaming` / `input-available` / `output-available`.
  - **The dead `toolName` member is no longer written onto a `tool-*` part.** Only the
    dynamic-tool arm declares one, and the round-trip reader derives the name off the
    part's `type`, so dropping it is behaviour-preserving.
  
  An invocation that claims an approval state with no envelope to back it is not
  constructible, and no envelope is invented for it: the state is derived from the data
  the invocation does carry and the producer is told once, by name. An ObjectStack HITL
  approval (`pendingActionId` plus a `pending_approval` result) is deliberately NOT
  reported — it is carried by that id, and the mapper re-promotes the state from the
  result on the way back out.
  
  Also lifts the `approval` envelope in `mapMessages`' tool-invocation extraction, which
  closes the disagreement objectui#9229 left behind: the hydrated path carried the
  envelope while the live path dropped it. The lift lands in the same round as its first
  reader, rather than earlier as a declared-but-unread key.
- 3a43a15: `ChatToolInvocation` gains an optional `approval` envelope, and the Console's
  hydration mapper stops dropping it — together with `pendingActionId`
  (objectui#8442).
  
  Three AI SDK `state` values — `approval-requested`, `approval-responded` and
  `output-denied` — are states the SDK's own tool-part union cannot express
  WITHOUT an `{ id, approved?, reason?, isAutomatic?, signature? }` envelope.
  `hydratedMessagesToChatMessages` built each invocation
  from six fields and neither the envelope nor `pendingActionId` was one of them,
  so a rehydrated pending approval arrived carrying a state that says "a human must
  decide" and nothing a decision could be made with: `useHitlInChat` keys its index
  on `pendingActionId` and skips any invocation without one.
  
  The two halves arrive from different places and are lifted separately. The SDK
  envelope is persisted ON THE PART and is narrowed to its declared shape rather
  than cast (an `approval` with no usable `id` is refused, not passed through).
  `pendingActionId` is never a part key — in rehydrated history it exists only
  inside the tool RESULT — so it is derived with `detectPendingApproval`, the same
  parse the live mapper uses, now exported from `@object-ui/plugin-chatbot` so the
  two paths cannot disagree about one envelope rather than growing a second
  dialect of it.
  
  **`minor`, on the repo's written precedent — PM ruling, overriding the `patch`
  this was drafted at.** The lane's runtime test answers no: the member is optional,
  every value that parsed before still parses, and no chip, card or affordance
  changes for data that carries no envelope. But that test is about stored data,
  and what lands here is published SURFACE — two capabilities a consumer can newly
  rely on: the `ChatToolInvocation.approval` member, and the `detectPendingApproval`
  export. `.changeset/8214-chatbot-anypart-state-widen.md` settles that case in this
  repo in those words: *"`minor` rather than `patch` because a published signature
  accepts input it refused before, which is a capability a consumer can newly rely
  on."*
  
  The sequencing argument for `patch` was that objectui#8426's `minor` + `**BREAKING**`
  carrier should not be spent early. ⛔ It does not hold, for two measured reasons.
  **First, the level was never the signal.** This repo ships a breaking change AS
  `minor`, so what distinguishes objectui#8426's half is the `**BREAKING**` carrier,
  not the number beside the package — and that carrier is untouched by this
  declaration. **Second, `.changeset/config.json` puts every package in ONE `fixed`
  group**, so the released level is the maximum across all pending changesets
  regardless of what this file says. Declaring `patch` here therefore buys no
  smaller release and no preserved signal; it only makes the changelog line
  under-describe what shipped. ⇒ the accurate declaration is the cheap one.
  
  ⛔ Nothing is narrowed here. The envelope stays optional on purpose, and this
  card does not pair it with the approval states. That narrowing — the residual
  clause of the objectui#8426 ruling — ships under its own name and its own
  BREAKING banner: objectui#10018 sheds the three approval states from the
  authoring `state` union, so an AUTHORED invocation cannot declare one at all,
  with or without an envelope. On the runtime `ChatbotEnhanced.ChatToolInvocation`
  an approval state may still arrive with no envelope — an ObjectStack
  pending-action approval is carried by `pendingActionId` instead — and the
  envelope stays optional there too.
- 270f282: Six hand-rolled em-dash placeholders now draw the shared `EmptyValue` from
  `@object-ui/components` (objectui#8504), closing the *no accessible name* half
  of the class objectui#8491 / PR #8503 opened.
  
  **The accessibility defect.** Each site built its own `<span>` holding a bare em
  dash. `EmptyValue` carries three things none of them had: a `data-slot` of
  `empty-value`, an `aria-label` resolved through the i18n label hook, and
  `select-none` / `no-underline` / `pointer-events-none`. So a screen-reader user
  reaching one of these cells heard a naked punctuation mark, while a neighbouring
  cell drawn by a type-aware renderer was announced as "No value". Two of the
  sites make the inconsistency reachable inside one surface: the metadata list
  renders column 0's placeholder *inside the row's `<Link>`*, where the
  hand-rolled span inherited the link colour and stayed selectable, and the
  dashboard record drawer sits next to renderers that already returned the shared
  component.
  
  The six: the metadata list's `defaultCell` and the Audit tab's lock column
  (`@object-ui/app-shell`), the dashboard record drawer's empty `<dd>`
  (`@object-ui/plugin-dashboard`), the import wizard's saved-mapping transform
  cell (`@object-ui/plugin-grid`), the AI-approvals `JsonBlock`
  (`@object-ui/plugin-chatbot`), and the Public Forms object column
  (`@object-ui/console`).
  
  **A deliberate visual change, not a no-op.** Five sites drop
  `text-muted-foreground` (or `/60`) for the shared `text-muted-foreground/50`, so
  every placeholder in the workspace is now one colour. The glyph is unchanged
  everywhere. The sixth, `JsonBlock`, keeps its `text-xs` through `className`
  because it stands where a `text-xs <pre>` would and has no shared neighbour to
  match — its delta is the accessible name and the three affordances only.
  
  **Two adjacent lines in the same file, taken deliberately.** The AI-approvals
  drawer's `proposed_by` / `decided_by` fields fell back to a bare `'—'` text node
  inside a plain `<div>` — a different source spelling of the same rendered
  defect, individually verified on the card rather than swept up. They are
  converted too. `formatRelative`'s `if (!s) return '—'` is not: that helper is
  declared `: string`, so its fallback is not a node.
  
  Filled values are untouched in every path.
- 6ce89da: The 确认修改 (confirm changes) card now carries a UI-owned terminal state after approval (#5695): `detectReplayOutcome` lifts the confirm-replay envelope (`replay_*` tool results) into 应用中 / 已生效 / 已暂存为草稿（含内联发布）/ 未生效（含 publishError 首行）, rendered on the original card across the live, hydration/share, and localStorage-cache converters. A failed in-turn publish no longer rehydrates as an ordinary draft card with a live Publish button — the UI-rendered refusal is the layer a model cannot narrate over. New `console.ai.changesApplying/Applied/Drafted/Failed` keys in all ten locale packs.
- 63b4e0e: Fix the three breaks at the AI paywall moment (#7253), measured on a free plan's
  second build iteration when the cloud guardrail refuses "Confirm changes" with a
  429 `AI_DESIGN_QUOTA_EXHAUSTED`.
  
  - **The upgrade CTA no longer opens a 404.** It used to open a client-composed
    `${cloudBase}/apps/cloud-control/sys_environment`, which guessed the control
    plane's console mount, app slug and route — all three wrong — and landed on
    the API's `ENDPOINT_NOT_FOUND` JSON. `cloudInstallDeepLink` /
    `cloudPricingDeepLink` are replaced by `cloudConsoleUrl()`, the
    runtime-supplied cloud origin with no path appended; the control plane's own
    root redirect decides the landing page. The former
    `|| 'https://cloud.objectos.app'` default is gone: a runtime with no upstream
    cloud now renders no upgrade link at all rather than pointing a self-hosted
    user at the vendor's SaaS.
  - **The confirm card gets an explicit failure state.** A quota refusal parks the
    card on "not applied" with the server's own next step (reset tomorrow /
    upgrade) plus the upgrade action, instead of silently rolling back to
    "Confirm / Adjust" as though the click had never happened. Transient failures
    (offline, per-minute rate limit) still roll back, because retrying is the
    right next step there.
  - **The composer is no longer refilled with an already-delivered message.**
    Only text typed into the composer is restorable now; card-driven sends
    (confirm, approve, suggestion chips) send canned text the user never typed and
    no longer leave the previous prompt staged as if it needed resending.
- b842035: `useObjectChat().setMessages` now keeps the promise its declaration makes, and the
  `chatResult as any` that was hiding the gap is gone (objectui#8342).
  
  The member is declared `(messages: unknown[]) => void` and the hook returned
  `@ai-sdk/react`'s own `setMessages`, which accepts only its `UIMessage[]`.
  Parameters are contravariant, so that assignment is unsound — `tsc` reported it as
  a TS2322 the moment the cast came off, and the declared type was telling every
  consumer they could hand over an arbitrary array when the function underneath
  could not take one. Nothing broke only because no caller had yet taken the type at
  its word; one who did got a runtime failure the compiler had blessed.
  
  The parameter stays `unknown[]`. This package does not republish the SDK's pinned
  `UIMessage` on its own surface — the same call objectui#8214 made one file over
  for `AnyPart.state`, and typing this member against the SDK would re-break it on
  the next dependency bump. Instead the hook now wraps the SDK function and checks
  every element first: an object with a string `id`, a `'user' | 'assistant' |
  'system'` role, and a `parts` array — exactly the three members `UIMessage`
  requires. `parts` is checked for array-ness only, because the part union is open
  (a `data-*` part carries an author-defined payload) and restating it is the
  coupling this change exists to avoid.
  
  **Behaviour change, and the reason this is not a patch.** A value that is not a
  chat message is now REFUSED, not filtered and not passed on: the call throws a
  `TypeError` naming the offending index, and the SDK's store is left untouched
  because the whole array is validated before anything is written. Filtering was
  rejected deliberately — this is a re-hydration path where the caller's statement
  is "the thread is now exactly these messages", so dropping the failures would
  install a shorter thread that the `void` return makes undetectable. The declared
  TYPE does not move, so nothing that compiled stops compiling; what narrows is the
  set of values a consumer can successfully pass at runtime, which is the opposite
  direction from objectui#8214's widen.
  
  `@object-ui/app-shell`'s `useReconcileOnError` is the one in-repo consumer. Its
  payload comes from `toUIMessages`, which emits exactly `id` / `role` / `parts`, so
  it passes the check unchanged; and it already calls through a `try`/`catch` that
  falls back to the ordinary error banner, so a future malformed server payload
  degrades to "show the error" rather than to a quietly-truncated transcript.
- f157423: Studio workbench and AI tool cards speak the author's language (objectui#7254)
  
  - The Interfaces breadcrumb, canvas caption and navigation rail show the
    metadata label plus a translated kind; the internal `type · name` pair moves
    to the tooltip. An unlabelled nav leaf now falls back to its object name
    instead of rendering an empty row.
  - The Studio top-bar package switcher reads the package's human name from
    either position the packages endpoint serves it in, instead of degrading a
    registry-shaped entry to its reverse-domain id.
  - The dashboard property panel is localized: the spec's authoring form is
    overlaid through the platform's own `metadataForms.<type>` convention, so
    section headings, field labels, hints and the `header` composite's sub-fields
    render in Chinese (developer vocabulary such as "Tailwind units" is replaced
    with something an author can act on, not transliterated).
  - AI tool cards: tool titles resolve through `chatbot.tool.<name>` (all thirty
    platform-provided tools, ten locale packs), the header status badge is
    localized, and the plan count strip is a real plural family instead of an
    English `+ "s"` concatenation.
  - The tool card's header badge and its body badge now come from one producer:
    a proposal that has been confirmed, built or published no longer keeps a
    header reading "Awaiting Approval".

### Patch Changes

- ac15833: fix(plugin-chatbot): a reloaded multi-step build no longer shows an empty 「执行过程」 block under every step (objectui#10899)
  
  The conversation store persists each step of an agent turn as its own assistant
  row whose only text is a `(called …)` placeholder, so a reloaded build (the
  in-app dock, the Studio copilot) hydrates into one message per step. Each one
  rendered its tool row, then the italic 执行过程 note, then the message action
  bar — invisible until hover but full height — so every step read as an empty
  block with a large gap.
  
  - The 执行过程 note is now only the fallback for a placeholder turn that shows
    nothing else. A turn whose tool row, build panel or design panel is on screen
    does not repeat it.
  - The copy / regenerate bar renders only for a turn with visible prose. A
    prose-less step has nothing to copy, and Copy used to copy the internal
    placeholder.
- 7d82957: fix(plugin-chatbot): the proposed-plan card's actions wait until no turn is in flight
  
  The proposed-plan card renders as soon as `propose_blueprint` returns, but the
  turn that proposed it keeps streaming after that, and the server stores each of
  its remaining steps as it goes. Build it, Adjust and the one-click answer chips
  were live the whole time. In a cloud E2E run the user clicked Build it inside
  that window. The next turn was sent while the previous one was still being
  stored, and the stored history interleaved the two turns.
  
  These actions are now disabled while `isLoading` is true, on the structured plan
  card and on the fallback confirm card alike. `isLoading` is the signal that
  already turns the composer's send into a stop button. The actions come back once
  the response stream has been read to its end, and the buttons carry the native
  `disabled` attribute while they wait. The gate also covers two windows that a
  message's own `streaming` flag misses: a request that is out but has no reply
  yet, and a newer turn streaming below an older plan card.
  
  Ordering replayed history by turn in the conversation store is a separate
  server-side fix.
- be66b56: fix(plugin-chatbot): the confirm-changes card's actions wait until no turn is in flight
  
  The confirm-changes card renders as soon as a tool such as `update_metadata`
  returns `changes_proposed`, but the turn that proposed the change keeps
  streaming after that. Confirm and Adjust were live the whole time, and Confirm
  sends its confirmation straight away, so a click in that window sent the next
  turn while the previous one was still in flight. The proposed-plan card's
  actions were fixed for the same overlap.
  
  Confirm and Adjust are now disabled while `isLoading` is true, the signal the
  proposed-plan card's actions already wait on. They carry the native `disabled`
  attribute while they wait and come back once no turn is in flight. Because the
  signal is not tied to the card's own message, the gate also holds an older card
  while a newer turn is in flight below it, including a request that is out with
  no reply yet.
  
  Only those two buttons change. The card's other states render as before: the
  Applying badge, the blocked state after an AI quota refusal, the Confirmed
  badge, and the reply hint shown when the host passes no `onSendMessage`.
- 39f4309: Published typings from every `vite-plugin-dts` package now carry an explicit extension on
  every relative specifier, and a type error in the declaration build now fails the build
  instead of being printed and ignored (objectui#5439, objectui#5483).
  
  **Consumers on `moduleResolution: nodenext` or `node16` may see NEW type errors, and that
  is the fix working.** These packages re-export mostly through NAMED re-exports —
  `export { useObjectChat } from './useObjectChat'`. TypeScript could not follow the
  extensionless hop, but it still DECLARED the name, so the symbol resolved to a silent
  `any`. Nothing errored; consumers simply got no types. With the extension emitted, the
  symbol carries its real type, and any call site that was relying on the `any` now type
  checks for the first time. This is the mode that produced the 21 residual `TS7006` on
  `@object-ui/app-shell` reported against objectui#5365 — a type hole that opened quietly,
  unlike objectui#5365's own `export * from './ui'` packages where the same defect surfaced
  immediately as `TS2305: has no exported member`.
  
  410 extensionless relative specifiers across 19 packages were emitted before this change;
  the count is now 0 in all 22 packages that build typings through `vite-plugin-dts`.
  `@object-ui/fields` was already clean — its sources write explicit `.js` specifiers — and
  is wired so it stays that way.
  
  The second half changes no emitted output today: 22/22 packages built green unmodified, so
  making the declaration step's exit code honest turns nothing red. It changes what a FUTURE
  regression does — print and exit 0, versus fail the build.
- 01c9023: `AiPendingActionsInbox` speaks the session locale — every string in it, not only its timestamps (objectui#7173).
  
  The AI HITL approval inbox held its own relative-time helper returning hardcoded
  English (`'just now'`, `` `${min}m ago` ``), so a zh / ja / ar session read English
  relative times on every row. It is the fifth spelling of that helper in the repo,
  and the file had **no translation wiring at all** — the unwired-component shape,
  not the lookup-swap shape.
  
  It is therefore swept whole. objectui#7142 wired one string into an otherwise
  untranslated component and shipped something visibly half-done, and objectui#7149
  is what finishing that afterwards cost; the triage ruling on this card (2026-09-01)
  carried that forward as *sweep the file whole or leave it*. Everything the user can
  read now resolves from the locale packs: the card heading and description, the three
  tabs, the refresh button, all five status badges, the six column headings, the empty
  state, the row and drawer buttons, all nine drawer field labels, the outcome banner
  and the whole reject-reason dialog.
  
  **No new rows for the four relative-time branches.** `detail.justNow`,
  `detail.minutesAgo`, `detail.hoursAgo` and `detail.daysAgo` already existed,
  translated, in all ten packs, and cross-package key borrowing is this repo's settled
  convention rather than an open question — `ObjectGrid`, `ObjectKanban`, `ObjectTree`,
  `ListView`, `ObjectView`, `NavigationOverlay`, `RecordAttachmentsPanel`,
  `RecordDetailView` and `apps/console` all resolve `detail.*` from outside
  `plugin-detail`. One phrase on one kind of control should not get a second
  translation that can drift from the first.
  
  The rest of the sweep needed copy no pack had, so `@object-ui/i18n` gains an
  `aiApprovals` namespace: 38 keys, translated in all ten packs. It is deliberately
  separate from `approvalsInbox`, which is the human approval-**process** inbox — a
  different surface and a different feature, so no rows are shared with it. Four
  generic verbs are reused rather than forked (`common.refresh`, `common.cancel`,
  `common.loading`, `common.ok`).
  
  **⛔ The five relative-time helpers are not unified.** They differ in real behaviour
  — `Math.round` here against `Math.floor` in `plugin-detail`, thresholds 45s/30d
  against 60s/7d, different tails — so normalising them is a behaviour change wearing
  a refactor's clothes and needs its own card. This inbox's arithmetic is untouched,
  and three rows in the new suite exist only to pin it: 50s renders `1m ago` (a 60s
  threshold would still say "just now"), 90s renders `2m ago` (`Math.floor` gives
  `1m ago`), and 20d renders `20d ago` (a 7d threshold would already show a date).
  
  Two assembled English sentences became single interpolated keys — the outcome banner
  (`Approve for {{id}}: {{message}}`) and the drawer subtitle
  (`Tool {{tool}} on {{object}}`). Their word order differs per locale, which fragments
  around a `<code>` element cannot express, so the two identifiers lose their monospace
  styling. That is the deliberate cost of making those sentences translatable.
  
  Evidence: an `en`-only assertion cannot discriminate here, because each key's `en`
  value is byte-identical to the literal it replaced. The suite asserts in **zh and
  ar**, and the provider-less path separately, in its own file (`createI18n` installs
  itself as react-i18next's module-level global, so a provider-less render in a file
  that has already mounted a provider silently reads that pack instead of the defaults
  map). No inline `defaultValue` anywhere (objectui#3517).
  
  Two consequences of the sweep, both landed here rather than left for CI to find:
  
  `packages/app-shell/src/console/ai/__tests__/ConversationsSidebar.test.tsx` froze its
  `vi.mock('@object-ui/i18n', ...)` factory to a hand-written object. Its import graph
  reaches `plugin-chatbot`, which now resolves `createSafeTranslation` at module scope, so
  the frozen surface made that read `undefined` and the file died during COLLECTION — the
  objectui#6849 shape, which does not look like a test failure. It now spreads
  `importOriginal()` and overrides only `useObjectTranslation`. Measured, not guessed: of
  the 41 frozen `@object-ui/i18n` factories in the repo, running every one of them showed
  this to be the only file whose graph reaches the package.
  
  The ten pack blocks are locale DATA, and locale data lands in the console's eager
  `framework` chunk, so `scripts/check-eager-closure-budget.mjs` raises that chunk's
  ceiling from 512,000 to 524,000 gzipped bytes and re-pins its baseline onto a fresh
  measurement (502,405 to 514,863). Attributed by three console builds: the merge parent
  reads 510,192, this branch with the ten `aiApprovals` blocks cut reads 510,192 again, and
  this branch reads 514,863 — so the whole 4,671-byte delta is the pack data and nothing
  else. Headroom is kept at the line's own convention (9,137 bytes, 0.10x the regression
  the gate must catch) rather than widened; most of the overage was pre-existing drift, with
  the merge parent already at 510,192 of the 512,000 allowed.
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- 3e377c9: Retire `ChatbotSchema.displayMode` — and its copy on `ChatbotFloatingSchema` — as an
  ADR-0049 retirement tombstone, and remove the `chatbot-floating` registration's
  "Display Mode" designer control and its `defaultProps.displayMode: 'floating'` seed
  (objectui#7654, maintainer ruling B of 2026-09-05, director decision batch #44).
  
  ⚠️ **BREAKING for anyone authoring `displayMode` against a chatbot face in TypeScript.**
  Ships as `minor` per the launch-window convention: objectui's `major` is a cross-repo pin
  to `@objectstack`'s so that "same major means compatible" holds across the two repos
  (`scripts/check-changeset-no-major.mjs`), and objectui's own breaking changes ship as
  `minor` with the break named where it lands — this entry is the channel that carries it.
  
  ## What was retired, and why
  
  The node `type` — `chatbot-floating` versus `chatbot` / `chatbot-enhanced` — is the one
  selector of presentation. `displayMode` (`'inline' | 'floating'`) was a second spelling
  of that same choice, and no renderer has ever read it: `chatbot-floating` renders the
  trigger and panel unconditionally, and `chatbot` never looked at the key, so
  `displayMode: 'floating'` on a `chatbot` node produced no trigger and `'inline'` on a
  `chatbot-floating` node changed nothing. It was nevertheless declared on both faces,
  painted as a **Display Mode** control in the designer's property panel, and written as
  `'floating'` into every node the designer created — two surfaces teaching a switch that
  did not exist.
  
  Re-measured on this branch's base rather than inherited from the card: a whole-repo
  `git grep` census over tracked files, build output excluded, returned the declarations,
  the doc comments and parity-ledger entries beside them, one historical CHANGELOG line and
  two unrelated `displayMode` props on `GridField` / `MasterDetailForm` — no read. The same
  pass over `floatingConfig`, a key that IS read, returned 79 lines, so the instrument was
  not blind.
  
  FROM → TO:
  
  - `ChatbotSchema.displayMode?: 'inline' | 'floating'` → **`displayMode?: never`**, an
    ADR-0049 retirement tombstone whose comment points at `type` as the replacement.
  - `ChatbotFloatingSchema.displayMode?: 'inline' | 'floating'` → **`displayMode?: never`**,
    the same tombstone. objectui#7655 declared the key on the floating face with
    `ChatbotSchema`'s own lines precisely so this retirement would find it on both faces;
    leaving the copy typed would have kept the published face teaching the switch.
  - `chatbot-floating` `inputs`: the **Display Mode** control is removed.
  - `chatbot-floating` `defaultProps`: `displayMode: 'floating'` is no longer written into
    designer-created nodes.
  
  A control is restated, never deleted into a vacuum (`5f4514f7b`): the restatement of
  the removed control is the tombstone's guidance plus this note.
  
  **Migration.** Delete `displayMode` from any TypeScript literal typed as `ChatbotSchema`
  or `ChatbotFloatingSchema`; the presentation you wanted is already chosen by `type` —
  `'chatbot-floating'` for the trigger-and-panel, `'chatbot'` / `'chatbot-enhanced'` for
  inline. **No JSON document needs editing** — see the next section.
  
  ## Stored documents: runtime validation of this key is unchanged — zero before, zero after
  
  `displayMode` has never had a Zod arm — it sits in the `UnmirroredDeclared` ledger for
  both `complex.zod.ts#ChatbotSchema` and `#ChatbotFloatingSchema`, and `BaseSchema` is
  `.passthrough()` — so a stored document carrying `displayMode: 'floating'` (every node
  the designer ever created) parses green before this change and parses green after it,
  and the value is dropped at render time exactly as it always was.
  
  That is deliberate, and it is why this tombstone has **no `retirementTombstone()`
  half**: minting a mirror arm to refuse the key would be the declared-but-unmirrored axis
  (objectui#6152), a different defect, and a parse outcome the ruling did not ask for.
  `packages/types/src/__tests__/chatbot-display-mode-retired.test.ts` pins both twins'
  shapes as a **tripwire** — the same shape `a3eb5d07a` gave `triggerIcon` — so that if
  objectui#6152 ever mints an arm for `displayMode`, the pin goes red and whoever lands the
  mirror adds the `retirementTombstone()` half at that time, flipping the control rather
  than deleting it.
  
  ## Why a tombstone and not a deletion — measured on this carrier
  
  `ChatbotSchema` extends `BaseSchema`, which carries a `[key: string]: any` index
  signature, and on such a carrier deleting an optional member is **silent in every value
  shape**: the index signature defeats both excess-property checking and the weak-type
  check. Measured on this member with `tsc -p tsconfig.test.json`, a no-index-signature
  control carrier (`FloatingChatbotConfig`) lit in the same run:
  
  | route | fresh `'floating'` | fresh `'bogus'` | widened `'floating'` |
  |---|---|---|---|
  | declared (before) | clean | `TS2322` | clean |
  | deleted | clean | **clean** | clean |
  | tombstoned (after) | `TS2322` | `TS2322` | `TS2322` |
  
  Deleted, the member reads as `any` and even a wrong-typed value goes quiet. Tombstoned,
  **presence with any value** is a compile error — a channel deletion cannot produce on
  this carrier at all. On a `BaseSchema` carrier the two routes are loud-vs-silent, not
  louder-vs-quieter (the discriminator's carrier branch in its amended form, `5f8190c8c`).
  Prong 2 of that discriminator licenses the tombstone: the key was advertised in the
  3.3.0 release record (`CHANGELOG.md:578`) and its published comment taught it as the
  presentation switch. The deleted row is pinned in the test file as a live control — an
  undeclared key that rides both shapes with no directive — so the contrast cannot rot.
  
  ## Accept-set change, one line per face
  
  - **TypeScript.** A write of `displayMode` against either chatbot face used to compile
    and now does not.
  - **Runtime (Zod / `safeValidateSchema`).** Nothing changes at all — a stored document
    carrying the key parses green before and after, and keeps the value.
  - **Designer.** The **Display Mode** control disappears from the `chatbot-floating`
    property panel, and newly created nodes no longer carry the key.
  - **Manifest, author-time validator, and generated JSX props.** The `chatbot-floating`
    registration's `inputs` go from 20 entries to 19 and its `defaultProps` from 9 keys to
    8, so the manifest projected from them no longer lists the prop. Measured on both sides
    of this change: `validateTree` on a stored `chatbot-floating` node carrying
    `displayMode` goes from **0 diagnostics to exactly 1** — code `unknown-prop`, severity
    **`warning`**, message `` `<chatbot-floating> has no prop "displayMode"` `` — which is
    what the JSX/HTML authoring tier reports through `compile()`. In the same pair of runs
    the props interface `generateDts` derives from those same `inputs` drops from 20 members
    to 19, losing its `displayMode?: string` line, so a `.tsx` page written against those
    generated intrinsics no longer type-checks the attribute.
  
    **This is author-time only: no stored document stops parsing and nothing at render
    moves.** The value survives compilation — `compile()` returns a tree still carrying
    `displayMode: 'floating'`, byte-for-byte the same keys before and after — and a
    `warning` never blocks a page, because the page renderer filters the diagnostics to
    `severity === 'error'` before deciding whether to fail. Two neighbouring instruments are
    untouched and worth naming so the scope is not read wider than it is: `os validate` runs
    `safeValidateSchema`, the Zod path, and is silent on this key before and after; and the
    build-time `sdui-intrinsics.d.ts` artifact is generated from the PUBLIC tier, which does
    not contain `chatbot-floating` on either side of this change.
- 4ce14f1: One named, importable authoring-face type per `plugin-chatbot` registration:
  `ChatbotEnhancedSchema` and `ChatbotFloatingSchema` join `ChatbotSchema`
  (objectui#7655, under the objectui#6169 / #6172 family ruling — every component
  node has exactly one named, importable authoring-face type).
  
  `packages/plugin-chatbot` registers three components — `chatbot`,
  `chatbot-enhanced`, `chatbot-floating` — and `@object-ui/types` published ONE
  face for the family with `type` pinned to `'chatbot'`. An author annotating a
  `chatbot-enhanced` or `chatbot-floating` node either dropped to untyped JSON or
  annotated with `ChatbotSchema` and lied about `type`; the docs' floating example
  had to be a `json` fence because no `tsx` fence could compile. The two
  registrations' real key sets lived in anonymous `ChatbotSchema & { ... }`
  intersections local to the renderer, referenceable by nothing outside that file.
  
  ## The shape, and why not the smaller diff
  
  One interface per registration, not `ChatbotSchema['type']` widened to the union
  of the three keys. The union would give three nodes ONE type and re-open what
  #6169 closed — a single interface declaring keys only some of its own `type`
  values read — and this card exists because the family's declarations had already
  drifted from its reads. Each face declares what ITS registration reads, censused
  per key on the PR's base (one `schema.KEY` read per registration body in
  `renderer.tsx`, lit by keys that are NOT shared: `processVisibility` 0 / 1 / 0,
  `floatingConfig` 0 / 0 / 1), and the twenty keys all three read are picked off
  `ChatbotSchema` by name (`ChatbotSharedKey`) so they stay one declaration:
  
  - **`ChatbotEnhancedSchema`** (`type: 'chatbot-enhanced'`): the shared twenty,
    plus `maxHeight` and `processVisibility` (read here, not by the floating
    panel), plus `enableMarkdown`, `enableFileUpload`, `surface` (`'card' |
    'plain'`, objectui#6687) and the `onClear` runtime slot — four keys
    `ChatbotSchema` never declared.
  - **`ChatbotFloatingSchema`** (`type: 'chatbot-floating'`): the shared twenty,
    plus `enableMarkdown`, `enableFileUpload`, `onClear`, and the two keys it
    declares alongside `ChatbotSchema` — `floatingConfig` (`FloatingChatbotConfig`)
    and `displayMode`. No `maxHeight`, `processVisibility` or `surface`: the
    floating registration has no named read for any of them. (At this change its
    trailing raw props spread still carried authored keys into the panel —
    `processVisibility`, `surface` and `showAvatars` were live there, measured
    through the real host — and this face neither declared nor promised that
    accidental channel, which was tracked on a card of its own. That card has since
    fenced the spread (`d3499b315`) the way the two sibling registrations do, so those three keys
    are dark on `chatbot-floating` now; no member this face declares depended on
    the channel.)
  - Neither face declares `ChatbotSchema`'s six legacy members (`loading`,
    `showAvatars`, `userAvatar`, `assistantAvatar`, `markdown`, `height`) — no
    registration reads them by name — and neither redeclares `disabled`, which
    stays `BaseSchema`'s `boolean | string` (`c93b4d5f3`).
  
  **`ChatbotSchema` is unchanged.** It keeps `displayMode` and `floatingConfig`
  (declarations verbatim), and the floating face declares the same two, so
  `ChatbotSchema['displayMode']` and `ChatbotSchema['floatingConfig']` stay the
  typed members they were — the `a3eb5d07a` `triggerIcon` tombstone keeps its
  reach on `chatbot` nodes, now pinned on the node. `floatingConfig`'s doc comment
  is rewritten on both faces: the old text said it was "only used when
  `displayMode` is `'floating'`", which was false — it is read by `chatbot-floating`
  alone and forwarded to the panel. `displayMode` is RULED RETIRED — objectui#7654,
  maintainer ruling B (2026-09-05): `?: never` tombstone, designer control and
  `defaultProps` seed removed, in that card's own change. This change carries the
  key untouched on both faces (still unmirrored, still read by nothing) so that PR
  finds the member exactly as ruled, and a tripwire test pins that any value still
  parses green until that PR flips it.
  
  **New published symbol:** `ChatbotSharedKey`, the string-literal union of the
  twenty keys all three registrations read. It is exported from `complex.ts`
  because an exported interface may not extend a `Pick` over a private name
  (TS4022), so it is emitted into `dist/complex.d.ts` and is reachable through the
  published `@object-ui/types/complex` subpath (it is not re-exported from the
  package entry). It is a census, not an authoring face.
  
  ## Zod twins, in lockstep
  
  `@object-ui/types/zod` gains `ChatbotEnhancedSchema` and `ChatbotFloatingSchema`
  (and `ComplexSchema` routes the two new discriminants). Every declared key is an
  arm except: the three runtime slots (`onError`, `onSend`, `onClear`), refused by
  name per objectui#6124; and, on the floating twin only, `floatingConfig` (no
  `FloatingChatbotConfig` mirror exists — minting one is objectui#6152's axis) and
  `displayMode` (unmirrored on `ChatbotSchema`'s twin too; retired by ruling on
  objectui#7654 and executed there). The twins mirror the API body params under the
  key the renderer reads, `requestBody`, and inherit `body` as the children slot —
  they do not copy `ChatbotSchema`'s `body` naming collision.
  
  **Accept-set change, stated plainly:** a `chatbot-enhanced` or `chatbot-floating`
  document parsed through the family's only twin used to fail on `type`; through
  its own twin it now parses, and the keys the twin declares are VALIDATED where
  they rode through `.passthrough()` unexamined before (`surface: 'frameless'`,
  `enableMarkdown: 'yes'` and `requestBody: 'x'` are refused). A `chatbot` node's
  parse outcome is unchanged: `ChatbotSchema`'s twin did not move.
  
  ## `@object-ui/plugin-chatbot`
  
  The `chatbot-enhanced` and `chatbot-floating` registrations type `schema` as the
  published faces and drop the anonymous intersections. One consequence:
  `chatbot-floating` used to write `disabled={schema.disabled}` and then spread
  `{...props}` AFTER it — and `SchemaRenderer` always includes `disabled: verdict
  || undefined` in those props, so the raw read was overridden on every render.
  With `disabled` honestly typed as `boolean | string` the raw union cannot be
  forwarded into the panel's `boolean` prop, so the registration now names the
  host verdict (`disabled: hostDisabled`) the way its two siblings have since
  objectui#4431. No render outcome moves; the pin renders through the real host
  both ways.
  
  This ships as `minor` for `@object-ui/types` because it widens the published
  surface with two new node types, two new Zod twins and one new type alias;
  `ChatbotSchema`'s own accept set does not move: objectui's major is pinned to `@objectstack`'s
  (`scripts/check-changeset-no-major.mjs`), and objectui's own contract changes
  ship as `minor` with the semantics spelled out — as above.
  
  ⚠️ **Dated note, 2026-09-27 — the shared census is nineteen keys, not twenty — objectui#5605.**
  Later in this same release `maxToolRoundtrips` is retired behind a tombstone: no
  registration reads it, so it leaves `ChatbotSharedKey`, and `ChatbotSchema` declares it
  instead as a `?: never` member that the other two faces pick by name, refused by name on
  the zod twins. The "twenty keys" above is kept as the reading of this change; the
  objectui#5605 retirement entry states what the three faces declare now.
  
  **Correction, 2026-09-30 (objectui#6152, round 4).** The "Zod twins" section above says the floating twin leaves `floatingConfig` unmirrored because no `FloatingChatbotConfig` mirror exists. That was true when this change was written, and it no longer is: objectui#6152 round 4 minted that mirror and declared `floatingConfig` on the `chatbot-floating` twin, judged member by member. The same round declared `requestBody` on `ChatbotSchema`'s twin, so all three chatbot twins now share one `requestBody` arm. `displayMode` stays unmirrored on both twins, as this entry says.
  
  **Correction, 2026-10-01 (objectui#6152, round 5).** The section above says `ChatbotSchema` keeps `floatingConfig` as a typed member, so the `triggerIcon` tombstone reaches `chatbot` nodes. That is no longer true: objectui#6152 round 5 retired `ChatbotSchema.floatingConfig` on both faces, because the `chatbot` registration never read it. The member is a `?: never` tombstone on the TypeScript face and a named refusal on the zod twin, so a `chatbot` node refuses the whole key. `ChatbotFloatingSchema.floatingConfig` is unchanged; it never inherited the base member.
- e627724: Merge an authored `className` into the floating chat panel instead of replacing it
  (objectui#8078).
  
  `<FloatingChatbot>` ended its `<ChatbotEnhanced>` element with a bare
  `className="h-full border-0 rounded-none"` literal written **after**
  `{...chatbotProps}`. A later JSX prop always wins over an earlier spread, so the
  `className` a `chatbot-floating` node authored — correctly forwarded the whole way,
  since the registration destructures it as its own named prop — was silently
  replaced. It type-checked, it parsed, and it did nothing to the rendered panel:
  the styling escape hatch AGENTS.md #3 requires every widget to expose
  (*"Always expose `className` in schema props so users can override via JSON"*),
  exposed and inert. Every sibling in this package already merges through `cn()`.
  
  The three classes are now the panel's **default** fit rather than its property:
  `cn("h-full border-0 rounded-none", chatbotProps.className)`. This repo's `cn` is
  `twMerge(clsx(...))`, so the last conflicting utility wins — an author who declares
  `rounded-xl` or `border-2` on a floating node now gets it, while an author who
  declares nothing about size still gets the borderless, square, container-filling
  inner surface the surrounding panel chrome expects. A node that authors no
  `className` renders exactly the class list it rendered before; that control is
  pinned beside the fix.
  
  `maxHeight="100%"`, two lines up, has the identical shape and is **deliberately
  kept forced** rather than merged — a ruling, recorded in a comment at the line.
  `ChatbotFloatingSchema` does not declare `maxHeight` and the `chatbot-floating`
  registration forwards none (that authoring face says the key is "NOT declared, on
  purpose", for this very reason), so nothing authored is dropped there, while
  `<ChatbotEnhanced>`'s own `'500px'` default would cap the conversation well inside
  a panel that can be 800px tall — or the whole viewport in fullscreen.
  
  The card recorded that it had measured the defect statically and "not yet confirmed
  through a live render". The pin added here is that render: a `chatbot-floating` node
  mounted through the real SDUI host, asserting on the rendered panel's own class list
  — red before the fix, green after, with the panel's own `h-full` still present beside
  the authored classes.
- e5a28b9: A confirm-gate preview no longer counts as the commit that settles the card before it
  (objectui#8343).
  
  `builtPlanIds` decided a proposed plan had been built from the tool NAME alone —
  `tool.toolName === 'apply_blueprint'`. On an iteration turn where the user did not say
  the magic phrase ("直接搭建" / "just build it"), `apply_blueprint` hits its own
  confirm gate and returns `{status:'awaiting_confirmation'}`: it built nothing and is
  itself waiting for the user. That still marked the earlier `propose_blueprint` card
  已搭建, collapsing its "Build it" button into an inert badge — and the
  `apply_blueprint` card carries no button of its own, so the turn was left with **no
  confirm affordance at all** while the assistant's prose asked the user to confirm one.
  The only way forward was guessing "确认" into the composer.
  
  A build now only counts when the invocation is not a confirm-gate preview
  (`!isProposalResult(tool.result)`) — the same fact the tool header already reads to say
  "Awaiting Approval". A still-running `apply_blueprint` (no result yet) keeps counting,
  so the objectui#432 guard against re-triggering an in-flight build is unchanged.
  
  The sibling `confirmedChangeIds` memo carried the same defect one level down: it
  inferred "this later call committed" from the ABSENCE of a rich `proposedChanges` card,
  and that detector additionally requires ≥1 parseable change row — so a later same-tool
  call that WAS a preview but produced no card (an empty `changes: []`) silently settled
  the pending 确认修改 card. It now reads the preview fact directly too.
- bddf1cf: Fold an authored `role: 'tool'` before it seeds the AI SDK store, instead of asserting
  it away (objectui#8443).
  
  `useObjectChat`'s `aiInitialMessages` builder wrote `as 'user' | 'assistant' | 'system'`
  over the role at both of its arms. The authoring contract accepts `role: 'tool'`,
  `normalizeMessages` deliberately does not narrow it, and `renderer.tsx` passes
  `schema.messages` straight through as `initialMessages` — so in API mode the store was
  seeded with a value outside its own union, declared as one of three roles it was not.
  
  Measured against the real `@ai-sdk/react` 4.0.68 / `ai` 7.0.65 before the change: the
  client store holds the out-of-union role verbatim — nothing recognises it, nothing
  renders it distinctly — and the SDK's own downstream entry points then reject it.
  `convertToModelMessages` throws `AI_MessageConversionError: Unsupported role: tool`, and
  `validateUIMessages` throws `AI_TypeValidationError` naming `["system","user","assistant"]`
  at `[0].role`. Both legs were read with an in-union control on the identical shape, which
  converted and validated cleanly.
  
  Both arms now call `toRuntimeRole(...)` — the package's single expression of this fold
  and the named decision of objectui#4399, the same one the render seam already applies:
  `'tool'` renders as an assistant bubble. **Behaviour change on the API-mode leg**: an
  authored `'tool'` message now seeds the store as `'assistant'` rather than `'tool'`. Its
  content, parts and tool invocations are untouched, and the other three roles are
  unchanged — `'system'` in particular keeps its own role and its centred pill.
  
  Local mode is deliberately unaffected: an authored `'tool'` role still reaches the hook's
  own `messages` surface unchanged and is folded only at the render seam, which is what
  `ObjectChatMessage` is a statement about.
  
  Deleting the assertions also re-arms the compile-time tripwire the seam was built to
  provide — `chatMessageAdapter.ts` records that "a new authored `role` makes
  `toRuntimeRole` unassignable", and an `as` let a future role past these two lines
  silently.
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.
- 79a4b8f: Recognize the landed AI quota ledger vocabulary in the chat error path
  
  `parseAiQuotaError` now accepts the three SCREAMING_SNAKE ledger codes the cloud
  token guardrail emits (`AI_ALLOWANCE_EXHAUSTED`, `AI_DESIGN_QUOTA_EXHAUSTED`,
  `AI_DATA_CHAT_TRIAL_EXHAUSTED`) alongside the legacy lowercase trio, which stays
  readable for producers that have not converged yet. The companion fields
  (`messageEn` / `upgrade` / `topUp` / `resetsTonight`) are now read from the
  declared envelope's `error.details` as well as their legacy top-level position,
  with the declared position winning.
  
  A quota-exhausted user gets the upgrade / top-up CTA again instead of the
  generic "Response failed" banner. The per-turn message cap's generic
  `QUOTA_EXCEEDED` deliberately keeps its existing rate-limit path — it has no
  upgrade or top-up next step.
- cc3366b: The built-moment transition (#5799) now fires on auto-publish environments too: `detectBuiltAppPackage` reads the raw build envelope (`status:'drafted'` OR `'published'`, packageId + an `app` item), because an auto-publish posture rewrites apply_blueprint's envelope to `published` and the drafted-only `draftReview` lift never fired there — measured live on staging, where reopening a built conversation stayed on the full page.
- a31adc6: `useObjectChat` no longer rebuilds its `DefaultChatTransport` on every render
  (objectui#4187).
  
  The transport `useMemo` listed the caller's `body` and `headers` in its dep list.
  Both are object props and every caller passes a fresh literal each render — the AI
  page's chat pane builds its `body.context` inline — so the memo never hit and a
  transport was constructed on every render of every chat surface, which during a
  streaming turn is once per token batch.
  
  `body` and `headers` are now read through refs inside
  `prepareSendMessagesRequest`, the idiom this hook already uses for the live model
  (`modelRef`) and the handoff conversation id (`parentConvRef`), and they are gone
  from the dep list. Unlike memoizing at each call site, a future caller cannot
  undo it.
  
  No user-visible behaviour changes: `@ai-sdk/react` keeps the transport in a ref
  and re-keys its `Chat` only on `chat`/`id` (verified against the installed
  4.0.68), which `useObjectChat` passes neither of, so the message thread was never
  at risk — the rebuild was pure waste. The one real difference is *when* the two
  values are sampled: a send now reads them at send time, so it observes the values
  of the most recent render instead of those of the last render that happened to
  rebuild the transport. That is never staler than before, and it is pinned by
  `useObjectChat.transportIdentity.test.tsx`.
- 8ea3bee: fix(plugin-chatbot): localize the build-progress panel, which was an English island (objectui#7388)
  
  Every label the build panel is HANDED was already localized — the host passes
  `openBuiltAppLabel`, `designBuiltAppLabel`, `previewDraftLabel` and the three
  connection cues through its own `t()`. Every string the panel OWNED was a
  literal in the component, so a fully Chinese conversation watched its app get
  built under `Building your app…`, over `Objects` / `Views` / `Dashboards` /
  `App` / `Sample data` row headings — one per row, on every build — and a
  `+N more` overflow counter.
  
  All of them now resolve through the console's pack as `chatbot.build.*`, added
  to all ten locales. Behaviour for a known phase is unchanged in English, and
  the unknown-artifact-type fallback still renders the raw type rather than a
  raw i18n key.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- 0fce2ef: `maxToolRoundtrips` on `ChatbotSchema` is deprecated: it is inert, and an author
  who sets it is now told so instead of being left believing the documented cap
  applies (objectui#5605).
  
  The key was declared authorable in `@object-ui/types` (interface and zod, with a
  description), threaded from the authored document through the chatbot renderer at
  three call sites, accepted by `useObjectChat`, given a default — and then dropped.
  Measuring the installed chat runtime says it cannot be honoured from here rather
  than that someone forgot to wire it: `@ai-sdk/react`'s `useChat` takes `ChatInit`
  plus throttle/resume, and `ChatInit` declares exactly one loop control — the
  boolean predicate `sendAutomaticallyWhen` — and no numeric cap under any
  spelling. The numeric knob was removed from `useChat` in a major, and its
  successor was renamed through `continueUntil` to `stopWhen` / `stepCountIs`,
  which the installed `ai` package declares only on `generateText`, `streamText`
  and the tool-loop agent settings — all server-side. ObjectUI is backend-agnostic,
  so it owns no server loop to cap either, and putting the number in the request
  body would only move the same dead key one hop onto a wire contract no backend
  reads.
  
  This is stage one of a two-stage retirement, so nothing an author already wrote
  breaks: the key still parses, still carries its declared shape, and the renderer
  still threads it. What changes is that it is now marked `@deprecated` in the
  interface, the zod description and the docs, and that authoring it logs a
  one-time notice naming the knob that does work — `planning.maxIterations` on the
  agent. A follow-up removes the declaration once this deprecation has shipped in a
  release.
  
  ⚠️ **Dated note, 2026-09-27 — the key is retired behind a tombstone, not staged for removal — objectui#5605.**
  This deprecation never shipped: it was still a pending changeset when the seat ruled
  arm A on the card, so no release carries the "deprecated, still accepted" state this entry
  describes. Later in this same release `maxToolRoundtrips` is refused by name on all three
  chat nodes, the one-time notice and the renderer pass-throughs are gone, and the key is no
  longer an option of `useObjectChat`. The rest of this entry is kept as the reading of this
  change; the objectui#5605 retirement entry states what an author gets now.
- a392e1c: 「打开这条记录 →」卡片——ask 的记录交接终于有了客户端的另一半
  
  服务端半边（cloud#1659 的 `open_record`）先落了地，实测发现它是**半活的**：agent 发出
  `status:'record_handoff'`、回答说「点击上方链接打开」，而上方根本没有链接——控制台
  有 `build_handoff` 的探测器，这个状态一处都不认识，信号被原样丢弃。
  
  按五步补齐：`detectRecordHandoff`（含持久化 `{type:'text',value}` 包裹形状——replay
  信封那课的规矩）→ live 映射提升 → 水合提升 → 卡片渲染 → 宿主回调。
  
  两个设计点：
  
  - **app 段点击时现场解析**。记录路由要 `/apps/:app/:object/record/:id`，交接载荷只有
    对象和记录 id；宿主回调用一次同源元数据读取 `_packageId` 再导航，不给 agent 增加
    它未必知道的参数。
  - **刻意不做「被取代」置灰**。builder 卡的旧 prompt 会过时，旧的记录链接不会——记录
    不因为有新交接而失效。
  
  真机闭环验证：问「把《沉默的大多数》标记成已读」→ 卡片渲染
  （`沉默的大多数 — 把阅读状态改为已读`）→ 点击 → 落在
  `/apps/app.hdke/hdke_book/record/<id>` 详情页，「编辑」在手边。
  
  缺任一 id 的交接在探测器就被丢弃，与服务端的拒绝对称——指向空处的卡片比散文更糟。
- ad404e0: Confirm-replay dispatch errors (bare `{error: …}` envelopes) now resolve the 确认修改 card instead of leaving it on 应用中 forever: `detectReplayOutcome` classifies them as a provisional failure, and a later successful authoring result in the same turn (the model self-repairing, e.g. after an `object not found` on a blueprint-local name) supersedes it via `detectAuthoringVerdict` — so the card never says 未生效 over a change that actually landed. Real publish failures (`publishFailed` envelopes) are never superseded. Measured live on the local rig, 2026-08-24.
- eddc1dd: The Studio copilot tells the agent WHAT the user is discussing (cloud#1610 send half): `ChatPane` accepts a `surfaceContext` and sends it as `context.surface` on every turn (the transport reads the body per send, so it stays fresh); the Studio copilot derives it from the URL alone — the `:tab` pillar segment plus the `?surface=type:name` deep-link the pillars already mirror, so the artifact carries its type discriminator (page/object/dashboard/report). A display chip above the composer (「正在讨论：…」, new `console.ai.discussing` key in all ten packs) makes the sent context visible instead of invisible grounding.
- 9a9977c: 工具卡片的名字终于有了 i18n 通道（此前中文界面里必然是英文）
  
  实测（cloud#1658，全中文环境）：
  
  ```
  统计一下每个阅读状态各有多少本书
    Describe object    已完成   执行过程     ← 工具名英文
    Visualize data     已完成   执行过程     ← 工具名英文
    已统计完成，各阅读状态的书本数量如下：…    ← 其余全中文
  ```
  
  卡片上每一处都本地化了——状态、动作、回答——**唯独工具名不能**，因为
  `humanizeToolName` 是个纯英文构词器（`describe_object` → `Describe object`），
  名字从未经过翻译，任何语言包都够不着它。而"它现在在做什么"恰恰是用户最需要读懂的一步。
  
  现在它接受一个可选的 `translate`（形状即 `useSafeTranslate()`），按
  `chatbot.tool.<tool_name>` 查；查不到就回落到与今天完全一致的英文标题。
  
  **这一步只打通通道，不改变任何现有显示**：不传 translate 时行为逐字不变（测试的第一组
  就在钉这一点），语言包也还没有条目。后续两件事各自独立、可分别推进：
  把两个调用点接上 `useSafeTranslate()`；以及按需往语言包里补 `chatbot.tool.*`。
  先落通道是因为——在通道存在之前，翻译工作根本无处可放。
  
  回落刻意交给英文标题而非原始名：语言包缺条目时显示 `Describe object`（与今天相同），
  而不是 `describe_object`（比今天更差）。
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [cdefa2a]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [244d516]
- Updated dependencies [deca847]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [51c2949]
- Updated dependencies [a4b017e]
- Updated dependencies [8732846]
- Updated dependencies [559a2e2]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [9419df1]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [d0fba91]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [d0097af]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [6fd2cf7]
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [969ba84]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [23b9958]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
- Updated dependencies [1570eac]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [55ba3ff]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7cbc724]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [6ce89da]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [eddc1dd]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0

## 17.6.0

### Patch Changes

- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [ef0d150]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [8871c14]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Minor Changes

- 3256b14: `@object-ui/plugin-chatbot`'s `ChatMessage` is now one type instead of two

  The barrel exported two different `ChatMessage` types: a minimal one it declared itself (`id` / `role` / `content` / `timestamp` / `avatar` / `avatarFallback`) and the shape `<ChatbotEnhanced>` actually renders, re-exported under the alias `ChatbotEnhancedMessage`. The natural name resolved to the narrow one, so an importer reaching for `ChatMessage` silently got the wrong contract — and the compiler could not object, because both shapes existed on purpose and every construction site spreads the extra keys conditionally, which defeats excess-property checking. That is how app-shell's `AiChatPage` ended up unable to read `toolInvocations` off its own function's return value (objectui#4040; re-pointed in PR #4379, but the collision itself was left standing). objectui#4383.

  **Breaking semantics** (declared `minor` per AGENTS.md §版本号策略 — objectui never declares `major` outside an `@objectstack` major sync): `ChatMessage` exported from `@object-ui/plugin-chatbot` now denotes the enhanced shape. In practice this is a widening rather than a removal — every field of the retired shape survives with the same type, and the enhanced shape adds only optional keys (`streaming`, `toolInvocations`, `reasoning`, `sources`, `traceId`, `buildProgress`, `blueprintProgress`, `charts`), so anything that was a valid `ChatMessage` still is, and `<Chatbot messages={…} />` keeps accepting the same values. Code that relied on the name meaning _exactly_ the six-key shape (exhaustive `keyof` maps, `Equal`-style assertions) is the case that changes.

  `ChatbotEnhancedMessage` is kept as a `@deprecated` alias of the same type, so importers that spelled the disambiguating name keep compiling; new code should import `ChatMessage`. Pinned at compile time by `packages/plugin-chatbot/src/__tests__/chat-message-contract.test.ts`.

- eec2e4f: `useObjectChat` declares the message shape it actually hands back

  The hook typed `messages` — and the `onSend(content, messages)` callback fed from it — as `@object-ui/types`' authoring `ChatMessage`. That was true in local mode only. In API mode the values came out of the runtime mapper and were asserted into place with `as OuiChatMessage[]`, and the authoring contract declares none of what they carry: `buildProgress`, `blueprintProgress`, `charts`, and `pendingActionId` / `draftReview` / `proposedPlan` / `proposedChanges` / `builderHandoff` on every tool invocation. Those keys are the HITL approval card, the "Review N changes" affordance, the proposed-plan card, the build panel and the inline charts. They survived only because nothing on the path ever rebuilt a message; anyone writing the obvious thing — reconstruct a message field-by-field from its declared type — deleted all of them, with the compiler agreeing, because the declared type genuinely did not have them.

  The declaration is now the truth, published as `ObjectChatMessage`. The survey behind it found the honest type to be neither of the two `ChatMessage` types on either side, because neither is true of both modes: it stays **wide** where local mode is wide (an authored `'tool'` role and the legacy `'partial-call'` / `'call'` / `'result'` tool states reach this surface unchanged and are folded only at the render seam), **narrow** where both modes are narrow (`timestamp` is `string`, never `Date` — API mode never produces one and local mode absorbs it before emitting), and adds the render-only keys API mode really carries. The `as OuiChatMessage[]` assertion is deleted rather than moved: the mapper's output satisfies the declared type, so the compiler checks that assignment instead of being told to stop looking.

  Nothing about the values changed, and nothing correct breaks. `ObjectChatMessage` is a **subtype** of the authoring `ChatMessage` it replaces, so every consumer that accepted the old declaration still accepts these values — including a host `onSend` callback that types its parameter as `ChatMessage[]`, which keeps type-checking by contravariance. Naming `ObjectChatMessage` is what lets a host _read_ the keys above. The one observable narrowing is deliberate: code that branched on `timestamp instanceof Date` was handling a value this hook cannot emit, and now says so at compile time.

  The seam below it (`chatMessageAdapter.ts`, from objectui#4399) is still necessary and unchanged in behaviour — `'tool'` and the legacy tool states still have to be narrowed for the renderers. What changed is that its pass-through is no longer an act of faith: its input type (`SeamChatMessage`, also exported, alongside `SeamToolInvocation`) names the render-only keys, so the spread preserves them as declared properties the compiler can see, and the pass-through tests type their API-mode fixture directly instead of casting it past the compiler. A cast returning to the hook is now caught by a test rather than by a future outage.

  App-shell carries a comment-only correction on the same family: `AiChatPage` still described `@object-ui/plugin-chatbot` as exporting a second, minimal legacy `ChatMessage` alongside the enhanced one. That collision was retired in objectui#4383 — the barrel publishes one contract and `ChatbotEnhancedMessage` is a deprecated alias of it — so the paragraph was sending readers to look for a hazard that no longer exists.

### Patch Changes

- dde7283: `chatbot` and `chatbot-enhanced` now pass only whitelisted DOM props to their host element (objectui#4431)

  Both registrations destructured `schema` and `className` and forwarded everything else. `SchemaRenderer` hands a registered component the authored node's own keys, the contents of its `props` container, the ARIA it resolved and the host's trailing props — so all of it became attributes on the chat root `div`, because React passes unknown lowercase attributes through in silence and stringifies object values. Measured through the real SDUI path with a data-source adapter attached: **14 non-DOM attributes on each widget**, including `datasource="[object Object]"` (the injected adapter, which only appears on a deployment that really loads data) and a camelCase `arialabel` sitting next to the resolved `aria-label`, so the element carried each ARIA value twice under two spellings — one of them meaningless to assistive technology.

  Both are now consume-or-whitelist: configuration is read off `schema` as before, the evaluated `disabled` verdict is consumed by name, and only `toDomProps`' output reaches the element. The resolved `aria-label` / `aria-describedby`, `role`, `id`, `tabIndex` and the `data-*` family still arrive — dropping them would have been an accessibility regression dressed as a leak fix, so the pin asserts the delivered set exactly, not just the absent one. `chatbot-floating` is untouched: its content mounts through a portal and its root never spread.

  `@object-ui/core` gains the shared executor this migration needs (`utils/dom-props.ts`): `toDomProps` for the SDUI widget contract, plus `pickDomProps` — the mechanism — for a package whose own contract declares a different key set. That is the objectui#4409 dependency direction: plugin packages declare `@object-ui/core` and must not grow a dependency on `@object-ui/fields` to reach a whitelist.

  `@object-ui/fields` keeps its own key list and its compile-time bindings, and now executes them through core's mechanism. Its behaviour is unchanged and its exported `DomProps<P>` is the same structural type. The two lists differ for measured reasons and no longer can drift silently: `name` and `disabled` are legal only on form controls, which is what every field widget renders and what `FieldWidgetComponentProps` declares, while `role` is resolved by `SchemaRenderer` for every SDUI node and is not part of the field contract. A new assertion binds every shared key in both directions, with `role` named as the single deliberate exception.

- 37bbc42: Replace the three `messages as any` casts at the `@object-ui/types` ↔
  `@object-ui/plugin-chatbot` `ChatMessage` boundary with one explicit typed
  adapter (`toRuntimeMessages` / `authoredToRuntimeMessage`, now exported).

  The authoring contract (`ChatbotSchema['messages']`) and the runtime contract
  `<ChatbotEnhanced>` renders are both deliberate and deliberately different; the
  casts erased ALL of that drift rather than the intentional parts, so a future
  vocabulary move would have surfaced as rendering behaviour instead of a type
  error. Each narrowing is now named, documented and tested: an authored
  `role: 'tool'` message is an assistant message (unchanged rendering — the
  implicit fallthrough is now the recorded decision), a `Date` timestamp becomes
  its ISO string (one expression, consumed by both the seam and the hook's
  `normalizeMessages`), and the legacy tool-invocation states
  `'partial-call'`/`'call'`/`'result'` map to their AI SDK v6 equivalents as the
  authoring type's own documentation declares — previously they reached the tool
  chip unrecognised and rendered a status badge with no label.

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [3f5f87c]
- Updated dependencies [2fea4d2]
- Updated dependencies [f5e1143]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Minor Changes

- d9ce385: `ApproveOutcome` / `RejectOutcome` are now derived from `@objectstack/spec`
  instead of hand-transcribed (objectui#3783). Same failure class #3220 cleared
  from the same file for `PendingActionRow` / `PendingActionStatus` — but this pair
  wore local names rather than spec names, so `check-spec-symbol-derivation.mjs`,
  which fires on a spec export name being occupied, had no handle on it. A renamed
  hand copy is invisible to a name-based guard by construction.

  Both types now re-export the spec's decision responses
  (`ApproveAiPendingActionResponse` / `RejectAiPendingActionResponse` from
  `@objectstack/spec/api` — the same schemas `@objectstack/client`'s
  `ai.pendingActions.approve()` / `.reject()` type their returns with). The public
  export names do not change. The shapes do, in three ways:

  - **`ApproveOutcome` no longer declares `id`.** The approve response has never
    carried one — `id` is on the _reject_ response. This was the one drift that
    was not dormant: `useHitlInChat`'s public `onDecided` callback promised
    consumers `id: string` and handed them `undefined` at runtime, with nothing
    in the compiler to say so. **If you read `outcome.id` after an approve, that
    read was already `undefined` and now fails to compile** — take the id from
    `ContinueContext.pendingActionId` or from the row you decided on.
  - **`status` is closed.** `'executed' | 'failed' | string` and
    `'rejected' | string` were both just `string`: a union with `string` absorbs
    the literals, so neither annotation carried any information. They are now
    `'executed' | 'failed'` and `'rejected'`.
  - **The `[k: string]: unknown` index signature on `ApproveOutcome` is gone.** The
    objectstack#4075 mechanism: with it, any structural comparison against the
    spec answers "identical" however far the copy has drifted, so a parity test
    bolted onto the old type would have been green from its first day.

  **Breaking at the type level for importers of `@object-ui/plugin-chatbot`** —
  narrowing a published type is a break even when the old type was lying, which is
  why it is spelled out here. Shipped as `minor` per AGENTS.md §版本号策略: the
  family's `major` tracks `@objectstack`'s, and objectui's own breaking changes go
  out as `minor` with the break named in the changeset.

  Runtime behaviour is unchanged — including the hook's decision handling for a
  status outside the spec vocabulary, and the locally synthesized failure envelope
  on a non-2xx, both now pinned by tests. The consumer-side tolerances that remain
  in `useHitlInChat` are recorded in objectui#3790 for a maintainer decision.

### Patch Changes

- 2a54e86: `parseAiQuotaError` now reads the AI quota refusal code from all three shapes the
  cloud 429 producers use, instead of only the flat `error`-holds-the-code dialect.

  The two live producers fill the same `error` key in opposite ways — the token
  guardrail puts the **code** there, `service-ai` puts the **message** there and the
  code in a `code` sibling — while ADR-0112 declares a third shape both are
  converging on: `{ success: false, error: { code, message } }`. The consumer had to
  learn the declared shape **first**, or the producers' convergence would silently
  turn every quota refusal back into a generic "Response failed" banner (the same
  consumer-first sequencing as objectui#2992).

  - Code lookup order is a total order — declared envelope, then the flat guardrail
    code, then the `code` sibling — so a transitional producer that double-emits the
    new envelope alongside the legacy top-level keys has one defined outcome.
  - Only the code's **location** widens. The recognized code set is unchanged, and
    any unrecognized shape still degrades to today's behavior (`null`), so no
    non-quota error is newly captured by the quota CTA.
  - Companion fields (`upgrade`, `topUp`, `messageEn`) keep their established
    top-level read; their position inside the declared envelope is deliberately not
    presumed, and is aligned once the producer PR fixes the real shape.

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [7864f03]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [7ed3360]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [f833d3a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Minor Changes

- c5ccbd5: Stop declaring 12 `@object-ui/data-objectstack` / `@object-ui/plugin-chatbot` /
  `@object-ui/plugin-list` symbols under names `@objectstack/spec` owns
  (objectui#3160, objectstack#4115 batch 6). All three packages leave the ledger.

  **Breaking for importers of `@object-ui/data-objectstack`** — four exported
  names changed, because the spec exports the same name for a _different_ thing:

  | was                   | now                         | what the spec's same-named export actually is                                            |
  | :-------------------- | :-------------------------- | :--------------------------------------------------------------------------------------- |
  | `CacheStats`          | `MetadataCacheStats`        | the platform `ICacheService` counters (`keyCount`, `memoryUsage`)                        |
  | `MetadataSaveOptions` | `MetadataClientSaveOptions` | options for writing a metadata item to a **file** (`format`, `path`, `indent`, `atomic`) |
  | `SecurityPolicy`      | `SecurityManagerPolicy`     | the package supply-chain policy (`autoScan`, licences, code signing, sandbox)            |
  | `ValidationError`     | `DataApiValidationError`    | a plain `{ field, message, code? }` entry in a validation report                         |

  Each pair is disjoint or nearly so — `MetadataSaveOptions` and `SecurityPolicy`
  share not one key with the spec type whose name they wore — so none of them was
  a dialect to reconcile; they were four unrelated concepts squatting on spec
  names. `DataApiValidationError` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationError` in batch 4). Its **runtime** `name` deliberately
  stays `'ValidationError'`: `normaliseClientError` and `@object-ui/react`'s
  error-message helper both sniff `err.name`, so that string is a wire contract,
  not a symbol.

  **Breaking for importers of `@object-ui/plugin-chatbot`** — `PendingActionRow`
  and `PendingActionStatus` are now re-exported from `@objectstack/spec/contracts`
  instead of hand-transcribed, which narrows them. The copies had drifted three
  ways, and each drift had **disabled a compile-time check** rather than merely
  differed from one:

  - `status: PendingActionStatus | string` — a union with `string` absorbs the
    literals, so that annotation carried no information at all;
  - `[key: string]: unknown` — the objectstack#4075 mechanism: an index signature
    makes every structural comparison against the spec answer "identical", however
    far the copy has drifted;
  - `created_at` / `updated_at`, which the service contract does not carry and no
    consumer in this repo reads.

  **Breaking for importers of `@object-ui/plugin-list`** — `ViewTab` is derived from the spec's `ViewTabSchema`
  — from its **input** side, because `pinned` / `isDefault` / `visible` carry
  `.default()`s and this component is handed authored metadata, not parsed output.
  That removes a renderer-side tolerance the copy carried: `visible` accepted
  `string | boolean` and the tab bar compared it against the literal `'false'`, a
  spelling no producer emits. `label` also stops being required (the spec makes it
  optional; `name` is the identifier) and `filter` stops being `any`.

  `ListView` and `UserFilters` keep their names as declared dialects: both are the
  React **renderers** of the spec types whose names they share, and each takes that
  spec type as a prop (`ListViewProps.schema`, `UserFiltersProps.config`) rather
  than restating its shape. `Tool` and `MessageContent` in `plugin-chatbot` are
  vendored Vercel AI Elements / Shadcn primitives — upstream's component API, not
  objectui's authored surface — so the guard now skips that directory the same way
  it already skips `components/src/ui/`, with a test that fails if any file there
  stops carrying its vendor banner.

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0
  - @object-ui/i18n@17.2.0

## 17.1.0

### Patch Changes

- 9a13622: **Read the agent catalog in the declared envelope too, before the server converts.**

  `GET /api/v1/ai/agents` is served by two producers — the framework dispatcher's
  degraded fallback when no AI service is registered, and cloud's `service-ai` — and
  it is one of the last SDK-addressable routes still answering outside the platform's
  declared `{ success: true, data }` envelope (objectstack#4053). `useAgents` read
  only `{ agents }` and a bare array, so the day either producer converts, the parse
  would miss.

  That miss is unusually dangerous on this particular route, which is why it is worth
  getting ahead of rather than fixing after. The catalog is not just data:
  `useAiSurfaceEnabled` gates the **entire AI surface** on `agents.length > 0`,
  because the route is access-filtered per caller and is therefore the only signal
  that is both edition- and user-aware (ADR-0068). An empty list is the correct
  answer for a seat-less user or a Community-Edition deployment with no `service-ai`
  — so a parse miss and the legitimate hidden state are **indistinguishable**: no
  error, no 403, no log, just the FAB, the top-bar link and the designer's "Ask AI"
  quietly gone for everyone.

  `extractAgentList` now folds all four shapes to the same list — a bare array,
  `{ agents }`, `{ success: true, data: [...] }`, and `{ success: true, data:
{ agents } }` — detecting the envelope the way `ObjectStackClient.unwrapResponse`
  does (a **boolean** `success`), so the two readers cannot disagree about what
  counts as one. Nine tests cover it; reverting to the previous two-shape read fails
  five of them.

  No behaviour change against any server shipping today: the shapes that worked
  before still parse identically. This only removes the lockstep requirement, so the
  server side can convert on its own schedule.

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [d21794c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [f8a95e5]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0

## 17.0.0

### Patch Changes

- cfc675e: fix(i18n): unconditional Chinese in the chatbot confirm card and the field inspector (objectui#2884, objectui#2885)

  Two issues split out of the objectui#2871 survey because neither is a language
  _branch_ — both are copy that renders in Chinese for every user regardless of
  locale.

  **objectui#2884 — the confirm-before-change card.** Heading, buttons, hint and
  the verb column of each change row were Chinese literals, so an English user
  read the whole confirm gate in Chinese. They now follow the same
  prop-with-English-default convention the plan card already uses
  (`changesTitleLabel`, `changesConfirmLabel`, `changeVerbLabels`, …), with the
  console passing translated values from `console.ai.*`.

  The serious half was the outbound message. Clicking Confirm sent
  `'确认修改，应用你刚才提议的改动。'` unconditionally — an English user's click
  told the agent, in Chinese, to apply the changes, and the agent answered in
  Chinese for the rest of the thread. That message now routes through the same
  `convZh` (conversation-language) switch as `planApproveMessage`, so it matches
  the language actually being spoken rather than the UI or a hard-coded literal.

  Note this is deliberately _not_ "always send English": the repo already decided
  outbound agent text follows the CONVERSATION, and the cloud confirm gate
  (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`) matches on approval
  keywords. The Chinese string is unchanged, so that path is byte-for-byte what
  the gate already accepted; `i18n.test.ts` now pins it against the mirrored gate
  regex alongside the two plan messages.

  Also in this component: the error banner's `Response failed` / `Details` /
  `Retry` were hard-coded English, and both it and the quota banner used a bare
  `t(key)` that renders the raw key when the chat is mounted without an
  `I18nProvider`. Both now use `useSafeTranslate`, so they degrade to English
  instead of to `chatbotError.title`. The `「…」` corner brackets around the
  target-app name are now neutral quotes.

  **objectui#2885 — the draft-field suffix.** `ObjectFieldInspector` appended a
  bare `(草稿)` to draft objects in the lookup picker — the only Chinese literal
  in a 1500-line file where the other 101 strings all go through `t(key, locale)`.
  It now reads `engine.inspector.draftSuffix` from the Studio catalog.

  The 18 new keys were added to all ten locale packs, so the objectui#2872 part
  (a) gap held at 469/471 rather than widening.

- 0502a7c: fix(i18n): the change card's Confirm button sent text the cloud gate does not accept

  The English `console.ai.changesConfirmMessage` was
  `"Confirm the changes — apply what you just proposed."`. The cloud confirm gate
  (`service-ai-studio` `confirm-gate.ts` `APPROVAL_RE`) recognises
  `apply (this|the) change` — **not** "apply what". So the message failed the
  gate, and failing the gate is silent: the agent re-proposes instead of applying,
  and the Confirm button on the change card simply looks inert.

  This affected English conversations **and all eight locales that fall back to
  English** for that key. It is now
  `"Confirm — apply the change you just proposed."` — singular "the change", so it
  still matches if the gate ever tightens to a word boundary. The Chinese string
  was always fine (`确认修改` hits the 确认-anchored clause) and is unchanged.

  The same literal lives in four places — the locale pack, the
  `ChatbotEnhanced` prop default, its doc comment, and the `AiChatPage`
  `defaultValue` — and all four are updated together.

  **Why the existing guard missed it.** `i18n.test.ts` mirrored only the _Chinese_
  clause of `APPROVAL_RE`; the English half was reduced to "starts with Confirm,
  contains apply" because nothing in this repo could see the real pattern. That
  weaker assertion passed against a string the gate rejected — the guard was
  green and the feature was broken.

  The mirror is now **verbatim, both clauses**, and drives an `it.each` over every
  outbound approval message in both `zh` and `en`. Two supporting tests keep it
  honest: one asserting the gate stays narrow (a plain build request like
  "帮我搭建一个 CRM" must NOT read as approval), and one asserting
  `planAnswerMessage` does _not_ match — it answers a structure question and must
  never read as blanket approval.

  The mirror is duplicated across a repo boundary by necessity (objectui cannot
  import from cloud); the comment says so, so the next person changing
  `APPROVAL_RE` knows to update it here too.

- 263f885: fix(i18n): delete the four `pick({en,zh})` clones (objectui#2871, part 2)

  Four files each carried an identical private resolver:

  ```ts
  function pick(label: I18n): string {
    const lang = document.documentElement.getAttribute("lang") || "en";
    return lang.toLowerCase().startsWith("zh") ? label.zh : label.en;
  }
  ```

  Only Chinese was ever handled, so ja/ko/de/fr/es/pt/ru/ar silently rendered
  English — and because the copy was baked into the components as inline
  `{en, zh}` pairs, no translator could reach it. All four copies are deleted
  along with their `I18n` type alias.

  Migrated to the locale packs, **all ten languages**:

  - `excelImport.*` (8 keys) — `ExcelImportBar`. The completion toast becomes a
    proper `{{count}}` / `{{object}}` interpolation instead of a template literal
    baked into both language variants.
  - `cloudOnboarding.*` (5 keys) — `CloudOnboardingNext`, the Cloud welcome page.
  - `aiModelStatus.*` (11 keys) — `CloudAiModelStatus`, including the
    `sourceLabel()` enum→prose helper (now `t`-driven with a `{{source}}`
    placeholder) and the three `ModelRow` labels. The conditional
    `(HTTP nnn)` fragment becomes two whole sentences rather than a string
    spliced mid-clause, which is not translatable into every word order.
  - `chatbotQuota.*` (4 keys) — the AI quota banner in `ChatbotEnhanced`.

  The chatbot banner keeps choosing between the server's `quota.message` (zh) and
  `quota.messageEn` — that pair is server-owned — but now decides using the
  console's active language instead of `navigator.language`, which had ignored
  the in-app locale switcher entirely.

  `CloudOnboardingNext`'s tests now render inside a real `I18nProvider`; without
  one `t()` returns the raw key, so the previous assertions on literal English
  were asserting nothing.

  This completes the `pick()` cluster from #2871. The remaining
  `startsWith('zh')` sites are the ones that classification marked KEEP —
  `LoadingScreen` (bootstrap, selects real locale packs before i18next is up),
  `conversationLanguage` (detects the chat's language for the agent, not UI
  copy), `containers.tsx` (normalises author-supplied schema data; its `'与'`
  separator is a CJK typography rule), and the Studio catalog / `field-types.ts`
  data catalog.

- Updated dependencies [7b21891]
- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [ba73a02]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Patch Changes

- 59db1f9: chore(lint): clear the baseline lint errors in plugin-chatbot (objectui#2713 Wave 3)

  Wave 3 of the #2713 lint-gate restoration. `@object-ui/plugin-chatbot` was red at
  baseline on `main`; cleared every **error** (no behavior change; warnings out of
  scope):

  - **`react-hooks/rules-of-hooks` in `useObjectChat` (8)** — the hook called
    DIFFERENT `useCallback`s in each of its two `isApiMode` return branches, so
    both sets were conditional (React throws if the mode toggles between renders).
    `useChat` was already called unconditionally; this destructures its result and
    hoists all eight callbacks (3 API + 5 local) above the `isApiMode` branch, so
    the same hooks run in the same order every render. Only the returned surface
    differs by mode — the callback bodies are unchanged (the API `messages` local
    is renamed `apiMessages`). Verified against the `useObjectChat.sendFailure` /
    `handoffContext` / `ChatbotEnhanced.sendError` suites.
  - **`react-hooks/rules-of-hooks` in `FloatingChatbotTrigger`** —
    `useChatbotLabel` wrapped the provider-safe `useObjectTranslation` in
    try/catch; removed the wrapper (the #2709 fix).
  - **`react-hooks/static-components` in `shimmer`** — `motion.create(Component)`
    genuinely builds a motion component and must key off the `as` prop, so it
    can't be module-scoped. Memoized per `Component` (stable across renders,
    avoids the remount) and carries a justified scoped disable at the render site.

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0

## 16.0.0

### Patch Changes

- c0bd483: Plan-card approval gives immediate in-card feedback (#2627): clicking
  "Build it" flips the clicked card to a spinning "Building…" badge right away
  (the approval's chat-level effects land at the bottom of the thread, outside
  the viewport, so the card looked untouched for ~10s and users double-clicked).
  The durable Built state still derives from the message stream; an approval
  that never left the client (rate limit / offline) rolls the badge back so the
  button returns. New `planBuildingLabel` prop (AiChatPage passes zh).
- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0

## 14.1.0

### Patch Changes

- 82441e4: feat(console-ai): proactive AI usage indicator in the ChatDock (ADR-0057 #8)

  Surfaces remaining AI headroom **before** a send hits the 429 wall, instead of
  only learning the limit reactively.

  - **AiUsageIndicator** — two meters (build + dataChat) as small progress rings in
    the ChatDock header (desktop rail + mobile sheet). Near-full → an amber
    "running low" hint and a popover with "resets tonight / next cycle" plus the
    upgrade / top-up CTA (reusing the 429 deep-link). D5-safe: fractions and
    qualitative words only, never a token number. Hides itself when the usage
    endpoint is absent (older backend / OSS / no seat).
  - **useAiUsage** — fetches the D5-safe per-meter fractions; refetches on the chat
    engine's post-turn / 429 nudge and on tab re-focus; fails soft to nothing.
  - **useObjectChat** emits `AI_USAGE_REFRESH_EVENT` on a rejected send (429) and on
    the turn-finish edge so the ring updates right after the user's action.
  - i18n: `console.ai.usage.*` in en + zh-CN.

  Consumes the cloud `GET /api/v1/ai/usage` endpoint (objectstack-ai/cloud#824).

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Minor Changes

- 7b4fc36: feat(console-ai): ask→build handoff carries conversation context (ADR-0057 P4 / cloud#817)

  The P4 "Open in Builder →" handoff previously carried only the build prompt + an
  optional package, so the Builder started cold and the user re-explained
  themselves. It now also carries the **source `ask` conversation** as context —
  ADR-0057 P4 / cloud#817 — so the build agent's first turn starts with the thread
  the user already had.

  - `@object-ui/app-shell`: both handoff sites (the full-page `AiChatPage` and the
    console FAB) now append `?parentConversationId=<ask thread id>` to the
    `/ai/build` URL. The build surface reads it and forwards it to `useObjectChat`;
    the existing URL-mirror drops it once the build conversation id is minted, so a
    reload never re-carries it.
  - `@object-ui/plugin-chatbot`: `useObjectChat` accepts `parentConversationId` and
    sends it as `context.parentConversationId` on the **first turn only** (held in a
    ref, consumed once) — the backend redeems it into the turn's context and the
    client owns history from there. New pure helper `withHandoffContext` (unit
    tested) does the non-mutating `context` merge.

  Requires the cloud handoff-context contract (service-ai, cloud#817): the build
  agent redeems `context.parentConversationId` into a single system block on its
  first turn — ownership-checked, and carrying only the user/assistant text the
  user already saw (ADR-0063 governance boundary). Without it the console degrades
  cleanly: the id is sent but ignored, and the handoff is a (working) cold start.

- 7dea792: feat(console-ai): explicit "Open in Builder →" ask→build handoff (ADR-0057 P4)

  When the `ask` agent declines an app-authoring request it now calls the cloud
  `suggest_builder` tool (structured decline). The console renders that as an
  explicit **"Open in Builder →"** action that opens the full-page build surface
  seeded with the handoff prompt — ADR-0063 decline-and-redirect: an explicit,
  user-initiated switch, never a silent re-route into authoring.

  - `@object-ui/plugin-chatbot`: `detectBuilderHandoff` lifts the
    `{ status:'build_handoff', prompt, packageId? }` result onto the tool
    invocation; `ChatbotEnhanced` renders the "Open in Builder →" card and calls a
    new `onOpenBuilder` prop (disabled when no host wires it).
  - `@object-ui/app-shell`: the full-page `AiChatPage` (`ask`) and the console FAB
    wire `onOpenBuilder` to navigate to `/ai/build?package=…&handoffPrompt=…`; the
    build surface seeds that prompt as its first message (auto-sent once the
    conversation is minted), and the URL-mirror strips `?handoffPrompt` so a reload
    never re-sends it. Full ask-conversation context transfer is a later upgrade
    (cloud#817); v1 carries the build prompt + optional package.

  Requires the cloud `suggest_builder` signal (service-ai-studio) to light up; the
  console degrades cleanly (no card) without it.

- 9d0fdb1: feat(console-ai): render agent behavior by declared capability (cloud#816 / ADR-0057 "B+")

  `GET /api/v1/ai/agents` now serves per-agent `capabilities`; the console
  consumes them instead of hard-coding `isBuildAgent(name)`:

  - `@object-ui/plugin-chatbot`: `AgentDescriptor.capabilities` (normalized from
    the catalog) + new `agentHasCapability(agents, name, cap)` — declaration wins
    when present; falls back to the legacy `isBuildAgent(name)` check when absent
    (older server), so shipping order doesn't matter.
  - `@object-ui/app-shell`: the build-doctor drawer + `showDebug` key off
    `'debug'`, the FAB's resume-vs-fresh keys off `'resume'`, HomePage's
    "Build with AI" availability keys off `'authoring'`. The ADR-0063 product-axis
    sites (surface→agent resolver, conversation scope keying, picker availability)
    intentionally stay name-based — capability describes RENDERED behavior, not
    which product an agent is.

  A future skill-driven build variant now needs no console change.

- cd778d4: feat(console-ai): package binding chip + inert handoff cards + honest send hint (#2458 / ADR-0057 A1.a)

  Three UX improvements from live magic-flow testing:

  - **A1.a — package binding chip** (`app-shell`): the build surface header shows
    the package the conversation is bound to (`📦 <app>`), or **"New app"** when
    unbound — so the edit blast-radius is always visible (Claude-Code-shows-the-repo
    idiom). The magic flow starts unbound and binds the moment its build mints a
    package (`deriveBoundPackageId` reads `?package=` else the latest draft/handoff
    result; unit-tested).
  - **UX#5 — only the latest handoff card is actionable** (`plugin-chatbot`): when
    a thread accumulates several "Open in Builder →" cards, only the newest stays
    clickable; older (superseded) cards' buttons are disabled — derived from
    message order, so it survives the navigation the button triggers and the pane
    remount that follows. A stale prompt in an older card can't be re-fired.
  - **UX#7 — honest send hint** (`plugin-chatbot`): the composer already sends on
    plain Enter (Shift+Enter = newline); dropped the misleading `⌘` glyph from the
    hint so it no longer implies Cmd+Enter.

### Patch Changes

- 1273f1e: fix(console-ai): reliable ask→build handoff auto-send + second-handoff context re-carry (ADR-0057 P4)

  Two follow-ups to the P4 "Open in Builder →" handoff:

  - **Auto-send swallow.** The handoff's auto-sent first message could be dropped on
    a brand-new build conversation: the seed gated on the async-resolved
    `activeAgent`, which can settle _after_ the conversation id is minted, so the
    deferred-send replay ran with an empty pending and never re-fired. The seed now
    gates on the **route** (`agentSegment`, synchronous) and bumps a `pendingSignal`
    that `useDeferredFirstSend` lists in its replay deps, so the seed always fires —
    no more empty build conversation on handoff.

  - **Second-handoff re-carry.** A second "Open in Builder →" into the (singleton)
    build conversation now re-carries the latest ask context. The transport re-arms
    `parentConversationId` on each falsy→truthy transition of the prop (the ask
    thread is a singleton, so the same id repeats — the fresh-arrival signal is the
    transition the URL-mirror produces, not a changed value), and the seed re-arms
    on each new `handoffPrompt`.

  Unit-tested: deferred-send replays a post-id seed via the signal; the transport
  re-carries across a strip→re-supply cycle.

- bfea27f: Make the ask-decline wait feel responsive: live thinking indicator + handoff card the moment `suggest_builder` lands (#2458 item 3).

  When the `ask` agent declines a build-shaped request, the ~20s before the "Open in Builder →" card is dominated by the LLM's time-to-tool-call. During that wait the chat could show dead air — a blank bubble, or the static "执行过程" activity note (a hydrated-history affordance) when the backend streamed a `(called …)` tool-call placeholder.

  `ChatbotEnhanced` now shows the existing live thinking indicator (`ThinkingDots`) whenever a streaming assistant turn has nothing visible yet — including whitespace-only content, a mid-stream `(called …)` placeholder, and hidden reasoning in `summary` mode. The static "执行过程" note is reserved for FINISHED (re-hydrated) tool-call-only turns (#772 preserved). The `builderHandoff` card already renders at `output-available` with no gate on the trailing prose, so it surfaces the instant the tool result arrives; the typing cursor now only paints beside real streaming prose (no lone cursor during the tool phase).

- 408f4ba: fix(plugin-chatbot): build-result summary truncates on mobile instead of overflowing (#2493)

  The draft-review card's summary line (`built N artifact(s) — …`) is a nowrap
  `truncate` span, but its flex row lacked the `min-w-0` that lets `truncate`
  actually bite — so on a phone the long summary expanded the chat column past
  the viewport and the whole chat scrolled sideways. The span now gets
  `min-w-0 flex-1` (truncating within the row) and the action row is `flex-wrap`
  so its buttons drop to a new line on a narrow screen rather than forcing
  horizontal scroll. Desktop is unchanged (there's room, so nothing wraps or
  truncates).

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/react@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Minor Changes

- 8d351f1: chore(chatbot): upgrade to Vercel AI SDK v7 / @ai-sdk/react v4

  Bump `ai` ^6 -> ^7 and `@ai-sdk/react` ^3 -> ^4. The chatbot's `useChat`,
  `DefaultChatTransport`, `UIMessage`/`ChatStatus` usage and the `mapMessages`
  parts adapter are all source-compatible with v7 — no code changes required.

  Verified: type-check clean, build green, 183/183 unit tests pass on v7.

  Part of the org-wide AI SDK v6->v7 / providers v3->v4 upgrade (framework#2464,
  cloud#710).

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Minor Changes

- 27bef5a: feat(ai-build): event-driven "Designing your app…" progress for the blueprint-design stream (Refs cloud#657, cloud#655)

  `propose_blueprint` now streams a reconciled `data-blueprint-progress` part while it drafts the plan (a tens-of-seconds, otherwise-opaque LLM call), so the chat shows the app taking shape — objects appearing one-by-one with their field counts, the summary / extend target revealed progressively, and a `seq`-driven liveness cue — instead of a purely presentational rotating-hint placeholder.

  - `mapMessages`: `uiMessageToChatMessage` lifts the latest `data-blueprint-progress` frame onto `ChatMessage.blueprintProgress` (same single-reconciled-part mechanism as `data-build-progress`; transient, never persisted). This is the shared streaming converter both the full-page AI Build surface (`AiChatPage` via `useObjectChat`) and the floating console chatbot already route through.
  - `ChatbotEnhanced`: a new `BlueprintProgressPanel` renders the live "Designing…" card (object chips + summary + running counts + liveness). It supersedes the rotating-hint placeholder while events flow, and yields to the authoritative "Proposed plan" card the instant the `propose_blueprint` result lands.
  - Graceful degradation: with no `data-blueprint-progress` events (older runtimes / non-streaming turns) the existing rotating-hint placeholder behaves exactly as before — zero regression. On reload the persisted "Proposed plan" card is the record (the live panel is transient by design).

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0

## 7.0.0

### Minor Changes

- 81c0777: feat(studio): ADR-0033 Phase B — draft review surface (chat → designer → generic diff)

  Closes the AI metadata-authoring loop in Studio. The framework (ADR-0033 Phases A + C) makes the assistant stage every change as a DRAFT; this lets a human see and review those drafts.

  **`@object-ui/plugin-chatbot`**

  - `mapMessages` now detects the framework's draft envelopes — `{ status:'drafted', type, name, … }` (single) and `{ status:'drafted', drafted:[{type,name}] }` (apply_blueprint batch) — and lifts the reviewable targets onto `ChatToolInvocation.draftReview` (mirrors the existing HITL `pendingActionId` path; the Vercel `{type:'text',value}` wrapper is peeled). `blueprint_proposed` is intentionally not surfaced (no draft yet).
  - `ChatbotEnhanced` renders a **"Review N change(s)"** button on drafted tool results, driven by a new `onReviewDraft` callback prop.

  **`@object-ui/app-shell`**

  - `assistantBus` gains a review channel (`requestReview` / `requestAssistantReview`); `ConsoleFloatingChatbot` wires the chat button to it; a small navigator inside `AppContent` (which knows the app base) routes to `/apps/:appName/metadata/:type/:name?review=1`.
  - `ResourceEditPage` honours `?review=1`: it force-reloads the pending draft (covers the case where the AI drafted the item after the page mounted) and opens the review/diff.
  - New **`DraftReviewPanel`** — a generic, type-agnostic draft↔published structural diff (added / changed / removed by key), reusing `LayeredDiff`'s `computeDiffRows`. It gives **every** metadata type (view, dashboard, flow, …) a real "what will publishing change" review, surfaced as a toolbar affordance + sheet whenever a draft exists. The object designer keeps its richer per-field review.

  Nothing is published by any of this — the human still clicks Publish.

- 9049bbe: Add end-user friendly agent process summaries for chatbot tool calls, with a debug mode for raw reasoning and tool details. Console chat surfaces now keep a sanitized browser-side display cache so refreshes can restore user/assistant text plus grouped tool states when the backend returns no message rows.
- 053c948: feat(plugin-chatbot): render AI data-query charts inline (`data-chart`)

  Companion to the framework `visualize_data` tool: the data-query assistant can
  now answer with a CHART rendered right in the assistant bubble.

  - `mapMessages.ts` — `extractCharts()` lifts every `data-chart` custom stream
    part onto `ChatMessage.charts` (defensive narrowing; preserves multiple charts
    in order), mirroring the existing `data-build-progress` → `buildProgress` path.
  - `ChatbotEnhanced.tsx` — renders each chart via `<SchemaRenderer schema={{
type:'chart', … }}/>` (decoupled — no hard dep on `plugin-charts`), giving the
    chart a definite `width: min(520px, 80vw)` so recharts' `ResponsiveContainer`
    measures a stable non-zero width inside the `w-fit` bubble (otherwise the
    circular width dependency leaves bars unpainted).

- 053c948: feat(plugin-chatbot): honest liveness indicator on running AI turns

  AI app builds run 1–3 min with long quiet gaps (LLM thinking, sample-data
  generation) where a static spinner is indistinguishable from a dropped
  connection. The chat now shows a Claude-Code-style liveness indicator driven by
  REAL observed stream activity, not a free-running clock:

  - `useTurnLiveness(active, activityKey)` stamps the moment real data arrives (a
    streamed token / tool delta / `data-build-progress` update) and measures
    seconds-since-last-byte.
  - `LivenessIndicator` renders three honest states — _receiving_ (emerald pulse +
    m:ss, bytes arrived recently), _waiting_ (request in flight, nothing back yet),
    and _stalled_ (amber + "no response for Ns", genuinely silent past 6s).
  - The build panel prefers the server's monotonic `seq` keep-alive heartbeat as
    its activity key (falling back to the content signature on older runtimes), so
    a long quiet seed-generation window reads as honestly _receiving_ rather than
    flipping to amber.

### Patch Changes

- 40c79df: Improve the floating chatbot flow with responsive panel bounds, safer FAB placement, inline responding and stop states, and clearer retryable error feedback.
- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1

## 6.2.0

### Minor Changes

- 0335ec4: Polish the AI chat surface based on real-world dogfooding feedback.

  **`@object-ui/plugin-chatbot`** — new display helpers shared by `ChatbotEnhanced`:

  - `unwrapToolResult(value)` peels the MCP-style `{ type: 'text', value: '<json>' }`
    envelope that backend tools emit (`@objectstack/service-ai`'s data/metadata
    tools, in particular), and JSON-parses the inner payload. The result panel
    now renders a structured object tree instead of a doubly-escaped wall of
    `\\\"objects\\\":[…]`.
  - `humanizeToolName(name)` converts snake_case / kebab-case / camelCase tool
    ids into sentence case ("list_objects" → "List objects"), preserving known
    acronyms (API, ID, SQL, …). Tool-call cards now show the friendly title with
    the raw id as a small monospace badge for power users.
  - `summarizeChatError(err)` strips the AI SDK's
    `"Failed after N attempts. Last error: "` prefix and keeps the first
    sentence as a headline; the full text is exposed via an optional `details`
    field so the new error banner can render a "Details" disclosure plus a
    prominent Retry button instead of a 300-character single-line wall.

  A new `⌘⏎ to send` hint is shown in the prompt footer (hidden on narrow
  screens). `ToolHeader.title` now accepts `ReactNode` (previously `string`)
  so wrappers can compose richer titles.

  **`@object-ui/app-shell`** — `AiChatPage`:

  - Removes the fake "Hello! I'm X" assistant welcome bubble so the empty-state
    suggestion chips can actually render.
  - Adds per-agent default suggestion sets (`data_chat`, `metadata_assistant`)
    with a generic fallback. New conversations open with three actionable
    starter prompts tailored to the selected agent.
  - Surfaces agent-fetch failures as an inline warning on the agent picker
    instead of hijacking the welcome message.
  - Placeholder text now hints at the first suggestion (e.g. `Ask Data
Assistant…  (try "系统里有多少个用户？")`).

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1

## 6.0.0

### Minor Changes

- 451bbee: **HITL conversation loop:** `useHitlInChat` now accepts a
  `continueConversation(prompt, ctx)` callback. After the operator approves
  or rejects a tool call from inline chat buttons, the hook synthesises a
  short follow-up user prompt (tagged `[HITL pa_xxx]`, with the executed
  result or rejection reason) and invokes the callback so the LLM
  continues the conversation with full awareness of the outcome.

  `ConsoleFloatingChatbot` wires this callback to `useObjectChat`'s
  `sendMessage`, closing the loop end-to-end. Execution failures stay
  visible in the inline status badge but do NOT continue automatically —
  the operator decides next steps.

  No framework changes required. Internal `idMap` now also tracks the
  tool name so the synthesised prompt is human-readable. New test suite
  `useHitlInChat.test.tsx` covers approve/reject/failed/no-callback
  branches.

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1

## 5.4.0

### Minor Changes

- 3a8c754: Rebuilt the chatbot UI on top of **Vercel AI Elements** (MIT) and wired in
  the v1 capabilities exposed by `@objectstack/service-ai` (tracing,
  `generateObject`, `query_data` tool, `ModelRegistry`).
  - **What's new**
    - `ChatbotEnhanced` is now composed from `Conversation`, `Message`,
      `PromptInput`, `Suggestion`, `Tool`, `Reasoning`, `Sources`, and friends.
      Sticky-to-bottom scrolling, keyboard-aware textarea, file pill chips,
      copy/retry actions, and the streaming/error banners now match the
      shadcn-style AI surface used across the ecosystem.
    - **Tool / reasoning / sources rendering**: assistant messages with
      `toolInvocations`, `reasoning`, or `sources` automatically render the
      collapsible tool panels, the chain-of-thought block, and the citation
      pill. `useObjectChat` parses these directly from `vercel/ai`'s
      `UIMessage.parts` stream — no extra wiring needed at the call site.
    - **Model picker**: optional `models` + `selectedModelId` + `onModelChange`
      props render an inline `<select>` in the prompt-input toolbar. Designed
      to be fed straight from `GET /api/v1/ai/models` (new in service-ai
      v1).
    - **Trace links**: new optional `traceId` on `ChatMessage` surfaces a
      small "trace" link on assistant messages — pair with the `ai_traces`
      object exposed by service-ai's auto-tracing.
    - New optional `suggestions?: string[]` prop renders a chip row in the
      empty state and forwards the picked suggestion to `onSendMessage`.
    - All vendored AI Elements (10 components) plus two missing shadcn
      primitives (`button-group`, `input-group`) are exported as a namespace —
      `import { AIElements } from '@object-ui/plugin-chatbot'` — so apps can
      compose bespoke chat surfaces without dropping back to the legacy
      primitives.
  - **Type-level changes**
    - `@object-ui/types` `ChatMessage` gains optional `reasoning`, `sources`,
      `traceId` fields, and a new `ChatMessageSource` interface.
    - `ChatToolInvocation` accepts the AI SDK v6 lifecycle states
      (`input-streaming`/`input-available`/`output-available`/`output-error`/
      …) in addition to the legacy `partial-call`/`call`/`result`. `args`
      is now optional and accepts arbitrary shapes; new optional `errorText`
      field.
  - **What hasn't changed**
    - Public prop signature on `FloatingChatbot`, `FloatingChatbotPanel`, and
      the SDUI `"chatbot"` renderer.
    - Hook contracts: `useObjectChat`, `useAgents`,
      `useFloatingChatbot`.
    - SSR / Tailwind 4 / React 18+19 support.
  - **Under the hood**
    - New deps: `streamdown`, `use-stick-to-bottom`, `shiki`, `motion`,
      `nanoid`, `@radix-ui/react-use-controllable-state`,
      `@radix-ui/react-slot`, `class-variance-authority`.
    - Vendored sources live under `src/elements/` with header comments pointing
      back to `registry.ai-sdk.dev`. Rule #7 No-Touch Zones are respected —
      `packages/components/src/ui/**` was not modified.

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/components@5.0.2
- @object-ui/react@5.0.2
- @object-ui/types@5.0.2
- @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- 1b6dc64: fix: complete Tailwind v3→v4 migration cleanup

  - Rename deprecated `flex-shrink-0` → `shrink-0` and `flex-grow-N` →
    `grow-N` (Tailwind v4 dropped the long-form aliases). Affects
    data-table, fields/index, FileField, ChatbotEnhanced,
    FloatingChatbotPanel, ProcessDesigner, HistoryPanel, KanbanEnhanced,
    KanbanImpl, plugin-timeline index, FlowDesigner, LayoutRenderer.
  - Replace `theme(spacing.4)` inside arbitrary-value `[calc(...)]` with
    literal `1rem` in sidebar.tsx — `theme()` is deprecated in v4.
  - Remove obsolete v3-escape CSS overrides from index.css and
    sidebar-fixes.css. The component source now uses native v4 stacked
    data variants (`group-data-[state=collapsed]:group-data-[collapsible=icon]:w-(--sidebar-width-icon)`)
    which Tailwind v4 emits correctly without the manual overrides.
    Only the bespoke `.sidebar-menu-button-icon-mode*` rules are kept.

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
