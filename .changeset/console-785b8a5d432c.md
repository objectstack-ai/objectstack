---
"@objectstack/console": minor
---

Console (objectui) refreshed to `785b8a5d432c` — the 2026-08-02 objectui batch reaches v17 (#4665).

Until this pin moves, a merged objectui fix exists only on objectui's `main`: the
release pipeline clones objectui at `.objectui-sha`, so anything newer is simply not
in the artifact the platform ships, and its frontend changeset never reaches the
platform's release history (#3340). Four of the seven PRs merged that day changed
published packages, and one of them is **breaking for authoring** — so that
migration is written out here, in the layer the release notes are compiled from,
rather than left implicit in a SHA.

## Breaking for authoring — an action param's picker target is `reference`, and only `reference` (objectui#3203)

`ActionParam` in `@object-ui/types` no longer declares the nine resolved-side picker
keys: `referenceTo`, `displayField`, `idField`, `descriptionField`, `titleFormat`,
`lookupColumns`, `lookupFilters`, `lookupPageSize`, `dependsOn`.

Migration:

- **Inline picker target** — rewrite to `reference`:
  FROM `{ name: 'account_id', type: 'lookup', referenceTo: 'account' }`
  TO   `{ name: 'account_id', type: 'lookup', reference: 'account' }`
- **The other eight** — make the param **field-backed** and it inherits the whole
  picker group from the object field: `{ field: 'account_id' }`.

**This removes a compile-time illusion, not a capability.** Those keys were never
storable: `@objectstack/spec`'s `ActionParamSchema` is `.strict()`, its authorable key
list carries `reference` and not `referenceTo`, and its alias table names
`referenceto → reference` by hand — so an authored `referenceTo` has always been a
hard parse rejection on the server. Only `tsc` waved it through, against objectui's
public type, which meant the mistake surfaced at publish time instead of at the
authoring keystroke. `ActionParam` is now derived from the spec schema
(`Omit< z.input< typeof ActionParamSchema >, 'type' >`), so the authoring type and
the parser can no longer disagree about a spelling, and `resolveActionParams()`
additionally names any resolved-only key it meets in a dev-mode warning with the
prescription above — covering params authored in plain JS or JSON, which `tsc` never
sees.

## Also author-visible in this batch

- **An unrecognised dashboard date-filter value is skipped and named, not compared**
  (objectui#3196, `@object-ui/core` minor — the other half of #4475). A `date` /
  `dateRange` value that is neither a known preset nor a parseable date used to fall
  through to "bare string means equality on that day", so a typo
  (`defaultValue: 'last_7_dayz'`) reached the backend as `WHERE created_at = $1` and
  answered `200 OK` with zero rows — indistinguishable from "this range has no data".
  Such a filter is now dropped with a `console.warn` naming the filter, the offending
  value and the accepted spellings; the widget's numbers go from 0 to unfiltered.
- **`record:activity` fetches a feed instead of rendering a permanently empty one**
  (objectui#3204, `@object-ui/plugin-detail`). The block's eleven declared inputs were
  filters over a hard-coded `items={[]}`; the feed now resolves from `items` → a
  mounted `DiscussionContext` → a self-fetch of `sys_activity` scoped to the bound
  record, and the read-side inputs actually filter. `showSubscriptionToggle` is
  labelled `NOT IMPLEMENTED` in its own input description rather than left looking
  configurable.
- **A fetching activity feed says "loading", not "No activity recorded"**
  (objectui#3210, `@object-ui/plugin-detail` patch). The declared `loading` prop was
  destructured into `_loading` and never read, so the panel asserted the record had no
  activity for the whole duration of every fetch.
- **`managedBy: 'system'` → `'system-data'` follow-through** (objectui#3214): the
  Console now speaks the vocabulary this platform's retirement left standing.

Full frontend range below. `fix(ci)` / CI-only commits are omitted — they release
nothing and are not in the shipped bundle.

- fix(fields)!: FieldWidgetComponentProps stops claiming to have every key (#3221) (#3230)
- fix(app-shell): inspectors read and write the expression envelope (#3218) (#3228)
- fix(app-shell): flow simulator evaluates a `{ dialect, source }` edge guard (#3216) (#3217)
- feat(types,core,app-shell)!: follow the `managedBy: 'system'` → `'system-data'` retirement (objectstack#3355) (#3214)
- fix(app-shell): flow branch editor stamps an id on the edges it creates (#3202) (#3215)
- fix(plugin-detail): a fetching activity feed says "loading", not "No activity recorded" (#3205) (#3210)
- feat(plugin-detail): record:activity fetches a feed instead of rendering an empty one (#3165) (#3204)
- fix(types,app-shell)!: `reference` 是 action param 唯一可作者化的 picker 目标 (#3174) (#3203)
- fix(deps): #3184 可合并版 —— focus-scope 栈驱逐竞态补丁,解冲突 + 补丁存废说明 (#3200)
- fix(core): 未知的 date filter 值改为跳过并警告,不再降级成永不命中的等值 (#3151) (#3196)
- fix(types): retarget the objectstack#4171 inverted pins at their real trigger (#3177) (#3194)
- fix(components,grid): a grid's search box searches the list, not the page you can see (#3118) (#3192)
- feat(core): declare the 18 spec-owned action keys ActionDef absorbed silently (#3190)
- fix(app-shell): actually compile `spec-symbol-parity.test.ts`'s type assertions (#3181) (#3187)
- feat(app-shell): wire navigation action items to the console action runtime (framework#4509) (#3180)
- feat(deps)!: upgrade to @objectstack/spec 17.0.0-rc.1 and retire the wait timeout fields (#3101) (#3178)
- fix(studio,timeline,list): 表单设计器解析对象翻译；timeline 认它自己配置的日期字段 (#3134, #3129) (#3175)
- feat(flow-designer)!: the script node authors a function call, and nothing else (framework#4343) (#3170)
- fix(studio): stop offering the retired `action.shortcut` / `action.bulkEnabled` keys (#3154)
- fix(dashboard): date 型 globalFilter 的预设名默认值应提升为区间 (objectstack#4475) (#3150)
- fix(dashboard,report): honor the declared percent scale so a ratio of 1 renders as 100.0% (#3136) (#3140)
- fix(charts): name the slices — pie/donut legends lost their labels to a `type` dimension (#3135) (#3138)
- fix(approvals): record-header Reject fires after one dialog again (#3126) (#3128)
- fix(console): binding-reach 探针少报了自己 6 个块的覆盖面，而且是静默的 (#3149) (#3153)
- fix(flow-designer): the default path is the edge marker, not the branch (#3148)
- fix(plugin-list,plugin-form): 在注册表路径上把 dataSource 接到 list-view / embeddable-form (#3144) (#3147)
- fix(actions): one placement rule for `locations` — declare it or it renders nowhere (#3145)
- fix(app-shell): datasource preview 不再报告读副本数量 (objectstack#4468) (#3143)
- feat(grid): aggregate single-call mode for bulk actions — execution: 'aggregate' (#3141)
- fix(form): `required` is presence, not truthiness — `false` and `0` are values (#3137)
- fix(environment): localize the entitlement dialog + read cloud's nested error envelope (#3130)
- fix(i18n): resolve qualified view ids (#3132)

objectui range: `7d9734d5e321...785b8a5d432c`
