import type { ModelSelector, SelectionContext, ModelRef, ModeFailoverConfig } from "../types.js";
import { secureRandom } from "../utils/random.js";

interface WeightedModel extends ModelRef {
  weight: number;
}

/**
 * Weighted selector - selects models based on configured weights
 */
export class WeightedSelector implements ModelSelector {
  private defaultModels: WeightedModel[];
  private totalWeight: number;

  constructor(config: ModeFailoverConfig) {
    this.defaultModels = config.models
      .filter(m => m.enabled !== false && (m.weight ?? 0) > 0)
      .map(m => ({
        ...m,
        weight: m.weight ?? 50,
      }));
    this.totalWeight = this.defaultModels.reduce((sum, m) => sum + m.weight, 0);
  }

  async select(context: SelectionContext, models?: ModelRef[]): Promise<ModelRef> {
    const candidates = this.filterCandidates(context, models);
    if (candidates.length === 0) {
      return null  // Return null instead of throwing error;
    }

    // Use weighted random selection
    const totalWeight = candidates.reduce((sum, m) => sum + m.weight, 0);
    let random = secureRandom() * totalWeight;

    for (const model of candidates) {
      random -= model.weight;
      if (random <= 0) {
        return model;
      }
    }

    // Fallback to last model (should not reach here)
    return candidates[candidates.length - 1];
  }

  private filterCandidates(context: SelectionContext, models?: ModelRef[]): WeightedModel[] {
    const modelList = models ?? this.defaultModels;
    let candidates = modelList
      .filter(m => m.enabled !== false && (m.weight ?? 0) > 0)
      .map(m => ({
        ...m,
        weight: m.weight ?? 50,
      }));

    if (context.excludeModels?.length) {
      const excludeSet = new Set(context.excludeModels);
      candidates = candidates.filter(m => !excludeSet.has(m.ref));
    }

    return candidates;
  }

  reset(): void {
    // Weighted selector has no state
  }
}
