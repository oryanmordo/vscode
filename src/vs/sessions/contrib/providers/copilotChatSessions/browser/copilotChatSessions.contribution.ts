/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CopilotChatSessionsProvider, COPILOT_MULTI_CHAT_SETTING, CLAUDE_CODE_ENABLED_SETTING } from '../../copilotChatSessions/browser/copilotChatSessionsProvider.js';
import '../../copilotChatSessions/browser/copilotChatSessionsActions.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { getExternalPolicyReference } from '../../../../../platform/policy/common/externalPolicyReferences.js';
import { localize } from '../../../../../nls.js';

// Sourced from the shared cross-window manifest so the runtime gate (here) and the policy
// export (which runs in the workbench window and cannot see this registration) stay aligned.
const claudeExternalPolicyReference = getExternalPolicyReference(CLAUDE_CODE_ENABLED_SETTING);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions',
	properties: {
		[COPILOT_MULTI_CHAT_SETTING]: {
			type: 'boolean',
			default: true,
			tags: ['preview'],
			description: localize('sessions.github.copilot.multiChatSessions', "Whether to enable multiple chats within a single session in the Copilot Chat sessions provider."),
		},
		[CLAUDE_CODE_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			experiment: { mode: 'startup' },
			description: localize('sessions.chat.claudeAgent.enabled', "Enable Claude Agent sessions in the Agents window. Start and resume agentic coding sessions powered by Anthropic's Claude Agent SDK directly. Uses your existing Copilot subscription."),
			// References the `Claude3PIntegration` policy (owned by `github.copilot.chat.claudeAgent.enabled`) so the Agents window is gated like the editor.
			...(claudeExternalPolicyReference ? { policyReference: { name: claudeExternalPolicyReference.policyName } } : {}),
		},
	},
});

/**
 * Registers the {@link CopilotChatSessionsProvider} as a sessions provider.
 *
 * Coexists with the local agent host provider when `chat.agentHost.enabled`
 * is true. The two providers list disjoint sets of sessions:
 * - The local agent host filters via the per-session Agent Host SQLite DB
 *   (database-existence ownership gate in `CopilotAgent.listSessions`).
 * - This provider's underlying extension service filters via the per-session
 *   metadata file's `origin` field, which the local agent host never writes.
 */
class DefaultSessionsProviderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.defaultSessionsProvider';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();

		const provider = this._register(instantiationService.createInstance(CopilotChatSessionsProvider));
		this._register(sessionsProvidersService.registerProvider(provider));
	}
}

registerWorkbenchContribution2(DefaultSessionsProviderContribution.ID, DefaultSessionsProviderContribution, WorkbenchPhase.AfterRestored);
