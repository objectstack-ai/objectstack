---
'@objectstack/plugin-security': minor
---

fix(plugin-security): 堵跨租户 UPDATE 写 + org_admin 越 private 租户对象墙（security）

**安全修复 + 行为变更（release-notes callout）。** 修复 security review 确认的两个租户墙授权漏洞，两者同在 `security-plugin.ts` / `tenant-layer.ts` 的写侧热路径。多组织模式（`tenancy.mode='multi'` + `@objectstack/organizations`）下生效。

**Finding 1 [BLOCKER] — 经 UPDATE 重指 `organization_id` 的跨租户写。** #2937 的 Layer 0 insert post-image 检查（中间件 step 3.7）只管 insert。对称的 update 路径无人管：成员拥有 org A 的记录 R，对 R 发 by-id 或 bulk `update` 带 `{organization_id: 受害者 org B}`，即可把行**移动进任意租户**——auto-stamp（insert-only）、FLS、服务端未强制的 `readonly`、Layer 0 pre-image（只校验旧 org）、显式 RLS check 全部漏过。修法（Option B，最小面 + 与 insert 对称）：把 step 3.7 的 Layer 0 post-image 检查扩到 update，复用**同一套** Layer 0 决策（`computeWriteTenantCheckFilter` → `computeLayeredRlsFilter` 的 `layer0`）。一个**显式提供**的 `organization_id` 必须过 Layer 0（== 调用者活动组织），否则 fail-closed 拒绝——这令非平台用户上下文里 `organization_id` **事实不可变**（只有活动组织值能过，而 pre-image 已把目标锁在活动组织内，故重指到任何**其他**租户被拒）。缺省（不碰 org_id）的 update 不受影响；bulk update 的跨租户 change-set 也被堵。

**Finding 2 [HIGH] — org_admin 在 private 租户对象上越租户墙。** Layer 0 跨租户豁免门此前用「持有 `viewAllRecords`/`modifyAllRecords`」判定。`organization_admin`（自动授给每个 org owner/admin）经其 `'*'` 通配持有这两个超级位，于是在 `access.default:'private'` 的**租户业务对象**上触发豁免 → 零过滤 → 读写所有租户的行。修法：把 Layer 0 豁免门从「超级位」收窄为**真正的平台管理员判定**（`hasPlatformAdminPosture`：持有平台专属能力 `manage_metadata`/`manage_platform_settings`/`studio.access`/`manage_users`，即 `admin_full_access` 携带而 `organization_admin` 刻意不给的那组）。超级位继续只驱动 Layer 1 业务 RLS 短路（TENANT_ADMIN 组织内见全行、无所有权收窄）。因新豁免是旧门的严格子集，只会**收窄**、绝不放宽（fail-safe）。

**行为收窄（预期的安全收窄，需注意）：** org admin 不再在 private/platform-global/better-auth 的**租户**对象上越租户墙——它现在被 Layer 0 墙到自己的 org。真·平台管理员（`admin_full_access` + 平台 systemPermissions）仍豁免；better-auth 托管身份表 carve-out 不受影响（无 `organization_id` 列，Layer 0 本就 inert）。系统上下文（`isSystem`，含 import/迁移/seed 的合法跨组织移动）在中间件入口即短路，完全不受影响。

**为何不用 `ctx.posture` 作豁免门：** B2 已把 `PLATFORM_ADMIN` posture 落进 `resolve-authz-context.ts` 的 `ctx.posture`，但该字段**未被 plumb 进** enforcement 中间件收到的 ExecutionContext（rest-server 与 runtime dispatcher 都丢弃了它），直接消费会静默 no-op。改用平台专属能力探针，读的是 enforcement 已用的同一套 permission sets，覆盖所有入口，且天然 fail-safe。

矩阵门：`authz-matrix-gate.test.ts` 更新 `private_obj.org_admin` 格（read `null` → `{organization_id:'org-1'}`）并新增 `[Finding 1 …]`（8 格：成员重指异租户→拒、同租户→通过、不碰 org_id→放行、无活动组织→拒、org_admin 重指→拒、platform-admin private 对象→放行、public 对象→拒、单组织→不检查）与 `[Finding 2 …]`（5 格：org_admin private 对象读/写墙到本租户、真平台管理员仍豁免、org_admin public 对象回归、better-auth carve-out 不受影响）。授权一致性 ledger 更新 `multi-tenant-write-postimage`（覆盖 insert+update）并新增 `multi-tenant-exemption-posture`。关联 objectstack-ai/framework#2920。
