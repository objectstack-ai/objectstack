---
"@objectstack/plugin-auth": patch
---

A self-registration grant is refused, not silently redirected, when a permission-set row is malformed — and the fourteen dead `{ records }` / `{ data }` normalizer limbs behind that code are gone.

`plugin-auth` carried fourteen array-or-envelope normalizer blocks of the shape `Array.isArray(x) ? x : x.records ?? []` (thirteen on a `records` limb, one on a `data` limb, five of them written as a guard clause rather than a ternary). All fourteen read the same concrete engine — the `ObjectQL` instance the kernel registers as the `objectql` / `data` service — which answers a bare array on every path, populated or empty. The envelope limb was unreachable code that read as a contract, so the next author writing a defensive normalizer here believed an envelope was possible. The limbs are removed, and the four local engine ports that declared `Promise<unknown>` (`BootProbeEngine`, `DevAdminSeedProbeEngine`, `PhoneSmsTemplateEngine`) now declare the array they always returned.

The user-visible change is in `settleSelfRegistrationGrant`, which carried the opposite defect. Its candidate filter dropped any permission-set row whose `id` was missing or blank, silently, before choosing which row to grant:

- When the malformed row was the only one, the operator was told `no active sys_permission_set row named 'X' resolves` — false, since an active row named exactly that was present. That report is the only signal this path emits, and nothing retries it.
- When the malformed row was the **organization-scoped** one and a global row also carried the declared name, dropping it let the `organization_id == null` arm match instead, and the self-registrant was granted the **global** permission set their organization never declared — with a success log and no other trace.

`active !== false` remains a selection predicate: a deactivated set still reports the ordinary "does not resolve". A malformed row is no longer a selection at all — the grant is refused and the report names the malformed row, so the ambiguity is surfaced instead of resolved by accident. A well-formed family grants exactly as before.
