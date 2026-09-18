// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'observability-cel-predicates-retired',
  surface:
    'metrics.slis[].successCriteria, the CEL predicate arm of the union (the structured '
    + '{ threshold, operator, percentile? } arm is untouched) / tracing.sampling.composite[].'
    + 'condition, the CEL predicate arm of the union (the structured filter arm is untouched). '
    + 'Both arms were reachable in two spellings: the bare-string shorthand and the '
    + '{ dialect: \'cel\', source } envelope. Reachable wherever metadata is authored or stored: '
    + 'defineStack sources, an exported stack passed to objectstack validate, a POST body on a '
    + 'metrics or tracing config, and a row already sitting in sys_metadata',
  replacement:
    'the structured arm each slot already carried, or your observability infrastructure. On '
    + '`successCriteria` write the threshold rule — `{ threshold: 300, operator: \'lt\', '
    + 'percentile: 0.95 }` — which is the shape an SLO product consumes. On a composite sampling '
    + '`condition` write a structured filter: a plain object of match criteria carrying no '
    + '`dialect` key, e.g. `{ service: \'api\', attributes: { \'http.route\': \'/v1/orders\' } }`. '
    + '⚠️ Neither replacement is mechanical, and neither is a like-for-like: a criterion or a '
    + 'sampling rule the structured shape cannot express has no home in application metadata at '
    + 'all and belongs in the SLO product or the OpenTelemetry sampler configuration that '
    + 'actually evaluates it',
  reason:
    'DECLARED, DOCUMENTED, AND EVALUATED BY NOTHING — which is why this is a semantic TODO '
    + 'rather than a mechanical strip. Both arms parsed, normalized a bare string to '
    + '`{ dialect: \'cel\', source }`, registered and were served back, and no service, plugin, '
    + 'runtime or CLI path ever read either key: an identity scan over the whole tree finds every '
    + 'hit for `successCriteria`, `ServiceLevelIndicatorSchema` and `TraceSamplingConfigSchema` '
    + 'outside `packages/spec/src` to be a generated artefact or prose, and inside it the only '
    + 'readers are the schemas\' own unit tests plus the two census tests that enumerate '
    + 'expression slots. So an author — very often an AI reading the generated reference page, '
    + 'ADR-0033 — who wrote `successCriteria: \'p95 < 300ms\'` got a green parse and no signal, '
    + 'indistinguishable from a predicate that ran and answered. ADR-0049 enforce-or-remove, '
    + 'ruled A by the maintainer on 2026-09-18 (director decision batch #160 item 3): by the '
    + 'standing criterion that a declared-but-unread capability is kept only when mainstream '
    + 'platforms in the domain have it, application platforms do not carry SLI success criteria '
    + 'or trace-sampling conditions as authorable application metadata — that lives in '
    + 'observability infrastructure (SLO products, OTel sampling policy) and is structured there, '
    + 'not a free expression. The `cron-declared-unwired` family was retired outright under the '
    + 'same ADR after the same measurement. A mechanical D2 strip was weighed and declined: a '
    + 'predicate is an intent no threshold/operator pair or attribute filter records, so '
    + 'stripping the key would delete what the author meant and leave no trace of which SLI or '
    + 'which sampling branch lost it — exactly the judgment a semantic TODO exists to hand back. '
    + '⚠️ And a strip here is not merely lossy, it is INVALID: `successCriteria` is a REQUIRED '
    + 'key, so removing it leaves an SLI that no longer parses, and a composite sampling branch '
    + 'that loses its `condition` declares no condition at all — inert today, and the moment a '
    + 'sampler is wired it reads as UNCONDITIONAL. That is the difference from the '
    + 'two error-map precedents this retirement copies its MECHANISM from — `crypto.hash` on '
    + 'HookBodyCapability and `managedBy: \'system\'` — both of which also registered a D2 '
    + 'conversion, because for each of them a mechanical rewrite existed. Here none does, which is '
    + 'what makes D3 the right disposition rather than merely an available one. '
    + '⚠️ The structured arm of each union is NOT decided here: it is equally unread today, and '
    + 'it is measured on its own card. ADR-0087, ADR-0058 D7, ADR-0049.',
  acceptanceCriteria:
    'Sweep every authored metadata source and every `sys_metadata` row of the metrics and '
    + 'tracing config types for a CEL predicate at the two slots — in BOTH spellings: a bare '
    + 'string, and an object carrying a `dialect` key. For each hit, decide per the `replacement` '
    + 'note whether the intent is expressible as the structured shape (write it) or belongs in '
    + 'your observability stack (delete the key and move the rule there). ⛔ Do not translate a '
    + 'predicate into a threshold by guessing the number — nothing was evaluating it, so there is '
    + 'no behaviour to preserve and a wrong number is worse than an absent one. Two proofs. '
    + '(1) `objectstack validate` is clean on a stack authored in config files: a surviving '
    + 'predicate is refused at the slot with the retirement prescription. ⚠️ TWO CHANNELS, and '
    + 'they do not cover the same set — measured, not assumed. `tsc` catches the BARE-STRING '
    + 'spelling at both slots, and the `{ dialect, source }` envelope at `successCriteria` only '
    + '(the structured arm is a closed object literal, so the envelope is an excess-property '
    + 'error). It does NOT catch the envelope at `condition`: the surviving arm there is a record '
    + 'of string to unknown, which admits `{ dialect, source }` structurally, so that one spelling '
    + 'compiles and is refused at PARSE by the arm\'s `dialect` rule. ⛔ Do not read a clean '
    + '`tsc` as a clean sweep of `condition`. The PRESCRIPTION divides differently again: it '
    + 'reaches the author for every refused spelling at `condition`, and for the string spelling '
    + 'only at `successCriteria`, where the envelope is refused by the structured arm\'s own '
    + 'missing-key issues (`threshold`, `operator`). All three legs are pinned in the schemas\' '
    + 'unit tests. (2) For stored rows, load the tenant and confirm every '
    + 'metrics and tracing config still rehydrates: a row carrying a predicate at either slot now '
    + 'fails its parse at the load seam and is reported there, naming the slot. A row whose '
    + '`successCriteria` is a structured rule and whose sampling `condition` objects carry no '
    + '`dialect` key parses byte-identically to before — the retirement removes accepted shapes '
    + 'and adds none.',
};
