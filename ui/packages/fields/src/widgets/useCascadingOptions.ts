import { useMemo } from 'react';
import {
  resolveCascadingOptions,
  type CascadingOptions,
  type OptionLike,
  type DependsOnInput,
} from '@object-ui/core';
import { usePredicateScope } from '@object-ui/react';

/**
 * Shared per-option cascading / role-gating resolution for the option widgets
 * (`SelectField` single, `MultiSelectField`, `RadioField`) — the client half of
 * ADR-0058 (#2284). Each option may carry a `visibleWhen` CEL predicate; the
 * offered set narrows against the live form record (`record.country == 'cn'`) +
 * the global predicate scope (`'admin' in current_user.positions`). A field
 * declares which sibling fields drive its list via `dependsOn`; while any is
 * empty the list is *gated* — callers surface a "select the parent first" hint
 * rather than an unfiltered set, mirroring the dependent-lookup UX.
 *
 * This is the React wrapper: `record` (the live form values) arrives on the
 * `dependentValues` argument its HOST passes, the predicate scope comes from
 * context, and the actual resolution is the pure
 * {@link resolveCascadingOptions} in `@object-ui/core`, shared with the form
 * renderer so gating/filtering can never drift between them (#2715).
 */
export type CascadingOptionsResult<T extends OptionLike> = CascadingOptions<T>;

export function useCascadingOptions<T extends OptionLike>(
  rawOptions: readonly T[],
  dependsOn: DependsOnInput,
  dependentValues: Record<string, unknown> | undefined,
): CascadingOptionsResult<T> {
  // Live form values for cascading options — supplied by the host on
  // `dependentValues` (the same channel dependent lookups use; the form
  // renderer passes its live watched record). `current_user` etc. come from the
  // global predicate scope so role/context predicates resolve too.
  //
  // There is NO context fallback, and this note used to say there was one —
  // "the record on SchemaRendererContext". No such record ever existed:
  // `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
  // `debugFlags` / `apiFetch`, so the `?? ctx.formValues ?? ctx.data` tail this
  // chain used to carry was unsettable rather than merely unset — no host can
  // populate a member the type does not declare — and it resolved `{}` for
  // every host. It was retired under ADR-0049 enforce-or-remove (objectui#7206,
  // maintainer ruling 2026-09-18). ⛔ Do not re-add one: reached without
  // `dependentValues` an option list declaring `dependsOn` stays gated, and
  // that visible gate is the diagnostic — the host that owns the record
  // passes it.
  const record = useMemo<Record<string, unknown>>(
    () => (dependentValues ?? {}) as Record<string, unknown>,
    [dependentValues],
  );
  const predicateScope = usePredicateScope();

  return useMemo(
    () => resolveCascadingOptions(rawOptions, record, dependsOn, predicateScope),
    [rawOptions, record, dependsOn, predicateScope],
  );
}
