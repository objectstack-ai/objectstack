---
'@objectstack/spec': minor
'@objectstack/cli': patch
'@objectstack/skills': patch
---

feat(spec,cli,skills)!: behavioural metadata names stay short — spec declares the namespace address grammar, the AI face derivation and the namespace/object-name predicate, refuses a `_`-led name of a bucket 2/3 type, and `os lint` and the skills stop asking for the namespace prefix on flows, actions, pages, tools and the rest (ADR-0150 child P)

Clause-②: yes (narrowing) — `defineStack`, `os validate` and the schema-validated save path refuse a tool, skill, agent, flow, hook, connector, sharing rule, job, analytics cube or api endpoint whose `name` starts with `_`, which those ten name schemas used to accept (`^[a-z_][a-z0-9_]*$` → `^[a-z][a-z0-9_]*$`); the message names the router-reserved prefix (ADR-0150 D5). The widening half: `@objectstack/spec/kernel` exports the address grammar (`NAMESPACE_PATTERN`, `ENVIRONMENT_ADDRESS_SEGMENT`, `ROUTER_RESERVED_NAME_PREFIX`, `ROUTER_ADDRESSABLE_NAME_PATTERN`, `NAMESPACE_POSITION_LITERALS`, `NAMESPACE_REFUSED_LITERALS`, `validateNamespaceNotAddressLiteral`, `readNamespacePositionSegment`) and `findNamespaceObjectNameClashes`; `@objectstack/spec/ai` exports `deriveAiFaceName` with its four constants, `MCP_ACTION_NAMESPACE_MEMBER`, `McpActionNamespaceSchema` and `McpListedActionAddressSchema`. Nothing wires them to a door here.
Metadata-protocol: narrowed
Skills-docs: updated here — `skills/README.md` and `skills/objectstack-platform/SKILL.md` now say objects, docs, capabilities and positions carry the namespace and every other name stays short, with no `_`-led name; two eval expectations drop the prefix they asked for; `content/docs/ui/doc-pages.mdx` no longer says the lint holds every name to the prefix.

<!-- adr-0087: registered bucket-two-three-name-underscore-led-refused -->

**BREAKING** accept-set narrowing in `@objectstack/spec`: a `_`-led name of ten bucket 2/3 types is refused.

- **Before.** A tool, skill, agent, flow, hook, connector, sharing rule, job, analytics cube or api endpoint could be named `_sync`, because its name schema admitted a leading `_`. Every other bucket 2/3 type (action, app, page, permission set, …) already refused it through `SnakeCaseIdentifierSchema`.
- **Now.** Those ten refuse it too, at `defineStack`, `os validate` and wherever the body is parsed against its schema. A by-name door reads a `_`-led segment as the router's own (`_env` for an environment item, `_status`, `_activation`, `_drafts`), so an item spelled like one would be unreachable on the qualified address, or would shadow it. The save door's item-name grammar already refused a `_`-led name in the URL. Measured: no first-party item of the ten types is `_`-led, here or in HotCRM.
- **Not changed.** Every letter-led name parses byte-identically, prefixed (`crm_send_email`) or short (`send_email`). Object names, field names and flow variables keep their own grammars.

**The remedy.** Rename the item without its leading underscores (`_sync` → `sync`) and update every reference to it in the same change.

**Also in this change, not breaking.**

- **`os lint`** — `naming/namespace-prefix`'s bare-name warning now judges only capabilities and positions, the names that keep the literal prefix (ADR-0150 D1, D7). A short flow, action, hook, app, page, dashboard, report, dataset, permission set, tool, skill, agent or other bucket 2–4 name no longer warns, and a prefixed one stays valid. The intra-package duplicate warning is unchanged.
- **Skills** — the instruction to prefix every non-object name is retired. `os generate` still writes `<ns>_` names for its scaffolds; that spelling stays valid.
- **Spec helpers, unwired** — the address grammar the qualified doors will read (`/automation/:ns/:name`, `/actions/:ns/:object/:action`, `/meta/:type/:ns/:name`, the `_env` segment), the AI face derivation (`NS-NAME`, `OBJECT-ACTION`, an environment item's bare `NAME`; past 64 characters, 55 characters, `-` and 8 hex of FNV-1a 32 over the whole uncut face), the MCP `namespace` member for `run_action` and `list_actions`, and the predicate that refuses a namespace equal to an object name and an object short-named `custom`. The doors, the MCP server and the install gate adopt them in their own changes.
