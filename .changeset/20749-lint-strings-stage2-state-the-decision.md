---
'@objectstack/lint': patch
---

Data-model, filter, predicate, search, sort, security, seed, view, widget and registry findings no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

The remaining `@objectstack/lint` findings that `os validate`, `os lint` and `os build` show to authors, plus the `surfaceReason` texts of the exported `AUTHORING_RULES` registry and one integrity error, pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- Data model: the bare declared `unique: true` warning says that protocol 18 rejects the spelling and that stored metadata still carrying it converts to `unique: 'global'`, which builds the same physical index.
- Empty filter combinators: the `$and: []`, `$or: []` and empty-node messages say every backend reduces an empty combinator to its boolean identity; the `$or: []` message says an empty disjunction never opens a read scope to the whole table.
- Null guards: the fail-closed outcome says a predicate that cannot evaluate refuses the write rather than being skipped.
- Visibility and metadata-form predicates: the fall-open consequence says failing open is the console's settled behaviour; the dotted right-hand-side message says the form evaluator keeps its right-hand side a literal by design and says why only in a development build.
- Component props: the advisory hint says props are judged at the authoring door as a warning before they become an error.
- Rule schema formats: the format hint says `rule-validator.ts` registers the default `ajv-formats` set so that a `format` is enforced on every write.
- Security posture: the unset-OWD message describes the leave_request incident (an object with no `sharingModel` let an ordinary read/write grant read and edit every other user's records); the `controlled_by_parent` message says the write is refused as a metadata defect rather than a permission denial.
- Seeds and views: the seed state-machine message says a seed records established facts rather than walking the lifecycle; the `views:` container message says the stack schema, the rule and the registration loop hold `views:` to one container-only contract.
- React pages: the absent-`groupBy` hint states the ruling directly.
- Liveness: the unrecognised-status integrity error says such a status fails loudly rather than being graded `dead`.
- `AUTHORING_RULES` `surfaceReason` texts: the full-snapshot, capability-reference and sharing-rule reasons name the runtime publish gate (the Studio, REST and MCP door that runs this registry) in place of a tracker number; the advisory-volume reason says the object door opened to the gating object rules alone; the component-types reason names the crossing discipline the gating object rules went through.
- The other findings (search fields, sort fields, nav servability, dashboard actions, widget bindings and the remaining predicate and combinator messages) drop a citation the sentence already explained.

Text only: no rule id, severity, condition, finding or registry field moves. A tool or test that matches the old text (for example a tracker-number suffix) needs the new spelling.
