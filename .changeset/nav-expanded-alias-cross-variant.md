---
"@objectstack/spec": patch
---

fix(spec): 导航项的四条「展开」别名不再把作者指向该变体同样拒绝的键 (#5555)

`expanded` 只声明在 `group` 导航变体上,但 `defaultOpen` / `open` / `collapsed` /
`isOpen` 这四条别名写在 `NAV_ITEM_ALIASES` —— 一张被盖进全部九个变体的共享表。于是在
另外八个变体上,报错把作者指向一个下一步同样会被拒的键:

1. 写 `{ type: 'url', url: '/x', defaultOpen: true }`
2. 得到 ``Did you mean `defaultOpen` → `expanded`?``
3. 照做改成 `expanded: true`
4. **再次被拒**,而且第二次没有任何建议

这正是 #4001 战役要消灭的那个失败模式(ledger finding 7 的「二次拒绝」),由该战役
自己的修复产生。

四条别名已挪进**按变体拼装**的那一段:`group` 保留裸键名重定向(`expanded` 在它身上
是真键),另外八个变体改用散文 target —— 与同一段里既有的六条跨变体别名同形:

```
Did you mean `defaultOpen` → `type: 'group' (with expanded)`?
```

**只改面向作者的报错文案,schema 形状没有变化**:接受与拒绝的键集合、类型、默认值
全部不变,已有的元数据不受影响。`group` 上的四条别名行为也不变。
