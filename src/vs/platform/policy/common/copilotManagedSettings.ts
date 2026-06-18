/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IExtraKnownMarketplaceEntry, extraKnownMarketplacesToConfigDict } from '../../../base/common/managedSettings.js';
import { IManagedSettingPolicyDefinition, IManagedSettingsPolicyDefinitions, ManagedSettingValue, ManagedSettingsData } from '../../../base/common/policy.js';
import { IStringDictionary } from '../../../base/common/collections.js';
import { isObject, isString } from '../../../base/common/types.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { PolicyDefinition } from './policy.js';

export type { ManagedSettingsData } from '../../../base/common/policy.js';

/** Windows registry root for GitHub Copilot policies. */
export const GITHUB_COPILOT_WIN32_REGISTRY_PATH = 'SOFTWARE\\Policies\\GitHubCopilot';

/** Windows product name passed to the native policy watcher. */
export const GITHUB_COPILOT_WIN32_POLICY_NAME = 'GitHubCopilot';

/** macOS CFPreferences application ID for GitHub Copilot managed preferences. */
export const GITHUB_COPILOT_MACOS_BUNDLE_ID = 'com.github.copilot';

/** MDM key for the V0 managed setting. */
export const COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY = 'permissions.disableBypassPermissionsMode';

/** Managed-settings key for enterprise plugin enablement (carried as a JSON-encoded `{ [pluginId]: boolean }`). */
export const COPILOT_ENABLED_PLUGINS_KEY = 'enabledPlugins';

/** Managed-settings key for enterprise marketplaces (carried as a JSON-encoded `{ [name]: url-or-shorthand }`). */
export const COPILOT_EXTRA_MARKETPLACES_KEY = 'extraKnownMarketplaces';

/** Managed-settings key for the strict-marketplace flag (boolean). */
export const COPILOT_STRICT_MARKETPLACES_KEY = 'strictKnownMarketplaces';

export const ICopilotManagedSettingsService = createDecorator<ICopilotManagedSettingsService>('copilotManagedSettingsService');

export interface ICopilotManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData;
	readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
	updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<ManagedSettingsData>;
}

export class NullCopilotManagedSettingsService implements ICopilotManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData = {};
	readonly onDidChangeManagedSettings = Event.None;

	async updatePolicyDefinitions(): Promise<ManagedSettingsData> { return this.managedSettings; }
}

export function flattenManagedSettings(object: unknown): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	flattenManagedSettingsValue(object, undefined, result);
	return result;
}

function flattenManagedSettingsValue(value: unknown, prefix: string | undefined, result: Record<string, string | number | boolean>): void {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		if (prefix !== undefined) {
			result[prefix] = value;
		}
		return;
	}

	if (!isManagedSettingsObject(value)) {
		return;
	}

	for (const key in value) {
		flattenManagedSettingsValue(value[key], prefix ? `${prefix}.${key}` : key, result);
	}
}

function isManagedSettingsObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Aggregate the `managedSettings` declarations of every policy definition into a single
 * key -> definition map. This is the single source of truth for which Copilot managed-settings
 * keys (and their value types) are honored, and it drives both delivery channels: the native
 * MDM watcher and the server `managed_settings` endpoint projection.
 */
export function collectManagedSettingsDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): IManagedSettingsPolicyDefinitions {
	const definitions: Record<string, IManagedSettingPolicyDefinition> = {};
	for (const policyName in policyDefinitions) {
		const policyManagedSettings = policyDefinitions[policyName].managedSettings;
		if (policyManagedSettings) {
			for (const key in policyManagedSettings) {
				definitions[key] = policyManagedSettings[key];
			}
		}
	}
	return definitions;
}

/**
 * Project a raw managed-settings bag onto the declared schema: keep only keys declared by a
 * policy definition whose runtime value matches the declared type. Undeclared keys and
 * type-mismatched values are dropped (with an optional warning). Values are validated, never
 * coerced, so a key declared as `string` keeps its string value untouched.
 *
 * This keeps the server endpoint and native MDM delivery aligned on the same
 * declaration-driven key set and value types.
 */
export function projectManagedSettings(values: ManagedSettingsData, definitions: IManagedSettingsPolicyDefinitions, onWarn?: (msg: string) => void): ManagedSettingsData {
	const projected: Record<string, ManagedSettingValue> = {};
	for (const key in definitions) {
		const value = values[key];
		if (value === undefined) {
			continue;
		}
		if (typeof value === definitions[key].type) {
			projected[key] = value;
		} else {
			onWarn?.(`Ignoring managed setting "${key}": expected ${definitions[key].type}, got ${typeof value}`);
		}
	}
	return projected;
}

// --- File-based managed settings ---

/** macOS well-known path for file-based managed settings. */
export const MANAGED_SETTINGS_MACOS_FILE_PATH = '/Library/Application Support/GitHub Copilot/managed-settings.json';

/** Linux well-known path for file-based managed settings. */
export const MANAGED_SETTINGS_LINUX_FILE_PATH = '/etc/github-copilot/managed-settings.json';

/** Windows directory name under %ProgramData% for file-based managed settings. */
export const MANAGED_SETTINGS_WINDOWS_DIR = 'GitHub Copilot';

