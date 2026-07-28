---
"@objectstack/spec": patch
---

feat(spec): register the 13 orphan dogfood proofs — five advance the ADR-0054 ratchet, eight say why they can't

The gate flagged 13 `@proof:` tags under `packages/qa/dogfood/test/**` that no
class in `proof-registry.mts` claimed. Silencing that warning is trivial and
worthless; the useful question is the one ADR-0054 §3 actually asks: **is there
an authorable property whose `live` status this proof gates?** Each of the 13 was
re-read against that.

**Five had one, and are now BOUND** — a `live` classification on these entries
requires its proof, so the ratchet advances from 10 bound paths to 17:

| Proof | Now gates | Why it qualifies |
|---|---|---|
| `attachments-permission-matrix` | `object.enable.files` | the #2727 opt-in gate proven in BOTH directions — the fixture carries a deliberate non-declaring object (`att_nofiles`) that must be refused 403 FILES_DISABLED |
| `showcase-d3-d4-capabilities` | `permission.rowLevelSecurity.check` | authors `check: 'owner == current_user.email'` and proves the write POST-image is validated (distinct from `using`, which filters the pre-image) |
| `showcase-scope-depth` | `permission.objects.readScope` | authors `unit` / `unit_and_below` profiles and proves the owner-match widens, with cross-BU still isolated |
| `owner-anchor-and-bulk-writes` | `permission.objects.modifyAllRecords` | member denied the transfer, privileged caller allowed — both directions |
| `semantic-roles-served` | `object.highlightFields`, `.stageField`, `.fieldGroups` | asserts all three survive defineStack → artifact → registry → REST verbatim (incl. `stageField: false` as a strict false) |

**Eight do not, and record why** rather than faking a binding — the shape the
registry already used for `permission-set-projection`:

- `flow-runas-schedule` and `showcase-scope-depth-fallback` guard properties
  (`flow.runAs`, `permission.objects.readScope`) that are *already* bound to a
  sibling proof. A ledger entry carries one `proof` ref, so a second gate on the
  same property is not representable — they run unconditionally instead.
- `me-apps-and-everyone-baseline` enforces `app.requiredPermissions` /
  `app.tabPermissions`; `app` is not a governed type yet. Bind when it lands.
- `showcase-agent-intersection` / `showcase-agent-scope-ceiling` guard runtime
  principal-resolution invariants (`onBehalfOf`, OAuth scope → ceiling set), not
  authorable metadata.
- `showcase-bu-hierarchy-sharing` / `showcase-declarative-rbac-seeding` act on
  stack-level `roles`/`sharingRules`, not a per-type property surface.
- `showcase-permission-zoo` is a breadth guard over the whole ADR-0090 surface;
  binding it to any one entry would misrepresent both.

**One deliberate non-binding worth naming.** `owner-anchor-and-bulk-writes` binds
`modifyAllRecords`, not the sibling `allowTransfer` — the proof only *mentions*
`allowTransfer` in a comment and never authors it. Binding a property a proof
does not exercise is the same false comfort as a preview renderer standing in for
a runtime consumer, which is the error this ledger spent #3686 unwinding.

Also verified the bound proofs actually run: the only `skipIf` among them covers
`attachments-permission-matrix`'s enterprise cross-tenant block, not the
FILES_DISABLED assertion the binding rests on.

The gate now runs with **zero warnings** — the orphan list joins the
stale-evidence list at empty, so both mean something again. The ledger README's
ratchet table was itself stale (5 classes listed, 10 bound) and is now complete,
with the unbound set and its reasons alongside.
