# 记录页与列表页 · 现状盘点与方案讨论 · 2026-10-27

读数来源：objectstack main `f9867020c6` 的 `packages/spec/src/ui/page.zod.ts`、`default-record-page.ts`、`ui/packages/app-shell/src/views/objectViewRecordNavigation.ts`、`ui/packages/plugin-detail/src/*`，HotCRM `src/sales/pages/*.page.ts`，以及本轮在 18.2.0 / main 控制台的实测。

## 一、记录页：现在有几套

| 层 | 形态 | 谁在用 |
| --- | --- | --- |
| 自动布局 | 对象没有记录页时，`plugin-detail` 的 `autoLayout` 按字段分组生成分区（列数按字段数推断，与表单一致），加上固定的 亮点区 / 阶段条 / 详情·相关·活动·历史 四页签 / 讨论 / 审批 / 附件 / 页脚 | 所有没写页面的对象（Setup 的 sys_*、AI 搭的 app.hcpl 全部） |
| `type: 'record'` + `kind: 'full'` | FlexiPage 式：`regions`（header / sidebar / main / aside / footer，模板 default / three-column）里放组件（`page:header`、`record:*` 块、相关列表…），`isDefault: true` 一对象只准一张 | HotCRM 的 lead_detail / opportunity_detail / account_detail |
| `type: 'record'` + `kind: 'slotted'` | 只填槽：`slots.details`（详情页签的正文）或 `slots.tabs`（整条页签带，二者互斥）、`slots.includes`、`slots.map`，其余沿用自动布局 | 少量包；AI 构建器倾向于生成它 |
| 命名记录页 | 同一对象可有多张非默认记录页，由动作 / 链接按名打开（objectui#12715） | 工作台类页面（account_workbench） |

三套能共存是对的（零配置 → 局部覆盖 → 全定制），问题在**三套的视觉骨架不是同一副**：自动布局是「亮点区 + 页签」，full 页是作者自己摆的 regions，slotted 是前者里换一块。同一个应用里线索（full）和任务（自动）长得不一样；AI 搭的应用全是自动布局，于是「记录页好不好看」等于「自动布局好不好看」。

## 二、列表进入记录：有几个入口

- 页面级 `recordAction: drawer | page | modal | none`（默认 drawer）；
- 运行时 `objectViewRecordNavigation` 实际支持 drawer / modal / split / popover / page 五种，抽屉用 `?recordId=` 作 URL 状态，带「展开为整页」；
- 没写 `recordAction` 时按 `deriveRecordSurface(objectDef)` 推断：字段多的对象整页，少的抽屉；移动端一律整页；
- 列表视图自己还有一层 overlay 个性化（列顺序、宽度、密度、行号、行内编辑），存成 sys_user_preference。

实测里 HotCRM 的线索 / 商机走整页（有 full 记录页），AI 搭的 app.hcpl 走对话框（`?recordId=`），Setup 的 sys_* 走整页。用户在一个产品里会遇到三种打开方式，而且哪种会出现取决于作者有没有写页面——这是「列表进记录有很多选项」的根源。

## 三、列表页：现状

- 一个 `list` 页 = 对象视图（grid / kanban / calendar / gantt / timeline / gallery 等视觉化，`interfaceConfig` 切换）+ 页头（标题、描述、新建 / 导入 / 动作、⋯）+ 视图页签（含「还有 N 个」折叠、添加视图）+ 工具条（筛选 / 排序 / 显示 / 搜索，已图标化）+ 页脚（计数、聚合）；
- 做得好的：视图页签、Display 菜单、看板全量与 Σ、分组单表头、页脚聚合、CSV 导入、批量动作；
- 短板：工具条图标化后筛选 / 排序状态只剩角标；没有列冻结 / 列拖拽 / 列宽记忆的统一手势；行内编辑是 Display 里的开关而不是单元格直接双击；行点击 = 打开记录，没有「选中 → 预览」的中间态；商机对象 10 个视图折进「还有 3 个」，视图没有分组 / 固定 / 个人与共享之分；移动宽度未设计。

## 四、方案（供讨论）

### 记录页

1. **一副骨架，三种填法**。把自动布局升级成「记录页 v2 骨架」：页头（标题 / 副标题 / 亮点 4–6 项 / 主次动作）→ 阶段条（读 option kind）→ 三栏主体：左 详情分区（可折叠）、中 时间线（活动 + 讨论 + 历史合流，按类型筛）、右 关联摘要（每个关联对象 3 条 + 查看全部）+ 审批 / 附件 / 元信息。`slotted` 的槽位就是这副骨架上的槽：`header`、`highlights`、`details`、`timeline`、`related`、`aside`；`full` 页依然可以从零摆，但默认模板从这副骨架开始。
2. **自动布局的分区来源要显式**：按字段 `group` 分区（没有 group 的字段进「其他」），空字段折叠保留；亮点区默认取 `nameField` 之外的前 4 个「关键字段」（对象可声明 `highlights: [...]`，没声明按：状态 / 负责人 / 金额或评分 / 日期）。
3. **宽度响应**：≥1280 三栏；1024–1279 两栏（关联摘要并入时间线上方）；<1024 单栏页签（今天的四页签就是这个档位）。
4. **去掉「页签 vs 常驻」的二元**：Details / Related / Activity / History 四页签只在窄档存在；宽档全部常驻。

### 列表进记录

5. **一个对象一个默认打开方式，由骨架决定而不是由字段数猜**：默认 `drawer`（右侧 560 px，带「展开为整页」），`page` 只给作者显式写 `recordAction: 'page'` 的对象；`modal` 退役（它和 drawer 的区别只是遮罩），`split` 和 `popover` 作为用户在 Display 里的个人偏好（像 Linear 的 side peek），不作为作者选项。移动端一律 page。
6. 抽屉里渲染的是同一副骨架的「窄档」，展开整页就是宽档——用户看到的是同一张记录页在两个宽度，不是两种页面。

### 列表页

7. **工具条状态回显**：筛选 / 排序有条件时，图标旁展开成「筛选 2 · 排序 1」芯片，点芯片可清除；无条件时保持纯图标。
8. **网格手感**：列冻结首列、列宽拖拽并记忆、列头右键菜单（排序 / 分组 / 隐藏 / 冻结）、单元格双击进行内编辑（不用先开开关）、Shift 多选 + 批量条浮在底部。
9. **视图管理**：视图页签支持「我的 / 共享」分组、钉住、重排，折叠的「还有 N 个」变成下拉搜索；视图上限 6 个可见。
10. **列表 → 记录的一致入口**：行点击打开抽屉，行首「↗」整页，Space 预览（popover）；三者在所有对象一致。
11. **移动档**：<768 列表变卡片列（nameField + 两列），工具条折成一个「筛选」按钮。

### 建议的推进方式

先出三张设计稿：记录页 v2 宽档（三栏）、记录页 v2 抽屉档（同一骨架）、列表页 v2（工具条状态、视图管理、网格手势）；你定稿后拆成 spec（slots / highlights / recordAction 收敛）、objectstack-ui（骨架、抽屉、网格）、hotcrm（lead/opportunity 页迁移到骨架）三组卡。