/** Managed settings file name. */
export const MANAGED_SETTINGS_FILE_NAME = 'managed-settings.json';

/**
 * Top-level keys in the managed-settings schema whose values are opaque structured
 * blobs (objects/arrays) rather than hierarchical sub-settings. These are
 * extracted before flattening and carried as canonical JSON strings in the bag,
 * matching the format native MDM delivers.
 */
const STRUCTURED_MANAGED_SETTINGS_KEYS: ReadonlySet<string> = new Set([
	COPILOT_ENABLED_PLUGINS_KEY,
	COPILOT_EXTRA_MARKETPLACES_KEY,
]);

/**
 * Normalize a parsed managed-settings object (from the server API, a file on
 * disk, or any other source using the managed-settings schema) into the
 * canonical `ManagedSettingsData` bag that the policy framework consumes.
 *
 * - Scalar leaves (`permissions.*`, `strictKnownMarketplaces`, and any
 *   forward-compatible scalar keys) are flattened into dot-separated keys.
 * - `enabledPlugins` is carried as a canonical JSON string.
 * - `extraKnownMarketplaces` is normalized from the schema's
 *   `{ [name]: { source } }` map to a `{ [name]: url-or-shorthand }` dict,
 *   then carried as a canonical JSON string.
 *
 * This is the **single** normalization path for all delivery channels (server
 * API, file-based, native MDM pre-processing). Downstream `projectManagedSettings`
 * handles schema-declared key filtering and type validation.
 *
 * Malformed marketplace entries are dropped (with an optional warning via
 * {@link onWarn}) rather than throwing, so a bad settings file degrades
 * gracefully instead of blocking startup.
 */
export function normalizeManagedSettings(parsed: Record<string, unknown>, onWarn?: (msg: string) => void): ManagedSettingsData {
	const result: Record<string, ManagedSettingValue> = {};

	// Partition structured keys from the rest.
	const rest: Record<string, unknown> = {};
	for (const key of Object.keys(parsed)) {
		const value = parsed[key];
		if (!STRUCTURED_MANAGED_SETTINGS_KEYS.has(key) || !isObject(value)) {
			rest[key] = value;
			continue;
		}

		if (key === COPILOT_EXTRA_MARKETPLACES_KEY) {
			// Normalize from schema format { name: { source: { source, repo|url } } }
			// to the canonical config dict { name: "url-or-shorthand" }.
			const entries = normalizeExtraKnownMarketplaces(value as Record<string, unknown>, onWarn);
			const configDict = extraKnownMarketplacesToConfigDict(entries);
			if (configDict) {
				result[key] = JSON.stringify(configDict);
			}
		} else {
			result[key] = JSON.stringify(value);
		}
	}

	// Flatten everything else (scalar leaves → dot-paths).
	Object.assign(result, flattenManagedSettings(rest));

	return result;
}

/**
 * Normalize the schema's `{ [id]: { source } }` marketplace map into an
 * {@link IExtraKnownMarketplaceEntry} array, preserving the marketplace `name`,
 * source discriminator, and any `ref`. Malformed or off-spec entries are dropped
 * (with an optional warning via {@link onWarn}).
 */
export function normalizeExtraKnownMarketplaces(value: Record<string, unknown> | undefined, onWarn?: (msg: string) => void): IExtraKnownMarketplaceEntry[] | undefined {
	if (!isObject(value)) {
		return undefined;
	}
	const seen = new Set<string>();
	const entries: IExtraKnownMarketplaceEntry[] = [];
	for (const [name, entry] of Object.entries(value)) {
		if (!isObject(entry) || !isObject((entry as Record<string, unknown>).source)) {
			onWarn?.(`Skipping malformed extraKnownMarketplaces entry "${name}": expected { source: { source, repo|url } }`);
			continue;
		}
		const src = (entry as Record<string, unknown>).source as { source?: string; repo?: string; url?: string; ref?: string };
		let normalized: IExtraKnownMarketplaceEntry | undefined;
		if (src.source === 'github' && isString(src.repo)) {
			normalized = { name, source: { source: 'github', repo: src.repo, ...(src.ref ? { ref: src.ref } : {}) } };
		} else if (src.source === 'git' && isString(src.url)) {
			normalized = { name, source: { source: 'git', url: src.url, ...(src.ref ? { ref: src.ref } : {}) } };
		} else if (src.source === 'github' || src.source === 'git') {
			onWarn?.(`Skipping extraKnownMarketplaces entry "${name}": source "${src.source}" requires ${src.source === 'github' ? '"repo"' : '"url"'}`);
		} else {
			onWarn?.(`Skipping extraKnownMarketplaces entry "${name}": unknown source type "${src.source}"`);
		}
		if (normalized && !seen.has(name)) {
			seen.add(name);
			entries.push(normalized);
		}
	}
	return entries;
}

export const IFileManagedSettingsService = createDecorator<IFileManagedSettingsService>('fileManagedSettingsService');

export interface IFileManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData;
	readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
}

export class NullFileManagedSettingsService implements IFileManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData = {};
	readonly onDidChangeManagedSettings = Event.None;
}
