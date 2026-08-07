---
"@objectstack/service-settings": patch
---

fix(service-settings): 写入路径与 env 路径执行 settings 声明的 min / max / minLength / maxLength (#5932)

`SpecifierSchema` 从存在起就声明了五类值约束 —— `pattern` / `min` / `max` /
`minLength` / `maxLength` —— 而 `SettingsService.validatePatch` 只读其中一类。
另外四个在整个写入路径上**没有任何读取点**:已发布的 manifest 里 42 个
specifier 声明了取值窗口,每一个都只是装饰。

落点最重的是 `auth.password_min_length`。它声明 `min: 6`,控制台的数字框也按这个
下限渲染,而 `PUT /api/settings/auth` 会接受 `1`(以及负数)并存下来,better-auth
的口令策略随后照这个值执行。也就是说,声明是唯一一个宣称「存在下限」的东西,却没有
任何一层在守它 —— 正是 Prime Directive #10 的正面形状。`ai.manifest.ts` 的六项
(temperature / max_tokens / timeout 等)同理。

**修法与 #5131(options 表)同形,是同一族的第三个成员:**

- `validatePatch` 补一个取值窗口分支,发既有码表里的 `FieldError`(ADR-0114 D2):
  `min_value` / `max_value` / `min_length` / `max_length` —— 与
  `record-validator.ts` 对同一类越界发出的码一致。`constraint` 带**完整窗口**
  (`{ min, max }`,长度类再带 `actual`),客户端据此自行组织文案,不必解析我方
  英文句子。⛔ `packages/spec` 未改动:约束早已声明,码表现有即够用。
- 沿用 #5131 的 **TOUCH 闸门**:只校验本次 patch 触及的键。取值窗口在产品生命周期里
  会被**收紧**(口令下限从 6 提到 8),窗口下方的老工作区必须仍能编辑它无关的设置,
  只在重写该键时才被告知。
- env 侧走 `effectiveEnvOverride` 这**一个**判定点,与 options 表同处,复用同一组
  比较函数 —— #5204 的成因就是同一比较有两份实现并各自漂移。因此
  `OS_AUTH_PASSWORD_MIN_LENGTH=1` 与写入路径得到同一个裁决:该 override 不生效、
  不贡献 cascade 条目、不锁定该键,并在注册时打出一条(且仅一条)`error` 日志。

**刻意不做的判断:** 取值窗口只裁决**可比较的值** —— `min`/`max` 只看数字(含经
JSON / 表单往返变成字符串的数字),`minLength`/`maxLength` 只看字符串。布尔、数组、
对象不做强制转换(`Number(true)` 是 1、`Number([])` 是 0):值的**形状**是
`invalid_type`,属于另一个约束、另一个负责人,在这里发明裁决会拒掉本检查从未被要求
过问的写入。空值仍归 `required` 管。

约束的读取以**声明**为准,而不是以 specifier 的 `type` 为准 —— 与旁边按类型收口的
options 检查不同,这个差异是 spec 定的:`SpecifierSchema` 的 superRefine 把 options
表**绑定**到 `select`/`radio`/`multiselect` 三型,却没有把四个窗口键绑定到任何类型。
在这里自拟一份类型清单,正是 options 注释警告的「第三份会漂移的清单」,并且会把本
issue 原样复制到下一层:窗口键声明在清单外的类型上,照样解析、照样渲染、照样不执行。
