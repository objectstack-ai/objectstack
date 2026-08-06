---
"@objectstack/core": patch
---

fix(core): `ObjectLogger` 的脱敏表按**词边界**匹配,不再按子串吃掉 `keys`/`tokens` 这类普通字段 (#5573)

`redactSensitive` 此前的判定是 `key.toLowerCase().includes(pattern)` —— 只要字段名
**含有** `password`/`token`/`secret`/`key` 子串,整个值就被换成 `***REDACTED***`。
于是 `keys`、`keyword`、`keywords`、`keyboard`、`monkey`、`tokens`、`tokenizer`、
`secretary` 全部中招:读者不但丢了事实,还被告知"这里挡住了一个秘密",比字段直接
缺失更误导。仓库里已经有活的命中 —— `dispatcher-plugin.ts` 为了躲开脱敏器特意把
`key` 改名成 `keyedBy`,而 `'keyedby'.includes('key')` 依然为真,那条限流日志的
`keyedBy` 一直是 `***REDACTED***`。

匹配语义 FROM → TO:

| | FROM(子串 `includes`) | TO(词边界) |
|:---|:---|:---|
| `apiKey` / `api_key` / `API_KEY` / `x-api-key` | 脱敏 | 脱敏(不变) |
| `apikey` / `APIKEY`(全小写连写) | 脱敏 | 脱敏(不变,见下) |
| `apiKeys` / `refresh_tokens`(复合词里的复数) | 脱敏 | 脱敏(不变) |
| `keys` / `tokens` / `keyword` / `monkey` / `secretary` | **脱敏** | **不脱敏** |
| `keyedBy` / `tokenizerName` | **脱敏** | **不脱敏** |
| `passwords` / `secrets`(裸复数) | **脱敏** | **不脱敏** |
| `api_key` 字段 + `redact: ['apiKey']` 配置 | **不脱敏** | **脱敏**(跨拼法命中) |

字段名按 camelCase / snake_case / kebab-case / 字母-数字边界分词后逐词比对。默认脱敏表
(`['password','token','secret','key']`)本身**没有变**,`packages/spec` 的 schema 默认值
也没有变 —— 变的只是这张表怎么用。

两个边角是显式取舍,不是遗漏:

- **全小写连写**没有词边界可分,`apikey` 分词后只有一个词。不能用"以 `key` 结尾"救,
  因为 `monkey`/`turkey`/`whiskey` 也以它结尾 —— 那正是本单要去掉的误报。所以连写只在
  前缀是一张显式限定词表(`api`/`access`/`refresh`/`client`/`private`/`session`/…)里的
  词时才算命中;表外的连写(`foobarkey`)不脱敏,按仓库命名惯例写成 `fooBarKey` /
  `foo_bar_key` 即可通用命中。只认**后缀**连写,所以 `secretary`、`keyword` 保持干净。
- **裸复数**是集合或计数而不是秘密(`keys` 来自 Zod 的 `unrecognized_keys` issue,
  `tokens` 来自 LLM 用量),按维护者裁决不脱敏;复数**出现在复合词里**时仍然是秘密
  (`apiKeys: ['sk-…']`),照常脱敏。确实要脱敏裸复数的 host,写
  `redact: [..., 'passwords']` 显式加回。

**影响面**:host 侧自定义 `redact` 配置的匹配行为随之收紧 —— 依赖子串宽匹配"顺手"挡住
某个字段的部署,需要把该字段名(或它的词)显式写进 `redact`。反向的收益是同一个词现在
跨拼法命中:配 `redact: ['apiKey']` 也会挡住 `api_key` 和 `apikey`。
