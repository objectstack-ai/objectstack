---
'@objectstack/runtime': minor
---

fix(runtime)!: an action that dispatches to a handler another declared action owns also answers with that owner's permission and activation gates

Clause-②: no (narrowing) — the REST `POST /api/v1/actions/:object/:action` door and the MCP `run_action` tool refuse a `script` action whose dispatch reaches a handler that a different declared action's own dispatch reaches, when the caller lacks that action's `requiredPermissions` (403 `PERMISSION_DENIED`) or that action is switched off (409 `ACTION_DISABLED`), and while the metadata store cannot be read they refuse 503 `SERVICE_UNAVAILABLE` a call reaching a handler built from another stored declaration; both doors answered such a call with the handler's result before. Nothing is widened, and no schema or authorable key moves.
Metadata-protocol: semantic
Skills-docs: none — `skills/**` teaches `target` as a registered function name and `requiredPermissions` as an action's own gate, and neither statement changes; the rule is documented in `content/docs/ui/actions.mdx` in this change.

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, value or export is removed or renamed; an action declaration parses and saves exactly as before, and only which gates its dispatch answers to grows -->

**BREAKING** narrowing at the two action-dispatch doors (`@objectstack/runtime`).

- **The rule.** A handler entry belongs to every declared `script` action whose own dispatch reaches it — through its `target`, or through the handler its `body` registered under its name. When a call reaches an entry that a different declaration owns, that declaration's `requiredPermissions` and its packaged-action switch apply on top of the invoked action's own: the caller needs both sets, and the switch of either turns the call off. The handler does not run on a refusal, and nothing about the request is read first.
- **An unreadable metadata store.** While the metadata store cannot be read, a call reaching a handler that was built from another stored action declaration is refused 503 `SERVICE_UNAVAILABLE`, because that declaration's gates cannot be checked; a handler a package or code registered, and an action's own stored handler, keep running.
- **What counts as "different".** A declaration is its owning object and its name, so one declaration carried both inside its object and as a standalone item is one owner, not two. Two objects that each declare a same-named action are independent while each object has its own handler.
- **Not changed.** An action with its own handler key answers exactly as before, and so do `flow`, `api` and declarative-update actions, which dispatch through no handler entry.
