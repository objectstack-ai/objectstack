---
'@objectstack/cli': patch
---

fix(cli): the os validate / os build flow-region check never passes a flow it could not judge, and the boot banner counts flows refused at registration

Clause-②: no
Metadata-protocol: none

- **No silent pass.** The flow-region check `os validate` and `os build` run (the automation engine's registration verdict, ADR-0031) parses each flow with `FlowSchema` before it judges the regions. When that parse failed it used to skip the flow with no row, so the flow passed unjudged. It now refuses it with a `flow-region-shape-invalid` finding at the flow's `path`, naming the flow and the schema's issues. No authored stack reaches this branch today: the stack schema has already parsed every flow the check reads, and `FlowSchema` accepts its own output. Nothing refused or accepted today changes.
- **Refused flows in the boot banner.** When the automation engine refuses a declared flow at registration, boot still continues and the per-flow reason is still under Boot diagnostics. The `os serve` / `os dev` banner now also prints one line beside the declared count, for example `⚠ Flows:   2 flow(s) declared, 1 refused at registration`, read from the engine's own record (`getFlowRegistration`). It prints even when every declared flow was refused and nothing registered. A boot with nothing refused prints no such line.
