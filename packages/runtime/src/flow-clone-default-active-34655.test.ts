// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34655, ADR-0126 §4 amendment] A clone drops `defaultActive`: the key is
 * the default of the switch only a flow a package ships has, the copy is a
 * writable package's flow switched by its own `status`, and the engine
 * refuses the key on such a flow.
 */

import { describe, expect, it } from 'vitest';
import { cloneFlowDefinition, FLOW_CLONE_DROPPED_KEYS, FLOW_CLONE_STATUS } from './flow-clone.js';

const source = {
    name: 'draft_contract',
    label: 'Draft contract',
    type: 'record_change',
    status: 'active',
    defaultActive: false,
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: {} }],
    edges: [],
};

describe('#34655 — a clone of a packaged flow shipped off', () => {
    it('drops `defaultActive` and is written switched off by its own status', () => {
        const clone = cloneFlowDefinition(source, { name: 'draft_contract_copy', label: 'Copy' });
        expect(clone).not.toHaveProperty('defaultActive');
        expect(clone.status).toBe(FLOW_CLONE_STATUS);
        expect(FLOW_CLONE_DROPPED_KEYS).toContain('defaultActive');
    });

    it('CONTROL: every other facet is copied', () => {
        const clone = cloneFlowDefinition(source, { name: 'draft_contract_copy', label: 'Copy' });
        expect(clone.nodes).toEqual(source.nodes);
        expect(clone.type).toBe(source.type);
        expect(source.defaultActive).toBe(false);
    });
});
