// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4127] The map claims a binding per slot. These tests keep the claim honest
// in both directions: every key must be a real `CoreServiceName` member, and a
// slot deliberately left unmapped must resolve to `unknown` rather than quietly
// widening to `any` — the difference between "no contract written yet" and
// "checked", which is the distinction this whole line of work exists to make.

import { describe, it, expect } from 'vitest';
import { CoreServiceName } from '../system/core-services.zod';
import type {
    CoreServiceContracts, CoreServiceContract, ServiceSlotContracts, ServiceSlotContract,
} from './core-service-contracts';
import type { IAutomationService } from './automation-service';
import type { INotificationService } from './notification-service';
import type { II18nService } from './i18n-service';
import type { IDataEngine } from './data-engine';
import type { ISecurityService } from './security-service';
import type { IShareLinkService } from './share-link-service';

/** Compile-time assertion helper: fails to typecheck unless `T` is exactly `true`. */
type Expect<T extends true> = T;
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false;

describe('CoreServiceName → contract map (#4127)', () => {
    it('maps every key to a declared CoreServiceName slot', () => {
        // The map's keys are checked against the enum at compile time below;
        // this asserts the same thing at runtime so a rename shows up as a
        // failing test and not only as a type error in an unrelated package.
        const mapped: Array<keyof CoreServiceContracts> = [
            'metadata', 'data', 'auth', 'file-storage', 'search', 'cache', 'queue',
            'automation', 'analytics', 'realtime', 'job', 'notification', 'ai',
            'i18n', 'workflow',
        ];
        const slots = new Set<string>(CoreServiceName.options);
        for (const key of mapped) {
            expect(slots.has(key), `'${key}' is not a CoreServiceName member`).toBe(true);
        }
    });

    it('leaves exactly the slots with no written contract unmapped', () => {
        const mapped = new Set<string>([
            'metadata', 'data', 'auth', 'file-storage', 'search', 'cache', 'queue',
            'automation', 'analytics', 'realtime', 'job', 'notification', 'ai',
            'i18n', 'workflow',
        ]);
        const unmapped = CoreServiceName.options.filter((s) => !mapped.has(s));
        // `ui` has a slot and a serving domain but no `IUiService` — mapping it
        // to a hand-rolled shape here would be a second, unwritten contract.
        expect(unmapped).toEqual(['ui']);
    });

    it('resolves a mapped slot to its contract', () => {
        type _Automation = Expect<Equals<CoreServiceContract<'automation'>, IAutomationService>>;
        type _Notification = Expect<Equals<CoreServiceContract<'notification'>, INotificationService>>;
        type _I18n = Expect<Equals<CoreServiceContract<'i18n'>, II18nService>>;
        expect(true).toBe(true);
    });

    it('resolves an unmapped slot to unknown, not any', () => {
        // `unknown` forces a deliberate cast at the call site. `any` would let
        // an undeclared call through silently — the failure mode #4087 shipped.
        type _Ui = Expect<Equals<CoreServiceContract<'ui'>, unknown>>;
        expect(true).toBe(true);
    });
});

describe('slot → contract ledger beyond the enum (#4127 batch 3)', () => {
    it('keeps every core binding', () => {
        // The extension must not shadow or drop a core entry — `data` staying
        // `IDataEngine` is what makes the `objectql` alias below meaningful.
        type _Data = Expect<Equals<ServiceSlotContract<'data'>, IDataEngine>>;
        type _Automation = Expect<Equals<ServiceSlotContract<'automation'>, IAutomationService>>;
        expect(true).toBe(true);
    });

    it('maps the evidenced non-core slots', () => {
        type _Security = Expect<Equals<ServiceSlotContract<'security'>, ISecurityService>>;
        type _ShareLinks = Expect<Equals<ServiceSlotContract<'shareLinks'>, IShareLinkService>>;
        expect(true).toBe(true);
    });

    it('resolves objectql to the same contract as data, because it is the same instance', () => {
        // `packages/objectql`'s plugin registers `this.ql` under both names two
        // lines apart. Anything else here would claim they are two services.
        type _Alias = Expect<Equals<ServiceSlotContract<'objectql'>, ServiceSlotContract<'data'>>>;
        expect(true).toBe(true);
    });

    it('holds exactly the non-core slots whose contract is written', () => {
        const extra: Array<Exclude<keyof ServiceSlotContracts, keyof CoreServiceContracts>> = [
            'security', 'shareLinks', 'objectql',
        ];
        const slots = new Set<string>(CoreServiceName.options);
        for (const key of extra) {
            // The point of the split: these are deliberately NOT enum members.
            // If one is ever promoted to a real core service, its entry moves
            // into `CoreServiceContracts` and this assertion is what catches it.
            expect(slots.has(key), `'${key}' is a CoreServiceName — move its entry into CoreServiceContracts`).toBe(false);
        }
        expect(extra).toHaveLength(3);
    });

    it('still resolves a slot with no written contract to unknown', () => {
        // `protocol` (22 call sites) and `mcp` have no contract, so they stay
        // out of the ledger and keep reading as open gaps.
        type _Protocol = Expect<Equals<ServiceSlotContract<'protocol'>, unknown>>;
        type _Mcp = Expect<Equals<ServiceSlotContract<'mcp'>, unknown>>;
        expect(true).toBe(true);
    });
});
