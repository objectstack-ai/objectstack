---
"@objectstack/plugin-audit": patch
---

**Docs (published README) + ruling:** record-view auditing now documents how to turn it on under `objectstack serve`, and the answer to "should `os serve` grow an `appAuditPluginOptions(config)` helper?" is **no** (#9863).

The README and `content/docs/permissions/record-view-auditing.mdx` both said the audited set is configured "where you compose the kernel", and the docs page went further: *"The CLI's `os serve` registers `AuditPlugin` with no options, so a stack served that way has record-view auditing off and no knob to turn it on."* That last clause stopped being true when #9864 declared and pinned the duplicate-registration contract. The knob is the stack's `plugins` array — a configured `new AuditPlugin({ readAudit: { objects: [...] } })` there supersedes the CLI's option-less instance by name, last-one-wins, on both kernels, with the displaced instance never reaching `init()`. Both pages now spell that path, and name the `Plugin superseded: 'com.objectstack.audit'` boot line as the opt-in working rather than a misconfiguration.

**No new configuration surface was added, deliberately.** A `config.audit` key read by an `appAuditPluginOptions(config)` helper would reproduce, in `objectstack.config.ts`, exactly the failure #8992's ruling refused for the object-metadata spelling: a declaration that survives in a deployment which never installs this package, reading as coverage while recording nothing. It would also be a *second* configuration surface that silently loses to the first, since an app's own `plugins` entry supersedes whatever the CLI constructed. The `#7001` symmetry argument does not carry it either — `@objectstack/verify`'s `bootStack` constructs no `AuditPlugin` and does not depend on this package, so there is no second boot path to disagree with.

No runtime behaviour changed. `packages/cli` gains only the reasoning at its registration site and `serve-audit-registration.contract.test.ts`, which pins the three facts the ruling rests on — including the load-bearing ordering (`AuditPlugin` registered above the stack `plugins` loop) that until now was asserted by a comment and nothing else.
