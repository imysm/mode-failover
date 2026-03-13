import type { ModelSelector, SelectionContext, ModelRef, ModeFailoverConfig } from "../types.js";

/**
 * Round-robin selector - cycles through models in order
 */
export class RoundRobinSelector implements ModelSelector {
  private defaultModels: ModelRef[];
  private currentIndex: number;

  constructor(config: ModeFailoverConfig) {
    this.defaultModels = config.models.filter(m => m.enabled !== false);
    this.currentIndex = 0;
  }

  async select(context: SelectionContext, models?: ModelRef[]): Promise<ModelRef | null> {
    const candidates = this.filterCandidates(context, models ?? this.defaultModels);
    if (candidates.length === 0) {
      return null;  // Return null instead of throwing error
    }

    // Find the next available model
    const startIndex = this.currentIndex % candidates.length;
    const model = candidates[startIndex];

    // Update index for next selection
    this.currentIndex = (this.currentIndex + 1) % candidates.length;

    return model;
  }

  private filterCandidates(context: SelectionContext, models: ModelRef[]): ModelRef[] {
    let candidates = models.filter(m => m.enabled !== false);

    if (context.excludeModels?.length) {
      const excludeSet = new Set(context.excludeModels);
      candidates = candidates.filter(m => !excludeSet.has(m.ref));
    }

    return candidates;
  }

  reset(): void {
    this.currentIndex = 0;
  }

  // For state persistence
  getState(): { currentIndex: number } {
    return { currentIndex: this.currentIndex };
  }

  setState(state: { currentIndex: number }): void {
    this.currentIndex = state.currentIndex;
  }
}
