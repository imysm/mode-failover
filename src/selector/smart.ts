import type { ModelSelector, SelectionContext, ModelRef, ModeFailoverConfig } from "../types.js";
import type { HealthMonitor } from "../health/monitor.js";
import { secureRandom } from "../utils/random.js";

interface SmartModel extends ModelRef {
  baseWeight: number;
  dynamicWeight: number;
}

/**
 * Smart selector - selects models based on health status and performance
 */
export class SmartSelector implements ModelSelector {
  private defaultModels: SmartModel[];
  private healthMonitor: HealthMonitor;

  constructor(config: ModeFailoverConfig, healthMonitor: HealthMonitor) {
    this.healthMonitor = healthMonitor;
    this.defaultModels = config.models
      .filter(m => m.enabled !== false)
      .map(m => ({
        ...m,
        baseWeight: m.weight ?? 50,
        dynamicWeight: m.weight ?? 50,
      }));
  }

  async select(context: SelectionContext, models?: ModelRef[]): Promise<ModelRef | null> {
    const candidates = this.filterCandidates(context, models);
    if (candidates.length === 0) {
      return null;  // Return null instead of throwing error
    }

    // Update dynamic weights based on health
    this.updateDynamicWeights(candidates);

    // Use dynamic weights for weighted selection
    const totalWeight = candidates.reduce((sum, m) => sum + m.dynamicWeight, 0);
    if (totalWeight === 0) {
      // All models are unhealthy, fallback to base weights
      return this.selectByBaseWeight(candidates);
    }

    let random = secureRandom() * totalWeight;
    for (const model of candidates) {
      random -= model.dynamicWeight;
      if (random <= 0) {
        return model;
      }
    }

    return candidates[candidates.length - 1];
  }

  private updateDynamicWeights(models: SmartModel[]): void {
    for (const model of models) {
      const health = this.healthMonitor.getStats(model);

      if (health.status === "unhealthy") {
        model.dynamicWeight = 0;
      } else if (health.status === "degraded") {
        model.dynamicWeight = model.baseWeight * 0.3;
      } else {
        // Healthy model: adjust weight based on response time and recent errors
        const latencyFactor = this.calculateLatencyFactor(health.avgLatencyMs);
        const errorFactor = this.calculateErrorFactor(health);
        model.dynamicWeight = model.baseWeight * latencyFactor * errorFactor;
      }
    }
  }

  private calculateLatencyFactor(avgLatencyMs: number): number {
    if (avgLatencyMs === 0) return 1;

    // Lower latency = higher weight
    // Assume 2 seconds is baseline response time
    const baselineMs = 2000;
    const factor = baselineMs / Math.max(avgLatencyMs, 100);
    return Math.min(Math.max(factor, 0.5), 1.5);
  }

  /**
   * Calculate error factor - more aggressive for smart mode
   * Returns a multiplier between 0.1 and 1.0
   */
  private calculateErrorFactor(health: any): number {
    if (health.totalRequests === 0) return 1;

    const errorRate = health.failureCount / health.totalRequests;
    
    // Smart mode: very aggressive penalty for errors
    // 0% errors = 1.0 factor
    // 10% errors = 0.7 factor
    // 20% errors = 0.4 factor
    // 30%+ errors = 0.1 factor
    if (errorRate >= 0.3) return 0.1;
    if (errorRate >= 0.2) return 0.4;
    if (errorRate >= 0.1) return 0.7;
    
    return 1.0;
  }

  private selectByBaseWeight(models: SmartModel[]): ModelRef | null {
    const totalWeight = models.reduce((sum, m) => sum + m.baseWeight, 0);
    if (totalWeight === 0) {
      return null;  // No models available
    }

    let random = secureRandom() * totalWeight;

    for (const model of models) {
      random -= model.baseWeight;
      if (random <= 0) {
        return model;
      }
    }

    return models[models.length - 1];
  }

  private filterCandidates(context: SelectionContext, models?: ModelRef[]): SmartModel[] {
    const modelList = models ?? this.defaultModels;
    let candidates = modelList
      .filter(m => m.enabled !== false)
      .map(m => ({
        ...m,
        baseWeight: m.weight ?? 50,
        dynamicWeight: m.weight ?? 50,
      }));

    if (context.excludeModels?.length) {
      const excludeSet = new Set(context.excludeModels);
      candidates = candidates.filter(m => !excludeSet.has(m.ref));
    }

    return candidates;
  }

  reset(): void {
    for (const model of this.defaultModels) {
      model.dynamicWeight = model.baseWeight;
    }
  }

  updateStats(model: ModelRef, success: boolean, latencyMs: number): void {
    this.healthMonitor.recordResult(model, success, latencyMs);
    
    // Smart mode: aggressive penalty for timeouts
    // Check if latency is very high (potential timeout)
    if (!success || latencyMs > 30000) {
      // Immediately reduce weight for this model
      const smartModel = this.defaultModels.find(m => m.ref === model.ref);
      if (smartModel) {
        smartModel.dynamicWeight = Math.max(smartModel.dynamicWeight * 0.1, 1);
      }
    }
  }
}
