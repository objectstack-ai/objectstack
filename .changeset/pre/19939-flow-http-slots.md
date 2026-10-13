---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': patch
---

An `http` node reads each config key by what it is now. Its `url` and every `headers` value are text slots, like a notify `title`: they render `{{ }}` holes, `'https://api.example.com/v1/orders/{{ record.id }}'`. Its `body` is a value slot: a CEL value envelope, `{ dialect: 'cel', source: "{'id': record.id, 'status': dyn('done')}" }`, that the executor evaluates in the run's scope to the payload, or a literal sent as written. Its `method`, `durable`, `timeoutMs` and `signingSecret` are literals, read as written. A single-brace `{…}` token at any of them is refused, naming its `{{ }}` spelling at a text slot, its CEL spelling in the body, and at a literal the remedy to write the value: at `objectstack validate`, at `registerFlow` and by the executor, except at `signingSecret`, which the build doors leave to the run because the flow credential store may hold the secret it signs with, and which the executor's parse refuses there.

Clause-②: yes (narrowing: a {…} token is refused at http url, each headers value, any string of a literal body, method, durable, timeoutMs and signingSecret, and as a whole headers map, and a body value that names a dialect must be a valid CEL value envelope; widening: the exported FlowNodeTextSlot type gains the optional eachValue field, LEDGER_DECLARED_NODE_CONFIG_SCHEMAS gains http, and the published HttpConfig JSON Schema marks body as a value slot)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused, flow-text-slot-single-brace-refused, flow-text-slot-unbound-dollar-root-refused, flow-builtin-node-config-values-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff: its surface widens to an http node's body and to its four literals, and its replacement, reason and acceptance criteria say what the body evaluates to and that a literal takes the value itself. The two text-slot D3 entries widen their surface to the http node's url and headers values, and the builtin-values D3 entry stops saying that http parses after interpolating. No new D3 entry and no D2 conversion: an absent value in the body wrote null or nothing under the template and fails the run under CEL, a whole token at timeoutMs or durable resolved to its value's type under the template and is read as text now, and a Date in a url or a header rendered JSON-quoted under the interpolator and as its ISO text under the template engine. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 2 makes a computed value whole-field CEL, and Decision 3 deletes the single brace; a url and a header are text. Until now the executor handed its whole config to the single-brace interpolator and parsed the result, so every key read the retired dialect, a whole token in a typed key (`timeoutMs: '{t}'`) resolved to its value's type, and a CEL envelope written as the body was sent to the endpoint as the object it spells.

**The request is rendered once.** The executor parses the config as authored — after the flow credential store's `signingSecret`, unchanged — then renders the url and the headers and evaluates the body, before either mode. The durable outbox enqueues exactly the request the inline call would send, and nothing renders at delivery.

**What changes where a value may be absent.** A url that renders to no text refuses the node, as an empty one did. A header that renders to no text is not sent, where the template sent it empty. In the body an absent variable or key fails the run under CEL, naming it, where the template wrote `null` for a whole token and nothing inside text; guard a value that may be unset, `has(record.owner) ? record.owner : null`. CEL holds a map's values to one type, so in a CEL map literal a literal or a text beside a field read is wrapped in `dyn(…)`.

**The literals.** `method`, `durable`, `timeoutMs` and `signingSecret` passed through the interpolator too, but no shipped flow computed one: the census found no `{…}` token at any of them in this repository's examples, docs or dogfood fixtures, only in the tests that pinned the interpolation itself. So no value slot is built there. They are read as written, and a `{…}` token in one is refused with the literal's remedy; an envelope there is refused too, since nothing evaluates it. A token written as the whole `headers` map, which the template resolved to a map, is refused the same way. A signing secret that arrived through a template (`signingSecret: '{signing_key}'`) is refused: write the secret itself, which a flow saved through the metadata API keeps in the write-only flow credential store, or `''` to send unsigned on purpose.

