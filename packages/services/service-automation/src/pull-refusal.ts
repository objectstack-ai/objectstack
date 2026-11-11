// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal every pull throws — a connector source's (`./connector-pull.ts`)
 * and a datasource source's (`./datasource-pull.ts`, reading through
 * `./datasource-window-read.ts`, ADR-0153 D1/D2) alike — so a caller of
 * `IAutomationService.pullConnectorSource` branches on one type, one `code` +
 * `status` pair and one `reason` union, whichever source the mapping names.
 */

/** Which part of the binding a refused pull failed on. */
export type ConnectorPullRefusalReason =
    | 'mapping_not_found'
    /**
     * [ADR-0150 D3, #32071] The mapping's name resolves to no one item: more
     * than one package holds it. The message names every candidate.
     */
    | 'mapping_name_refused'
    | 'no_connector_source'
    | 'connector_not_registered'
    | 'connector_plugin_origin'
    | 'connector_degraded'
    | 'connector_provider_unsupported'
    | 'connector_action_unknown'
    | 'upsert_key_empty'
    | 'unsupported_transform'
    | 'watermark_field_unmapped'
    | 'input_query_not_object'
    | 'input_schema_mismatch'
    | 'mapping_target_refused'
    | 'upstream_not_ok'
    | 'records_not_array'
    | 'record_not_object'
    | 'mapping_apply_refused'
    // [ADR-0153 D2] The datasource source's windowed read (`./datasource-window-read.ts`).
    | 'sync_window_unsplittable'
    | 'sync_bounds_not_pushed'
    | 'source_key_not_exact'
    | 'watermark_not_exact'
    | 'watermark_start_invalid'
    // [ADR-0153 D1, D2, D8] The datasource source's binding, judged before the
    // first read (`./datasource-pull.ts`): the build's tokens where it has one.
    | 'source_key_missing'
    | 'source_binding_invalid'
    | 'source_organization_scope_unstated'
    | 'job_organization_missing';

/**
 * A refused pull. `code` + `status` are the ADR-0112 pair a door would put on
 * the wire; `reason` is the machine discriminator a caller branches on; the
 * message names the mapping and says what to change.
 */
export class ConnectorPullError extends Error {
    readonly code: string;
    readonly status: number;
    readonly reason: ConnectorPullRefusalReason;
    readonly mapping: string;

    constructor(
        init: { code: string; status: number; reason: ConnectorPullRefusalReason; mapping: string },
        message: string,
    ) {
        super(message);
        this.name = 'ConnectorPullError';
        this.code = init.code;
        this.status = init.status;
        this.reason = init.reason;
        this.mapping = init.mapping;
    }
}

