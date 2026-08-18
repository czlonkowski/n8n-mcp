/**
 * The `workflowSettings` properties of the n8n Public API, and the n8n version that introduced
 * each one.
 *
 * This is the source of truth for the code that filters settings on a write: the cleaners in
 * `services/n8n-validation.ts` and the version-aware filter in `services/n8n-version.ts`.
 * Those copies had drifted apart before this file existed - `npm run check:settings-drift` now
 * diffs it against the OpenAPI schema n8n ships in its published package, so drift fails the
 * n8n dependency update instead of going unnoticed.
 *
 * `workflowSettingsSchema` in `services/n8n-validation.ts` is NOT generated from this table -
 * it is hand-written, because it also carries each property's type and enum values, which this
 * table does not model. It is not on any write path today, but it can still drift from n8n
 * without the check noticing. Generating it from a typed version of this table would close
 * that gap.
 *
 * Sourced from `dist/public-api/v1/openapi.yml` in the published `n8n` package
 * (`components.schemas.workflowSettings`). That schema is `additionalProperties: false`, which
 * is why writes are filtered at all: a property an instance does not know rejects the whole
 * request, not just the property.
 */

/** An n8n version, as the three numbers we compare on. */
export interface SettingsVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface WorkflowSettingProperty {
  /**
   * First n8n version whose Public API schema accepted this property. `0.0.0` means it predates
   * every version we filter for.
   */
  since: SettingsVersion;
  /**
   * n8n derives this server-side: it documents the property as ignored on create and update but
   * still echoes it back on GET. Our writes merge over a GET, so these are always stripped -
   * sending them back changes nothing on the instance that produced them and rejects the whole
   * request on an older one.
   */
  derived?: true;
}

const v = (major: number, minor: number, patch = 0): SettingsVersion => ({ major, minor, patch });

export const WORKFLOW_SETTINGS_PROPERTIES: Record<string, WorkflowSettingProperty> = {
  // Accepted by every version we support
  saveExecutionProgress: { since: v(0, 0, 0) },
  saveManualExecutions: { since: v(0, 0, 0) },
  saveDataErrorExecution: { since: v(0, 0, 0) },
  saveDataSuccessExecution: { since: v(0, 0, 0) },
  executionTimeout: { since: v(0, 0, 0) },
  errorWorkflow: { since: v(0, 0, 0) },
  timezone: { since: v(0, 0, 0) },

  executionOrder: { since: v(1, 37, 0) },

  // n8n 1.119.0 (n8n-io/n8n#21297)
  callerPolicy: { since: v(1, 119, 0) },
  callerIds: { since: v(1, 119, 0) },
  timeSavedPerExecution: { since: v(1, 119, 0) },
  availableInMCP: { since: v(1, 119, 0) },

  customTelemetryTags: { since: v(2, 24, 0) },
  redactionPolicy: { since: v(2, 26, 0) },

  // n8n 2.33.0
  binaryMode: { since: v(2, 33, 0), derived: true },
  timeSavedMode: { since: v(2, 33, 0) },
  credentialResolverId: { since: v(2, 33, 0), derived: true },
};

/**
 * At or above this version, writes forward every non-derived property untouched instead of
 * filtering to the list above.
 *
 * The list will always trail n8n, which ships a minor most weeks. Dropping a property an
 * instance would have honoured is silent and unrecoverable - that is how `redactionPolicy`,
 * a data-redaction control, was stripped from every update for two months. Forwarding it
 * instead costs at worst n8n's own 400, which `getUserFriendlyErrorMessage` turns into an
 * actionable message naming the property.
 *
 * Below the floor the precise filter still applies: those instances predate properties we do
 * know about, so a rejection there is a certainty rather than a risk.
 */
export const SETTINGS_PASS_THROUGH_FLOOR: SettingsVersion = v(2, 24, 0);

/** Properties n8n ignores on write. Stripped from every payload regardless of version. */
export const DERIVED_SETTINGS_PROPERTIES: ReadonlySet<string> = new Set(
  Object.entries(WORKFLOW_SETTINGS_PROPERTIES)
    .filter(([, meta]) => meta.derived)
    .map(([name]) => name)
);