**What does not change.** Every literal is sent as written. The method still defaults to `GET` inline and `POST` durable. An authored `signingSecret: ''` still sends unsigned, and a secret the credential store holds still takes the literal's place. A url or header with no token, and a body with no token, behave as before.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `url: 'https://api.example.com/v1/orders/{record.id}'` | `url: 'https://api.example.com/v1/orders/{{ record.id }}'` | a `Date` in the url renders as its ISO text, not JSON-quoted |
| `headers: { 'X-Ref': 'r-{record.id}' }` | `headers: { 'X-Ref': 'r-{{ record.id }}' }` | a header that renders to no text is not sent |
| `body: { id: '{record.id}', status: 'done' }` | `body: { dialect: 'cel', source: "{'id': record.id, 'status': dyn('done')}" }` | an absent `id` fails the run instead of sending `null` |
| `body: { text: 'Done: {record.title}' }` | `body: { dialect: 'cel', source: "{'text': 'Done: ' + record.title}" }` | an absent `title` fails the run instead of sending `'Done: '` |
| `body: '{payload}'` | `body: { dialect: 'cel', source: 'payload' }` | an absent `payload` fails the run instead of sending no body |
| `timeoutMs: '{timeout}'`, `durable: '{flag}'`, `method: '{verb}'` | the value itself: `timeoutMs: 5000`, `durable: true`, `method: 'POST'` | the key is a literal now; nothing computes it |
| `headers: '{headers}'` | the map itself: `headers: { 'X-Ref': '{{ record.id }}' }` | a map is not computed into `headers` |
| `signingSecret: '{signing_key}'` | the secret itself, or `''` to send unsigned | a secret read from a flow variable is refused at the run |

**The one-line fix: double the braces in `url` and the `headers` values, write `body` as one CEL value envelope that builds the payload, and write `method`, `durable`, `timeoutMs` and `signingSecret` as the values themselves.**

**Who is affected, measured.** In this repository, at the base: the showcase example (three bodies holding four tokens) and the flows guide (one body); both are migrated in this change. No url, header, method, `durable`, `timeoutMs` or `signingSecret` in the examples, docs or dogfood fixtures carries a token. hotcrm was not measured at these keys.

**Newly refused in the body.** An object naming a `dialect` was data before and was sent as written; it is an expression now, evaluated per run, and a malformed one is refused. An envelope nested inside a literal body is still data, sent as written.

**Still accepted, unchanged.** Every literal at these keys, and the published shapes of `url` (a string), `headers` (a map of strings), `method`, `durable`, `timeoutMs` and `signingSecret`. The single-brace dialect keeps resolving where it still lives, a CRUD `filter` value.

### The kit

- **The contract.** `HttpConfigSchema`: `url` and each `headers` value refuse a single-brace token through the text-slot judge; `body` takes `FlowValueSlotSchema`; `method`, `durable`, `timeoutMs` and `signingSecret` keep their literal types, and the contract refuses a token or an envelope there with the literal's remedy. The token refusals at `method`, `durable`, `timeoutMs` and a whole `headers` map are marked read-as-written, so the build doors' value arm reports them at `FlowSchema.parse`, `objectstack validate` and `registerFlow` as the executor's parse does. Each `describe()` is restated.
- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS` gains the `http` body row. `FLOW_NODE_TEXT_SLOTS` gains `http.url` and `http.headers`, whose new `eachValue` flag reads each value of the map at its own path (`headers.X-Ref`). `HttpConfigSchema` joins `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`, which carries the body's marker to the reconciliation ratchet. The build doors' carve-out for a config parsed after interpolation is gone with the interpolation.
- **The executor.** The `http` node parses its config as authored, renders the url and headers through the text renderer, evaluates the body through the shared value-slot resolver, and reads the literals as written; it no longer imports the single-brace interpolator.
- **The lint.** The `flow-double-brace-interpolation` hint names the http url and headers among the text slots, and at an http literal both wrong-syntax hints say that neither brace dialect resolves there and name the value itself; `objectstack validate` refuses a token at each position through the value-slot and text-slot judges and the contract.
- **ADR-0087.** The step-18 D3 entries `flow-value-slot-template-dialect-refused`, `flow-text-slot-single-brace-refused`, `flow-text-slot-unbound-dollar-root-refused` and `flow-builtin-node-config-values-refused` are amended. No key is removed, so there is no tombstone, and there is no D2 conversion.
