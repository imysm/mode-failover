import type { ModelSelector, SelectionContext, ModelRef, ModeFailoverConfig, SelectorMode } from "../types.js";
import type { HealthMonitor } from "../health/monitor.js";
import { RandomSelector } from "./random.js";
import { RoundRobinSelector } from "./round-robin.js";
import { WeightedSelector } from "./weighted.js";
import { SmartSelector } from "./smart.js";

/**
 * Selector Engine - manages different model selection strategies
 */
export class SelectorEngine {
  private selectors: Map<SelectorMode, ModelSelector>;
  private currentMode: SelectorMode;

  constructor(config: ModeFailoverConfig, healthMonitor: HealthMonitor) {
    this.selectors = new Map();
    this.selectors.set("random", new RandomSelector(config));
    this.selectors.set("round-robin", new RoundRobinSelector(config));
    this.selectors.set("weighted", new WeightedSelector(config));
    this.selectors.set("smart", new SmartSelector(config, healthMonitor));
    this.currentMode = config.mode;
  }

  async select(context: SelectionContext, config?: ModeFailoverConfig): Promise<ModelRef> {
    // If config provided, use it; otherwise use current mode
    const mode = config?.mode ?? this.currentMode;
    const models = config?.models;
    
    const selector = this.selectors.get(mode);
    if (!selector) {
      throw new Error(`Unknown selector mode: ${mode}`);
    }
    
    // Pass models to selector if provided
    return selector.select(context, models);
  }

  setMode(mode: SelectorMode): void {
    if (!this.selectors.has(mode)) {
      throw new Error(`Unknown selector mode: ${mode}`);
    }
    this.currentMode = mode;
  }

  getMode(): SelectorMode {
    return this.currentMode;
  }

  reset(): void {
    for (const selector of this.selectors.values()) {
      selector.reset();
    }
  }

  updateStats(model: ModelRef, success: boolean, latencyMs: number): void {
    const selector = this.selectors.get(this.currentMode);
    if (selector?.updateStats) {
      selector.updateStats(model, success, latencyMs);
    }
  }

  // For round-robin state persistence
  getRoundRobinState(): { currentIndex: number } | null {
    const selector = this.selectors.get("round-robin");
    if (selector instanceof RoundRobinSelector) {
      return selector.getState();
    }
    return null;
  }

  setRoundRobinState(state: { currentIndex: number }): void {
    const selector = this.selectors.get("round-robin");
    if (selector instanceof RoundRobinSelector) {
      selector.setState(state);
    }
  }
}
