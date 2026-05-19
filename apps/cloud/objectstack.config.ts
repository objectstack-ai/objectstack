// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectStack Cloud — Host Configuration
 *
 * apps/cloud is the **control plane**: it owns the control-plane DB
 * (organizations, projects, packages, billing), authentication
 * (better-auth), the cloud_control metadata-driven App, and the
 * artifact distribution API. It does NOT run per-project tenant
 * kernels — apps/objectos is the runtime that pulls compiled
 * artifacts from here and serves project data.
 *
 * Booted by `objectstack dev` / `objectstack serve` (see `package.json`)
 * and by the Vercel / Cloudflare serverless entrypoints.
 */

import { createCloudStack } from '@objectstack/service-cloud';
import { templateRegistry } from './server/templates/registry.js';

const authSecret = process.env.AUTH_SECRET
    ?? process.env.BETTER_AUTH_SECRET
    ?? process.env.OS_AUTH_SECRET
    ?? '';
if (!authSecret) {
    throw new Error('apps/cloud: AUTH_SECRET (or BETTER_AUTH_SECRET / OS_AUTH_SECRET) is required.');
}

const baseUrl = process.env.OS_BASE_URL
    ?? process.env.BETTER_AUTH_URL
    ?? `http://localhost:${process.env.PORT ?? '4000'}`;

const config = await createCloudStack({
    authSecret,
    baseUrl,
    templates: templateRegistry,
});

export default config;
