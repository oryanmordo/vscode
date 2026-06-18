/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PolicyName } from '../../../base/common/policy.js';

/**
 * A `policyReference` for a setting that is registered ONLY in a non-default window
 * (for example the Agents window, `vs/sessions`). Such a setting is invisible to the
 * policy export, which runs in the workbench window and therefore never executes the
 * other window's configuration registration.
 *
 * The export merges these entries into each policy's `referencedSettings` so the
 * generated catalog (and the enterprise policy docs derived from it) lists every
 * setting an enterprise policy governs — regardless of which window registers it.
 *
 * This list is the single source of truth: the registering contribution (running in
 * its own window) attaches its `policyReference` via {@link getExternalPolicyReference},
 * so the runtime gate and the exported catalog cannot drift.
 */
export interface IExternalPolicyReference {
	/** The configuration setting key governed by the policy. */
	readonly settingKey: string;
	/** The name of the owning {@link IPolicy} this setting attaches to. */
	readonly policyName: PolicyName;
	/** The setting's configuration type; the export validates it matches the owner's type. */
	readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
}

/**
 * Cross-window `policyReference`s. Add an entry here when a setting that lives outside the
 * workbench window must be governed by a policy owned by a workbench/extension setting.
 */
export const externalPolicyReferences: readonly IExternalPolicyReference[] = [
	// Agents-window Claude gating mirrors the editor's `Claude3PIntegration` policy
	// (owned by `github.copilot.chat.claudeAgent.enabled`).
	{ settingKey: 'sessions.chat.claudeAgent.enabled', policyName: 'Claude3PIntegration', type: 'boolean' },
];

/**
 * Returns the external policy reference declared for `settingKey`, if any. The registering
 * contribution uses this to attach its `policyReference` from the shared manifest.
 */
export function getExternalPolicyReference(settingKey: string): IExternalPolicyReference | undefined {
	return externalPolicyReferences.find(ref => ref.settingKey === settingKey);
}
