---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 元数据存储读不到不再被讲成「这一项不存在」(#5532)

`sys_metadata` 整体不可达时,`GET /api/v1/meta/object/acct` 会回一个「不存在」——
真相是「读不到」。两个事实的处置方向完全相反(去建一个 / 去修后端),而 Studio、
Setup 在元数据库故障期就是照前者渲染的:每一个对象都显示成「不存在」。

根因在产出方:`getMetaItems` / `getMetaItem` 的四处 customization-overlay 读各自
裹着一个裸 `catch {}`,注释写着 "DB not available" 然后照 miss 处理。空值一路穿过
读链,每个消费方给它起了一个不同却同样错的名字:

- `getMetaItemCached` → `Metadata item <type>/<name> not found`
- `?state=draft` → `NO_DRAFT` / 404「没有待发布的草稿」(发布流程读作「没什么可发的」)
- `getMetaItems` → `items: []`「这个环境一个都没声明」

ADR-0110 D3 已经为这件事立过规矩:miss 与 outage 是两个不同的事实、安全含义相反。
#5108 按这条修掉了 `DatabaseLoader` 的复数读,#5089 修掉了 `listForIndex`;本次是
同一条规矩在协议自己的 overlay 读上,单数与复数一并覆盖。

**改了什么**

1. **区分按错误类型判定,不按异常猜。** 唯一良性的读失败是「`sys_metadata` 还没被
   创建」——那时确实没有 overlay 行,落回 registry 就是真相,首次启动也不该爆炸。
   判定走 `isMissingTableError`,与 `DatabaseLoader`(#5108)、本包
   `SysMetadataRepository`(#4867)同一个谓词,一个驱动怪癖只教给平台一次。其余
   一律视为故障。
2. **故障照实上报。** 上抛 `status: 503` / `code: SERVICE_UNAVAILABLE`
   (`HttpStatusErrorCodeMap[503]`,ADR-0112 的标准目录码,不新造词汇),驱动原始
   错误挂在 `cause` 上。REST 层现有的 #5437 / #5464 消毒与日志口原样接住:客户端拿
   到 503 + code(文案按 5xx 规则withheld),运维在日志里拿到完整的驱动报文。
3. **终末 not found 结构化。** 真 miss 现在带 `status: 404` /
   `code: RESOURCE_NOT_FOUND`。

**wire 可见变化**(把错误答案改成对的答案):

| 场景 | 之前 | 之后 |
|---|---|---|
| 元数据存储不可达 | `404`/`400`/`500` 说「不存在」「没有草稿」「什么都没声明」 | `503` + `SERVICE_UNAVAILABLE`,可重试 |
| 真的没有这一项 | `500` + `INTERNAL_ERROR`(#5489 之前是 `400` 且内部措辞逐字上线) | `404` + `RESOURCE_NOT_FOUND` |

`sys_metadata` 尚未建表这一路径行为不变:仍旧落回 registry / MetadataService,
真查不到时回结构化 404。
