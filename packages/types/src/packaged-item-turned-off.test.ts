// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { describeTurnedOffPackagedItem } from './packaged-item-turned-off.js';

describe('describeTurnedOffPackagedItem — the one switched-off packaged item sentence (#27842 / #27966)', () => {
    it('the action sentence is the one #27842 settled, byte for byte', () => {
        expect(describeTurnedOffPackagedItem('action')).toBe(
            'This action is turned off for this deployment. An administrator can turn it on again under '
            + 'Setup › Packaged automation, or you can use another action.',
        );
    });

    it('the flow sentence has the same shape, and offers the copy flow clone charters', () => {
        expect(describeTurnedOffPackagedItem('flow')).toBe(
            'This flow is turned off for this deployment. An administrator can turn it on again under '
            + 'Setup › Packaged automation, or copy it there under a new name.',
        );
    });

    it.each(['action', 'flow'] as const)('the %s sentence names no system table and no ADR', (kind) => {
        const message = describeTurnedOffPackagedItem(kind);
        expect(message).not.toContain('sys_metadata_activation');
        expect(message).not.toMatch(/ADR-\d+/);
        expect(message).not.toMatch(/#\d+/);
    });
});
