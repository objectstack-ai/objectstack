// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { describeTurnedOffPackagedItem } from './packaged-item-turned-off.js';

describe('describeTurnedOffPackagedItem — the one switched-off packaged item sentence (#27842 / #27966)', () => {
    it('the action sentence is the one #27842 settled, sending the reader to Studio (#34724), byte for byte', () => {
        expect(describeTurnedOffPackagedItem('action')).toBe(
            'This action is turned off for this deployment. An administrator can turn it on again '
            + 'on the action in its package in Studio, or you can use another action.',
        );
    });

    it('the flow sentence has the same shape, and offers the copy flow clone charters', () => {
        expect(describeTurnedOffPackagedItem('flow')).toBe(
            'This flow is turned off for this deployment. An administrator can turn it on again '
            + "in its package's Automations in Studio, or copy it there under a new name.",
        );
    });

    it('a platform action\'s sentence names the activation door, not Studio (#34724, ruling 6944409840)', () => {
        expect(describeTurnedOffPackagedItem('action', { platform: true })).toBe(
            'This action is turned off for this deployment. An administrator can turn it on again '
            + 'through the action activation API (POST /api/v1/actions/_activation/<object>/<action> with {"enabled": true}; '
            + "Studio has no switch for the platform's own actions), or you can use another action.",
        );
        // An app's action, said explicitly, is the Studio sentence.
        expect(describeTurnedOffPackagedItem('action', { platform: false })).toBe(describeTurnedOffPackagedItem('action'));
    });

    it('a flow has no platform variant: the option changes nothing', () => {
        expect(describeTurnedOffPackagedItem('flow', { platform: true })).toBe(describeTurnedOffPackagedItem('flow'));
    });

    it.each([['action', false], ['action', true], ['flow', false]] as const)('the %s sentence (platform: %s) names no system table and no ADR', (kind, platform) => {
        const message = describeTurnedOffPackagedItem(kind, { platform });
        expect(message).not.toContain('sys_metadata_activation');
        expect(message).not.toMatch(/ADR-\d+/);
        expect(message).not.toMatch(/#\d+/);
    });

    it.each([['action', false], ['action', true], ['flow', false]] as const)('the %s sentence (platform: %s) does not send anyone to a retired Setup page', (kind, platform) => {
        const message = describeTurnedOffPackagedItem(kind, { platform });
        expect(message).not.toContain('Packaged automation');
        expect(message).not.toContain('Packaged Actions');
        expect(message).not.toContain('Setup');
    });
});
