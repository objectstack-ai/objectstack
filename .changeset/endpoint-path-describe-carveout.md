---
'@objectstack/spec': patch
---

**`ApiEndpointSchema.path` 的 `.describe()` 换成 carve-out 形状的示例(#5310)**

这段文案过去是 `URL Path (e.g. /api/v1/customers)`。ADR-0121 D1 把声明路径收紧为
`运行前缀 + /apps/ + 命名空间 + 子路径`(`appEndpointMountPrefix()` =
`/api/v1/apps/<namespace>/`),publish 门 `namespaceGate` 对 carve-out 之外的路径直接拒绝
—— 也就是说,**词表自己举的例子,publish 会当场拒**。

**为什么现在要紧。** #5271 之前 `api` 没有注册 schema,`/meta/types` 不为它出 JSON Schema,
Studio 只能给一个 raw-JSON 文本框,这段 `.describe()` 没有渲染面。#5271 之后它成为
metadata-admin 端点表单里 `path` 字段的说明文字,并进入生成的 JSON Schema —— 于是一段会被
拒绝的示例,变成了作者(按 ADR-0033,常常是 AI 作者)照抄的第一手提示。

**新文案**给出 carve-out 形状 `/api/v1/apps/<manifest.namespace>/<subpath>`、一个具体示例
`/api/v1/apps/crm/leads`,并说明命名空间段派生自 `manifest.namespace`(ADR-0121 D2)而不是
作者的自由字段。措辞直接复用 `endpoint-publish-gate.ts` 里 `namespaceGate` 的拒绝文案,
没有新发明判据 —— 作者在表单里读到的,和被拒时读到的,是同一条规则。

**只改了文案。** schema 结构、`/^\//` 正则、门逻辑一律未动:`path` 仍是一个以斜杠开头的
字符串,carve-out 仍然只由 publish 门(和运行期匹配器)判定。因此这不是破坏性变更,今天能
发布的声明明天照样能发布。

`ApiMappingSchema` 的三条 `.describe()` 逐条复核后**保持原样**:`source` / `target`
(*Source field/path* / *Target field/path*)不举例,也没有说错;`transform`
(*Transformation function name*)描述的键确实会被门整键拒绝,但那属于「词表冻结后,被拒键
是否应在表单里自陈」的另一类问题,已另行归档,不在本次文案修正内。

配套:`packages/spec/src/api/apis-publish-gates.test.ts` 新增一条断言,把 `.describe()` 的
文本**读回来**再喂给门 —— 文案里出现的每个具体示例路径都必须在它自己命名的命名空间下通过
`validateApiEndpointDeclarations`。把一个会被拒的路径写回 `.describe()`,这条测试就红。
