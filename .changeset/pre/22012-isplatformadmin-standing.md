---
"@objectstack/spec": patch
---

`EvalUserSchema.isPlatformAdmin` is no longer marked deprecated. Its describe and docblock now say what the key reports: the `PLATFORM_ADMIN` standing of ADR-0095 D3.

Clause-②: no

- The platform resolves that standing per request, from the deployment's declared administrator list (`OS_PLATFORM_OWNER_EMAIL`) under every tenancy posture, or from an unscoped `admin_full_access` grant under the `single` posture.
- It is the predicate platform-operator gates read: `current_user.isPlatformAdmin == true` (ADR-0068 D4). The session payload emits it from the posture rung, and the platform-admin route gate reads it.
- The resolver projects the `platform_admin` name into `positions` from the same grant, so the name and the key agree for every genuine administrator. Gate on the key, never on `'platform_admin' in current_user.positions`.
- The old text, "DERIVED alias of 'platform_admin' in positions. Deprecated.", described a reading ADR-0095 D3 superseded. ADR-0068 carries dated notes under D2 and D4 that say so.
- ⛔ Nothing you author changes. There is no schema, type, optionality, default, export or accept-set change, and `createEvalUser` computes exactly what it did. A predicate that already reads `current_user.isPlatformAdmin` keeps working and is the supported form.
