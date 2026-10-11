import {
  CRM_DEFAULT_INPUT,
  CRM_FAULTS,
  CRM_PRESETS,
  CRM_SCENARIO_ID,
  crmScenario,
  validateCrmInput,
} from "./scenarios/crm/scenario";
import {
  LEADS_DEFAULT_INPUT,
  LEADS_FAULTS,
  LEADS_PRESETS,
  LEADS_SCENARIO_ID,
  leadsScenario,
  validateLeadsInput,
} from "./scenarios/leads/scenario";
import {
  RATING_DEFAULT_INPUT,
  RATING_FAULTS,
  RATING_PRESETS,
  RATING_SCENARIO_ID,
  ratingScenario,
  validateRatingInput,
} from "./scenarios/rating/scenario";
import {
  REVIEWS_DEFAULT_INPUT,
  REVIEWS_FAULTS,
  REVIEWS_PRESETS,
  REVIEWS_SCENARIO_ID,
  reviewsScenario,
  validateReviewsInput,
} from "./scenarios/reviews/scenario";
import {
  RUGS_DEFAULT_INPUT,
  RUGS_FAULTS,
  RUGS_PRESETS,
  RUGS_SCENARIO_ID,
  rugsScenario,
  validateRugsInput,
} from "./scenarios/rugs/scenario";
import {
  SOLANA_DEFAULT_INPUT,
  SOLANA_FAULTS,
  SOLANA_PRESETS,
  SOLANA_SCENARIO_ID,
  solanaScenario,
  validateSolanaInput,
} from "./scenarios/solana/scenario";
import {
  STOCKS_DEFAULT_INPUT,
  STOCKS_FAULTS,
  STOCKS_PRESETS,
  STOCKS_SCENARIO_ID,
  stocksScenario,
  validateStocksInput,
} from "./scenarios/stocks/scenario";
import {
  TRIAGE_DEFAULT_INPUT,
  TRIAGE_FAULTS,
  TRIAGE_PRESETS,
  TRIAGE_SCENARIO_ID,
  triageScenario,
  validateTriageInput,
} from "./scenarios/triage/scenario";
import type { Scenario } from "./session";
import type { Json } from "./types";

export type ScenarioInput = Record<string, Json>;

export interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  input: ScenarioInput;
}

export interface ScenarioRuntime {
  scenario: Scenario<ScenarioInput>;
  defaultInput: ScenarioInput;
  presets: ScenarioPreset[];
  faultIds: readonly string[];
  /** Normalises visitor input and reports field errors. Never throws. */
  validate(raw: ScenarioInput): { ok: boolean; value: ScenarioInput; errors: Record<string, string> };
}

/**
 * Executable scenarios, keyed by the `scenarioId` a workflow manifest refers
 * to. Manifests describe a workflow; behaviour can only come from code listed
 * here, so content can never make the page run something unexpected.
 */
const RUNTIMES: Record<string, ScenarioRuntime> = {
  [CRM_SCENARIO_ID]: {
    scenario: crmScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...CRM_DEFAULT_INPUT },
    presets: CRM_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: CRM_FAULTS,
    validate(raw) {
      const result = validateCrmInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [TRIAGE_SCENARIO_ID]: {
    scenario: triageScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...TRIAGE_DEFAULT_INPUT },
    presets: TRIAGE_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: TRIAGE_FAULTS,
    validate(raw) {
      const result = validateTriageInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [SOLANA_SCENARIO_ID]: {
    scenario: solanaScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...SOLANA_DEFAULT_INPUT },
    presets: SOLANA_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: SOLANA_FAULTS,
    validate(raw) {
      const result = validateSolanaInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [STOCKS_SCENARIO_ID]: {
    scenario: stocksScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...STOCKS_DEFAULT_INPUT },
    presets: STOCKS_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: STOCKS_FAULTS,
    validate(raw) {
      const result = validateStocksInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [LEADS_SCENARIO_ID]: {
    scenario: leadsScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...LEADS_DEFAULT_INPUT },
    presets: LEADS_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: LEADS_FAULTS,
    validate(raw) {
      const result = validateLeadsInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [RATING_SCENARIO_ID]: {
    scenario: ratingScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...RATING_DEFAULT_INPUT },
    presets: RATING_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: RATING_FAULTS,
    validate(raw) {
      const result = validateRatingInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [RUGS_SCENARIO_ID]: {
    scenario: rugsScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...RUGS_DEFAULT_INPUT },
    presets: RUGS_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: RUGS_FAULTS,
    validate(raw) {
      const result = validateRugsInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
  [REVIEWS_SCENARIO_ID]: {
    scenario: reviewsScenario as unknown as Scenario<ScenarioInput>,
    defaultInput: { ...REVIEWS_DEFAULT_INPUT },
    presets: REVIEWS_PRESETS.map((preset) => ({ ...preset, input: { ...preset.input } })),
    faultIds: REVIEWS_FAULTS,
    validate(raw) {
      const result = validateReviewsInput(raw);
      return { ok: result.ok, value: { ...result.value }, errors: result.errors as Record<string, string> };
    },
  },
};

export function getScenarioRuntime(scenarioId: string): ScenarioRuntime | undefined {
  return RUNTIMES[scenarioId];
}

export function listScenarioIds(): string[] {
  return Object.keys(RUNTIMES);
}
