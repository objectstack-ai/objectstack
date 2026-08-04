---
'@objectstack/runtime': minor
---

**声明式端点的映射键:`inputMapping` / `outputMapping` 链内应用(#5040 E5c)**

两个键此前被 `ApiEndpointSchema` 声明、被 runtime 读取零次:作者写了、publish 放行、端点跑起来映射什么也不做 —— 正是 #5040 要消灭的「解析通过然后什么也不发生」中间态,也是 ADR-0049 `declared ≠ enforced` 的教科书形状(对 AI 写的元数据尤其糟:静默忽略的键不产生任何信号)。新纯模块 `api-mapping.ts` 是它们的唯一读者,语义**只**来自冻结词表的 describe 文本,取其最小忠实解读:

- **`inputMapping`(*Map Request Body to Internal Params*)**:`source` 按点路径读**请求体**,投影出目标入参;在策略链通过之后、委派之前应用,因此映射永远买不通 `authRequired` / `rateLimit`,而 `endpoint-executor` 保持纯委派、对映射无感知。词表只说 body,**query 不并入**(合并会凭空发明一条谁覆盖谁的优先级规则),query 照旧原样抵达管线。
- **`outputMapping`(*Map Internal Result to Response Body*)**:只作用于**成功**答案的载荷(`{success, data, meta}` 的 `data`),包络逐字保留 —— 声明改不动 `success`,也就无法把失败装扮成数据。401 / 429 / 400 / 501 一律不重映射。
- **映射是投影,不是合并**:结果只由声明的 `target` 组成,未声明的字段不随行。出站方向因此天然是一份 allow-list —— `apis` 是平台的对外面(ADR-0121 D3),默认泄漏内部字段不是可接受的缺省。
- **`source` 解析不到 ⇒ `target` 不写**(映射是投影不是校验器);**无声明 ⇒ 逐字节直通、按引用原样传递**,未声明映射的端点与 E5b 的行为完全一致。
- **无法服务的声明响亮拒绝**,不静默跳过、不半应用:`transform`(全仓无「transformation function name」注册表,发明它是沙箱裁决而非映射细节)、不可用路径(空串、空段 `a..b`、`__proto__` / `prototype` / `constructor`)、互撞的 `target`(同路径或一个写进另一个内部)—— 均为结构化 **501 NOT_IMPLEMENTED**(带处方,点名具体条目如 `inputMapping[1].transform`),与 `endpoint-executor` 的 `unsupported` 分支同类同形。`outputMapping` 的这道判定在**委派之前**做:投影坏掉的 `create` 不该先插入记录再拒绝作答。
- 新模块已加入 `error-envelope.conformance.test.ts` 的源码扫描名单。

**现网行为零变更**:非空 `apis:` 在 publish / validate 仍被硬拒(E7 #5111 前不撤),整条端点链结构性不可达。上述「不支持子集」应由 E7 的 publish 门在作者写应用时就拒掉,本模块是运行期兜底,不是主关口。
