import type { ModelSelector, SelectionContext, ModelRef, ModeFailoverConfig } from "../types.js";
import { secureRandom } from "../utils/random.js";

/**
 * Random selector - randomly selects a model from the pool
 */
export class RandomSelector implements ModelSelector {
  private defaultModels: ModelRef[];

  constructor(config: ModeFailoverConfig) {
    this.defaultModels = config.models.filter(m => m.enabled !== false);
  }

  async select(context: SelectionContext, models?: ModelRef[]): Promise<ModelRef | null> {
    const candidates = this.filterCandidates(context, models ?? this.defaultModels);
    if (candidates.length === 0) {
      return null;  // Return null instead of throwing error
    }

    const index = Math.floor(secureRandom() * candidates.length);
    return candidates[index];
  }

  private filterCandidates(context: SelectionContext, models: ModelRef[]): ModelRef[] {
    let candidates = models.filter(m => m.enabled !== false);

    // Exclude specified models
    if (context.excludeModels?.length) {
      const excludeSet = new Set(context.excludeModels);
      candidates = candidates.filter(m => !excludeSet.has(m.ref));
    }

    return candidates;
  }

  reset(): void {
    // Random selector has no state
  }
}
