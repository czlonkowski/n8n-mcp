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
   * every version we filter for. For a {@link derived} property the schema may never accept it -
   * there it records the first version whose GET responses can carry the property.
   */
  since: SettingsVersion;
  /**
   * n8n manages this property server-side and does not take it from a write. Two flavours:
   * the schema documents it as ignored on create and update (`binaryMode`), or the property is
   * persisted on the workflow entity but missing from the write schema entirely (`engineType`),
   * where `additionalProperties: false` rejects the whole request. GET echoes both back, and our
   * writes merge over a GET, so these are always stripped - sending them back changes nothing on
   * the instance that produced them and rejects the request on one that doesn't accept them.
   */
  derived?: true;
  /**
   * The second {@link derived} flavour: persisted on the workflow entity but absent from the
   * Public API schema. The drift check fails when n8n later publishes such a property to the
   * schema, because stripping then stops being the only option - callers might want to set it.
   */
  entityOnly?: true;
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

  // n8n 2.36.0 (n8n-io/n8n#36428): persisted on the workflow entity (the engine-v2 dispatcher
  // reads settings.engineType === 'v2') but absent from the Public API write schema, so echoing
  // back what GET returned rejects the whole write. Stripping is lossless: WorkflowService.update
  // spreads stored settings under the request body, so an omitted key is preserved, not cleared.
  engineType: { since: v(2, 36, 0), derived: true, entityOnly: true },
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
