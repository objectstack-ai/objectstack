---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `diffMetaItem` folds its type at the request boundary and stops serving a history outage as an empty diff (#8868, #8833)

`GET /api/v1/meta/:type/:name/diff` is a routed live endpoint with a
caller-supplied `:type`. Two independent defects in that one method, fixed
together because they land in the same function.

**#8868 — the canonical fold.** `diffMetaItem` was the NINTH `/meta` entry point
on this URL family and the last one still deriving its type key from
`PLURAL_TO_SINGULAR`, the manifest-COLLECTION map that #7894 moved this boundary
off (#8769 routed `publishMetaItem`, #8819 routed `rollbackMetaItem`). It now
routes through `canonicalizeMetaRequestType`, which changes three things:

- **the answer.** For the four MANIFEST-ABSENT types — `field`, `seed`,
  `external_catalog`, `translation`, legitimately absent from that map because
  they are not stack collections — a plural spelling stayed plural all the way
  into the `sys_metadata_history` query, matched no row, and the endpoint
  answered a well-formed **empty diff** (`added: []`, `removed: []`,
  `changed: []`) for an item that does have history. Not a refusal and not an
  error: a silent "nothing changed". Manifest-present types (`views` → `view`)
  folded already and were never affected.
- **unrecognised spellings.** The #7894 boundary refusal never ran on this verb,
  so a spelling like `viewes` was forwarded to the plugin path instead of
  refused. It is now `400 INVALID_REQUEST`, naming both accepted spellings. The
  refusal stays narrow by construction: a name that reaches for no declared type
  (a possible plugin kind) is still served.
- **the echoed `type`.** The response echoed the caller's spelling back while the
  read had used a different key. It now reports the canonical spelling — the
  precedent `saveMetaItem` and `deleteMetaItem` already set, both of which
  `return { type: request.type }` after their own fold.

**#8833 — the swallowed outage.** The history read sat in a `try` whose `catch`
was empty apart from a comment. `histRows` stayed `[]` and the code below read
that never-filled accumulator as a real answer, so a `sys_metadata_history`
outage was served as a successful 200 with an empty diff — byte-identical to
"these two versions are the same", with no log line either. An operator
comparing versions before a rollback, and any SDK or agent reading this
endpoint, acted on "unchanged" with full confidence.

Per the maintainer ruling on #8833, the `catch` now routes through the
platform's existing discrimination, `rethrowUnlessMetadataStoreUnprovisioned`:

- a **genuinely absent table** — a minimal deployment that never provisioned
  history — keeps its benign empty answer, so first boot does not explode;
- **every other read failure** (connection drop, timeout, permission denial,
  query error) propagates `503 SERVICE_UNAVAILABLE`, carrying the driver error
  as `cause`. ADR-0110 D3: a miss and an outage are different facts. This is the
  same guard #5532 restored for `getMetaItems`.

⚠️ **Behaviour change worth reading before upgrading.** This ADDS loudness where
there was none. PR #8841 had removed the last path that threw here, so as of
that change the outage was silent for *every* type; a diff whose history store
is unreachable now returns 503 where it previously returned 200 with an empty
diff. A diff against a deployment that never provisioned `sys_metadata_history`
is unaffected. No response field was added — a `historyUnavailable` key was
considered and declined.
