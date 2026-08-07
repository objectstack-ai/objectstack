---
"@objectstack/spec": minor
---

feat(spec): `ProvisionEnvironmentResponse` 增加可选 `hostnameAssignment` —— 自动改名的响亮回执 (#5185)

环境的 canonical hostname 是 UNIQUE 的。provision 时若请求的 hostname 撞车,控制面不会让整个
调用失败,而是追加一小段后缀自动改名。改名以前**只体现在返回的 `environment.hostname` 上**——
调用方除非自己把请求的 hostname 存下来再逐字符比对,否则无从知道自己拿到的并不是自己要的那个。

`ProvisionEnvironmentResponseSchema` 新增可选字段:

```ts
hostnameAssignment: {
  requestedHostname: string;  // 调用方要的(显式传入,或由 displayName 推导)
  assignedHostname: string;   // 改名后实际分配的,等于 environment.hostname
}
```

**语义是「仅在真的发生了自动改名时才填充」**:没撞车、原样分配的调用完全不带这个键,因此
`hostnameAssignment !== undefined` 本身就是信号。⛔ 不要把「缺席」读成「未知」。

为什么必须声明在 spec、而不是控制面本地 extend(cloud#1070 方案 C,维护者已批):

- 控制面本地 extend 出来的是**未声明的兄弟键**,`z.object` 出站即剥离 —— 回执靠蒸发「合规」;
- 塞进自由格式的 `metadata` 袋:在 caller-wins 先例下,调用方可以压制、也可以伪造这个由服务端
  发出的信任信号;
- AI 生成的 provisioning 客户端按本协议已发布的表面(`api-surface.json`)生成 —— 字段不进
  spec 表面,生成出来的客户端永远不会去读它。

纯增量的可选字段:既有的 provisioning 响应(不带该键的)照旧合法,无需改动任何调用方。
