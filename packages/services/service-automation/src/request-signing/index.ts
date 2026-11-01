// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorInstanceSignedAuth, ConnectorRequestSigner } from '@objectstack/spec/integration';
import { createAliyunAcs3Signer } from './aliyun-acs3-hmac-sha256.js';
import { createTencentCloudTc3Signer } from './tencentcloud-tc3-hmac-sha256.js';
import { createAlipayV3Signer } from './alipay-v3.js';
import type { RequestSigningClock } from './clock.js';

export type { RequestSigningClock } from './clock.js';

/** What a `signed` instance's references resolved to. */
export interface ConnectorSigningKeys {
    /** `credentialRef`'s value: the HMAC secret or private key every request is signed with. */
    readonly key: string;
    /** `vendorPublicKeyRef`'s value, for a scheme that verifies responses (`alipay-v3`). */
    readonly vendorPublicKey?: string;
}

/**
 * The signer registry (ADR-0143 D2.3, D4): bind a `signed` instance's key to
 * the signer its `scheme` names. The host calls it once the instance's
 * references have resolved, and hands the provider the signer — never a key.
 *
 * The switch is exhaustive over `ConnectorSigningSchemeSchema`'s members, so a
 * scheme added to the spec without a signer here fails to compile: an enum
 * member cannot ship ahead of its signer (ADR-0049).
 *
 * Throws when a key cannot sign or verify at all (an empty one, or one that is
 * not the scheme's kind of key), before any request is made; never with a key
 * in the message.
 */
export function createConnectorRequestSigner(
    connector: string,
    auth: ConnectorInstanceSignedAuth,
    keys: ConnectorSigningKeys,
    clock?: RequestSigningClock,
): ConnectorRequestSigner {
    if (keys.key.length === 0) {
        throw new Error(`connector instance '${connector}': the signing key its credentialRef names is empty`);
    }
    switch (auth.scheme) {
        case 'aliyun-acs3-hmac-sha256':
            return createAliyunAcs3Signer(connector, auth.keyId, keys.key, clock);
        case 'tencentcloud-tc3-hmac-sha256':
            return createTencentCloudTc3Signer(connector, auth.keyId, keys.key, clock);
        case 'alipay-v3':
            if (!keys.vendorPublicKey) {
                throw new Error(`connector instance '${connector}': the Alipay public key its vendorPublicKeyRef names is empty`);
            }
            return createAlipayV3Signer(connector, auth.keyId, keys.key, keys.vendorPublicKey, clock);
        default: {
            // Every member handled leaves `auth` itself `never` here.
            const unsigned: never = auth;
            throw new Error(
                `connector instance '${connector}': no signer implements scheme '${String((unsigned as { scheme?: unknown }).scheme)}'`,
            );
        }
    }
}
