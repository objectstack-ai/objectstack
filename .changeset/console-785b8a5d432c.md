---
"@objectstack/console": minor
---

Console (objectui) refreshed to `785b8a5d432c`. Frontend changes in this range:

- fix(fields)!: FieldWidgetComponentProps stops claiming to have every key (#3221) (#3230)
- fix(app-shell): inspectors read and write the expression envelope (#3218) (#3228)
- fix(app-shell): flow simulator evaluates a `{ dialect, source }` edge guard (#3216) (#3217)
- feat(types,core,app-shell)!: follow the `managedBy: 'system'` → `'system-data'` retirement (objectstack#3355) (#3214)
- fix(app-shell): flow branch editor stamps an id on the edges it creates (#3202) (#3215)
- fix(plugin-detail): a fetching activity feed says "loading", not "No activity recorded" (#3205) (#3210)
- feat(plugin-detail): record:activity fetches a feed instead of rendering an empty one (#3165) (#3204)
- fix(types,app-shell)!: `reference` 是 action param 唯一可作者化的 picker 目标 (#3174) (#3203)
- fix(deps): #3184 可合并版 —— focus-scope 栈驱逐竞态补丁,解冲突 + 补丁存废说明 (#3200)
- fix(ci): never render a budget FAIL for a run that measured nothing (#3198)
- fix(core): 未知的 date filter 值改为跳过并警告,不再降级成永不命中的等值 (#3151) (#3196)
- fix(types): retarget the objectstack#4171 inverted pins at their real trigger (#3177) (#3194)
- fix(components,grid): a grid's search box searches the list, not the page you can see (#3118) (#3192)
- feat(core): declare the 18 spec-owned action keys ActionDef absorbed silently (#3190)
- fix(app-shell): actually compile `spec-symbol-parity.test.ts`'s type assertions (#3181) (#3187)
- fix(ci): hand the cross-repo token to github-script instead of requiring @actions/github (#3186)
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
