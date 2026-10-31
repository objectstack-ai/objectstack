// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorInstanceSignedAuth, ConnectorRequestSigner } from '@objectstack/spec/integration';
import { createAliyunAcs3Signer } from './aliyun-acs3-hmac-sha256.js';
import type { RequestSigningClock } from './clock.js';

export type { RequestSigningClock } from './clock.js';

/**
 * The signer registry (ADR-0143 D2.3, D4): bind a `signed` instance's key to
 * the signer its `scheme` names. The host calls it once the instance's
 * `credentialRef` has resolved, and hands the provider the signer — never the
 * key.
 *
 * The switch is exhaustive over `ConnectorSigningSchemeSchema`'s members, so a
 * scheme added to the spec without a signer here fails to compile: an enum
 * member cannot ship ahead of its signer (ADR-0049).
 *
 * Throws when the key cannot sign at all (an empty one), before any request
 * is made; never with the key in the message.
 */
export function createConnectorRequestSigner(
    connector: string,
    auth: ConnectorInstanceSignedAuth,
    key: string,
    clock?: RequestSigningClock,
): ConnectorRequestSigner {
    if (key.length === 0) {
        throw new Error(`connector instance '${connector}': the signing key its credentialRef names is empty`);
    }
    switch (auth.scheme) {
        case 'aliyun-acs3-hmac-sha256':
            return createAliyunAcs3Signer(connector, auth.keyId, key, clock);
        default: {
            const unsigned: never = auth.scheme;
            throw new Error(`connector instance '${connector}': no signer implements scheme '${String(unsigned)}'`);
        }
    }
}
