// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the authoring gate, the credential channel and the authoring channel contracts.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */

/**
 * Pre-persistence authoring gate (ADR-0094 addendum seam; #3050).
 *
 * Unlike the post-persist {@link MetadataMutationProjector} (best-effort,
 * never thrown), an authoring gate runs BEFORE persistence and REJECTS the
 * write by throwing — it is the seam for domain invariants that must hold on
 * every runtime-authored body regardless of which HTTP surface produced it
 * (e.g. plugin-security's OWD posture gate: an environment may only TIGHTEN
 * a packaged object's `sharingModel`).
 *
 * Invoked inside `saveMetaItem` for BOTH draft and publish-mode saves, after
 * the ADR-0005 overlay/runtime-create authorization and the per-type spec
 * validation — so `publishMetaItem` promotes an already-gated body and needs
 * no second gate. Environment writes only: control-plane bootstrap writes
 * (`environmentId === undefined`) are the package author's own channel and
 * bypass the gate, mirroring the ADR-0005 gate above.
 */
export interface MetadataAuthoringGateContext {
    /** Singular type name (e.g. `object`). */
    type: string;
    name: string;
    /** Lifecycle the body is being saved into. */
    state: 'draft' | 'active';
    /** The body being persisted. */
    body: unknown;
    /** True when a packaged artifact backs this name — the write is an env overlay of shipped metadata. */
    isArtifactBacked: boolean;
    /** The packaged (code-layer) baseline body when {@link isArtifactBacked}; the declaration an overlay customizes. */
    declaredBody?: unknown;
}
export type MetadataAuthoringGate = (ctx: MetadataAuthoringGateContext) => void | Promise<void>;

/**
 * [#20790] A metadata type's WRITE-ONLY credential channel — where the
 * credentials its bodies carry are stored instead of in the body, on the
 * platform's one secret seam (#7799: a `secret`-typed field the engine
 * encrypts, masks on every read and dereferences only through
 * `resolveSecretField`). Registered per type by the domain plugin that owns
 * the type's credential-location table (the automation plugin holds `flow`'s),
 * beside its authoring gate.
 *
 * Every write that lands a body at rest consults it:
 *  - `saveMetaItem` calls {@link store} immediately before the put, after the
 *    carry-forward, and persists what it returns;
 *  - the runtime authoring gate reads {@link heldPaths} as restored positions,
 *    on an active save and on the draft → active promotion;
 *  - a restore (rollback, revert) stores {@link strip}'s body.
 *
 * ⛔ Not a second secret mechanism and not a per-door redaction: the read
 * projection stays the type's redactor; this only decides where a credential
 * is STORED.
 */
export interface MetadataCredentialChannel {
    /**
     * Move every explicit credential in `body` into the channel for
     * `(name, state)` and return the body without any — what is stored. An
     * absent credential means "unchanged". THROWS (with an ADR-0112
     * `code`/`status`) to refuse the save; nothing may have been put then.
     */
    store(args: { name: string; state: 'draft' | 'active'; body: unknown }): Promise<unknown>;
    /**
     * The positions in `item` (dotted, item-relative — `redactedKeys`'
     * spelling) whose credential is withheld from the body and held by the
     * channel, so the gate reads them as present. `state: 'draft'` for a draft
     * being promoted.
     */
    heldPaths(args: { name: string; state: 'draft' | 'active'; item: unknown }): Promise<readonly string[]>;
    /**
     * The body a restore stores: every credential removed, and nothing written
     * to the channel — it keeps its current credential.
     */
    strip(body: unknown): unknown;
}

/**
 * Which authoring channel a kernel's metadata writes arrive on (#6710).
 *
 * ADR-0005 carves out "the package author's own bootstrap channel" from the
 * runtime authoring rules: a control-plane kernel installing a package is not
 * an author publishing into a live tenant, and gating it would refuse the very
 * bodies the platform ships. The carve-out is legitimate and stays.
 *
 * What #6710 changed is **how a kernel says it is that channel**. Until this
 * type existed the answer was inferred from `environmentId === undefined` — a
 * ROW-SCOPING key pressed into service as a topology signal. That proxy lies:
 * the CLI's lightweight host-config assembler (`serve.ts`'s auto-register
 * branch, `new ObjectQLPlugin()` with no options) also leaves `environmentId`
 * undefined, and it serves an END-USER `PUT /api/v1/meta/*`. Both topologies
 * read identically, so the whole #4463 gate — all the shared `AUTHORING_RULES`
 * — was disengaged on a self-hosted app server. #5086 had already moved the
 * code-only refusal off the same proxy for the same reason ("keying
 * authorization off a row-scoping key is what made a type-level declaration
 * depend on deployment topology; the declaration decides it here instead").
 *
 * So the channel is now DECLARED, not inferred:
 *
 * - `'environment'` — metadata arrives from an author (Studio tenant, MCP/AI
 *   agent, `PUT /api/v1/meta/*`). The gate runs. **This is the default**, and
 *   the default is the whole point: an assembly that forgets to declare gets
 *   MORE enforcement, never less, so the next assembly variant nobody thought
 *   about cannot silently reopen this hole.
 * - `'package-author'` — this kernel IS the package author's own bootstrap
 *   channel. Only the genuine control-plane assembly may state this.
 *
 * Deliberately a channel NAME and not a boolean: `skipAuthoringRules: true`
 * would be the same bytes with the opposite meaning — a kill switch any
 * assembly could reach for to make a red publish go away. A caller has to
 * claim to BE the package author to be treated as one.
 */
export type MetadataAuthoringChannel = 'environment' | 'package-author';
