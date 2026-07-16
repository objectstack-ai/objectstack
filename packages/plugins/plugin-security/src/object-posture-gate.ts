// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OWD posture authoring gate for the `object` metadata type (#3050).
 *
 * Registered on the metadata protocol's pre-persistence authoring-gate seam
 * (ADR-0094 addendum; `registerAuthoringGate`), so it fires on EVERY
 * runtime-authored object body — Studio drafts, direct REST saves, AI
 * builders — regardless of which HTTP surface produced the write. It closes
 * the two posture rules that were previously CLI-lint-only
 * (`packages/lint/src/validate-security-posture.ts` runs at `os compile` /
 * `os lint`, never on `saveMetaItem`):
 *
 *  - **R1 — env-tighten-only (ADR-0086 D1, ADR-0049).** An environment write
 *    over a PACKAGED object (artifact-backed — reachable only via the
 *    `OS_METADATA_WRITABLE=object` escape hatch, since `object` ships
 *    `allowOrgOverride:false`) may not set `sharingModel` /
 *    `externalSharingModel` WIDER than the packaged declaration. Widening
 *    legitimately = author it in the package source and publish (ADR-0090
 *    D7), never an env overlay.
 *  - **R2 — external ≤ internal (ADR-0090 D11).** Any object write must keep
 *    `externalSharingModel` no wider than `sharingModel`. Previously stated
 *    only in `.describe()` prose (`object.zod.ts`) and the lint rule
 *    `SECURITY_EXTERNAL_WIDER`.
 *
 * Deliberately write-path only — no zod refine, so grandfathered stored
 * metadata keeps loading (the ADR-0090 D1 lesson: never change behavior of
 * data at rest, gate the new writes). `controlled_by_parent` is excluded
 * from ordering on either side (it inherits the master's pair), mirroring
 * the lint's `OWD_WIDTH` semantics.
 */

/**
 * D11 openness ordering — mirrors `OWD_WIDTH` in
 * `packages/lint/src/validate-security-posture.ts` (`controlled_by_parent`
 * deliberately absent: it inherits the detail-master's pair and cannot be
 * ordered locally).
 */
const OWD_WIDTH: Record<string, number> = {
  private: 0,
  public_read: 1,
  public_read_write: 2,
};

function widthOf(value: unknown): number | undefined {
  return typeof value === 'string' ? OWD_WIDTH[value] : undefined;
}

function postureError(code: string, message: string): Error {
  const err = new Error(`[${code}] ${message}`);
  (err as any).code = code;
  (err as any).status = 403;
  return err;
}

/** Context subset of the protocol's MetadataAuthoringGateContext this gate consumes. */
export interface ObjectPostureGateContext {
  type: string;
  name: string;
  body: unknown;
  isArtifactBacked: boolean;
  declaredBody?: unknown;
}

/**
 * The gate. Throws 403 `owd_external_wider` / `owd_widening_forbidden` to
 * reject the write; returns silently when the body passes.
 */
export function objectPostureGate(ctx: ObjectPostureGateContext): void {
  const body = ctx.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return;

  const internal = body['sharingModel'];
  const external = body['externalSharingModel'];
  const wInternal = widthOf(internal);
  const wExternal = widthOf(external);

  // R2 — ADR-0090 D11: external ≤ internal. Both sides must be orderable
  // canonical scalars; `controlled_by_parent` (or an unset side) is skipped,
  // mirroring the lint's SECURITY_EXTERNAL_WIDER rule. An unset internal on
  // a custom object resolves to `private` at runtime (ADR-0090 D1), so an
  // explicit external wider than that is also caught.
  const wInternalEffective = wInternal ?? (internal == null ? OWD_WIDTH['private'] : undefined);
  if (wExternal !== undefined && wInternalEffective !== undefined && wExternal > wInternalEffective) {
    throw postureError(
      'owd_external_wider',
      `object/${ctx.name}: externalSharingModel '${String(external)}' is wider than sharingModel `
      + `'${String(internal ?? 'private (default)')}' — external must be ≤ internal (ADR-0090 D11). `
      + `Tighten externalSharingModel or widen sharingModel in the object definition.`,
    );
  }

  // R1 — ADR-0086 D1: an environment may only TIGHTEN a packaged object's
  // posture. Applies only to overlay writes over an artifact-backed object
  // (the OS_METADATA_WRITABLE escape-hatch path — the default deploy already
  // 403s these before this gate runs).
  if (!ctx.isArtifactBacked) return;
  const declared = ctx.declaredBody as Record<string, unknown> | null;
  if (!declared || typeof declared !== 'object') return;

  // Baseline widths. An undeclared internal baselines to `private` (the
  // ADR-0090 D1 default for custom objects — fail-closed: an env overlay of
  // an OWD-less packaged object may not introduce a wider posture); an
  // undeclared external baselines to `private` (the D11 default).
  // `controlled_by_parent` on either side of a comparison skips that
  // comparison (not orderable locally).
  const declaredInternal = declared['sharingModel'];
  const declaredExternal = declared['externalSharingModel'];
  const wDeclaredInternal = widthOf(declaredInternal) ?? (declaredInternal == null ? OWD_WIDTH['private'] : undefined);
  const wDeclaredExternal = widthOf(declaredExternal) ?? (declaredExternal == null ? OWD_WIDTH['private'] : undefined);

  const violations: string[] = [];
  if (wInternal !== undefined && wDeclaredInternal !== undefined && wInternal > wDeclaredInternal) {
    violations.push(`sharingModel '${String(internal)}' > declared '${String(declaredInternal ?? 'private (default)')}'`);
  }
  if (wExternal !== undefined && wDeclaredExternal !== undefined && wExternal > wDeclaredExternal) {
    violations.push(`externalSharingModel '${String(external)}' > declared '${String(declaredExternal ?? 'private (default)')}'`);
  }
  if (violations.length > 0) {
    throw postureError(
      'owd_widening_forbidden',
      `object/${ctx.name}: an environment overlay may only TIGHTEN a packaged object's OWD, never widen it `
      + `(${violations.join('; ')}). Widen it in the package source and publish through the package pipeline `
      + `(ADR-0090 D7) instead of an environment overlay (ADR-0086 D1).`,
    );
  }
}

/**
 * Wire the gate onto the protocol. Feature-detected like
 * `registerPermissionSetProjection` — a protocol that predates
 * `registerAuthoringGate` (older embeddings, unit-test stubs) simply keeps
 * the legacy behavior (CLI lint remains the only guard there). Returns
 * `true` when wired.
 */
export function registerObjectPostureGate(protocol: any): boolean {
  if (!protocol || typeof protocol.registerAuthoringGate !== 'function') return false;
  protocol.registerAuthoringGate('object', (ctx: ObjectPostureGateContext) => objectPostureGate(ctx));
  return true;
}
