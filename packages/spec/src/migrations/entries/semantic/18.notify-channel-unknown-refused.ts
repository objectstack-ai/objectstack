// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'notify-channel-unknown-refused',
  surface:
    'automation.Flow notify node config.channels on a flow saved through the automation write doors '
    + '(POST /api/v1/automation, PUT /api/v1/automation/NAME, POST /api/v1/automation/NAME/clone), at any region '
    + 'depth: a channel name the messaging service does not know',
  replacement:
    'Name a channel the deployment registers in the node\'s channels (inbox, email, sms, push, or one a plugin '
    + 'installed here registers), or install the plugin that provides the channel before saving the flow',
  reason:
    'A channel is code a plugin registers with the messaging service, so a name nothing registers is a typo or a '
    + 'missing plugin. The automation write doors saved such a flow with 200; every delivery on that channel then '
    + 'failed at run time with "channel NAME not registered" and a step warning. The doors now refuse it 400 '
    + 'VALIDATION_FAILED at nodes.N.config.channels, naming the node and the channel with a did-you-mean and listing '
    + 'the registered channels. A channel whose transport is not configured yet (email with no email service) is '
    + 'known and still accepted. Not judged: a deployment with no messaging service, a flow a package ships, a flow '
    + 'stored through the metadata door, and a stored row re-registered at boot. There is no mechanical rewrite: '
    + 'only the author knows which channel was meant.',
  acceptanceCriteria:
    'POST /api/v1/automation with the flow, every notify node naming registered channels, answers 200, and '
    + 'GET /api/v1/automation/NAME serves it.',
};
