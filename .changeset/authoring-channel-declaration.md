---
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
---

fix(metadata-protocol,objectql): the #4463 runtime authoring gate now runs on every kernel that has not declared itself the package author's channel (#6710)

The 26 shared author-time rules (`AUTHORING_RULES` — the same table `os validate`
/ `os build` / `os lint` run) were gated behind
`if (this.environmentId === undefined) return;`. That short-circuit was meant to
be ADR-0005's "the package author's own bootstrap channel" carve-out, and the
carve-out itself is legitimate. The key was not: `environmentId` is a ROW-SCOPING
key, and two very different topologies leave it undefined.

**The defect.** The CLI's lightweight host-config assembler — `serve.ts`'s
`config.objects && !hasObjectQL` auto-register branch, which constructs
`new ObjectQLPlugin()` with no options — also boots with no `environmentId`.
That is the shape any `objectstack.config.ts` with instantiated plugins gets
(`isHostConfig` → `shouldBootWithLibrary === false`), including the flagship
showcase app. Its `PUT /api/v1/meta/*` is an **end-user** surface, so a
self-hosted app server ran **zero** of the 26 rules on every publish. For a
Studio tenant or an MCP/AI author this gate is not the weakest of four doors —
it is the only one, because a `sys_metadata` overlay row is never in the CLI's
config file and there is no `os lint` for it. Measured at boot level: the kernel
reports `environmentId === undefined` and #4463's own broken-CEL approval flow
(`record.owner ==`) runs straight past the gate into persistence.

**The fix — the channel is declared, not inferred.** A new plugin option states
what a kernel *is*, and gate activation reads that instead of row scope:

```ts
new ObjectQLPlugin({ authoringChannel: 'package-author' })
createMetadataProtocolPlugin({ authoringChannel: 'package-author' })
```

`'environment'` (the default, and what you get by omitting the option) runs the
rules. `'package-author'` is the ADR-0005 carve-out and belongs only on the
genuine control-plane assembly — the kernel installing packages on the
platform's own behalf. The option is threaded through `assembleMetadataProtocol`,
the one seam both mounts share, so the built-in and delegated (ADR-0076 Step 2)
mounts cannot disagree.

**Omitting it means more enforcement, never less.** That direction is the point:
the failure mode being designed out is a future assembly variant nobody thought
about silently reopening this hole, which is exactly how the host-config
topology got here. It is also why the option is a channel NAME and not a
boolean — `skipAuthoringRules: true` would be the same bytes with the opposite
meaning, a switch for making a red publish go away. #5086 had already retired
the same proxy key for the code-only refusal, for the same reason.

**What changes for you.** A kernel that serves metadata writes to end users
should change nothing — it now enforces the rules it always should have. A
kernel that genuinely is a control plane must add `authoringChannel:
'package-author'`; until it does it runs gated in the safe direction, and the
existing per-write `OS_ALLOW_UNLINTED_METADATA_WRITES=1` hatch (#4463 D4)
degrades a refusal to a loud log. `environmentId` keeps every one of its other
jobs unchanged — the `environment_id` stamp and filter, the ADR-0005 overlay
whitelist, the #3050 authoring gate's scope, and local metadata-storage
provisioning. Only this one activation moved.
