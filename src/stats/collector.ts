import type { ModelRef, ModelUsageStats, HourlyStats, StatsConfig } from "../types.js";

/**
 * Stats Collector - collects and persists model usage statistics
 */
export class StatsCollector {
  private stats: Map<string, ModelUsageStats>;
  private config: StatsConfig;
  private persistTimer?: ReturnType<typeof setInterval>;
  private persistCallback?: () => void;

  constructor(config: StatsConfig) {
    this.stats = new Map();
    this.config = config;

    if (config.enabled) {
      this.startPersistTimer();
    }
  }

  record(model: ModelRef, success: boolean, latencyMs: number): void {
    if (!this.config.enabled) return;

    const key = this.getModelKey(model);
    let stats = this.stats.get(key);

    if (!stats) {
      stats = this.createEmptyStats();
      this.stats.set(key, stats);
    }

    // Update totals
    stats.totalRequests++;
    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }
    stats.avgLatencyMs = (stats.avgLatencyMs * (stats.totalRequests - 1) + latencyMs) / stats.totalRequests;

    // Update hourly stats
    const hour = this.getCurrentHour();
    let hourly = stats.hourlyStats[hour];
    if (!hourly) {
      hourly = { hour, requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 };
      stats.hourlyStats[hour] = hourly;
    }
    hourly.requests++;
    if (success) {
      hourly.successes++;
    } else {
      hourly.failures++;
    }
    hourly.totalLatencyMs += latencyMs;

    // Update status
    this.updateStatus(stats);
  }

  getStats(model: ModelRef): ModelUsageStats | null {
    return this.stats.get(this.getModelKey(model)) ?? null;
  }

  getAllStats(): Record<string, ModelUsageStats> {
    const result: Record<string, ModelUsageStats> = {};
    for (const [key, stats] of this.stats.entries()) {
      result[key] = stats;
    }
    return result;
  }

  reset(model?: ModelRef): void {
    if (model) {
      this.stats.delete(this.getModelKey(model));
    } else {
      this.stats.clear();
    }
  }

  cleanup(): number {
    const cutoffHour = Date.now() - this.config.maxHistoryHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const stats of this.stats.values()) {
      for (const [hour, _] of Object.entries(stats.hourlyStats)) {
        if (parseInt(hour) < cutoffHour) {
          delete stats.hourlyStats[hour];
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  setPersistCallback(callback: () => void): void {
    this.persistCallback = callback;
  }

  destroy(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
    }
    this.persist();
  }

  private createEmptyStats(): ModelUsageStats {
    return {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      status: "healthy",
      hourlyStats: {},
    };
  }

  private updateStatus(stats: ModelUsageStats): void {
    const errorRate = stats.totalRequests > 0
      ? stats.failureCount / stats.totalRequests
      : 0;

    if (errorRate > 0.5) {
      stats.status = "unhealthy";
    } else if (errorRate > 0.2) {
      stats.status = "degraded";
    } else {
      stats.status = "healthy";
    }
  }

  private getCurrentHour(): number {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now.getTime();
  }

  private getModelKey(model: ModelRef): string {
    return model.ref;
  }

  private startPersistTimer(): void {
    this.persistTimer = setInterval(() => {
      this.persist();
    }, this.config.persistInterval);
  }

  private persist(): void {
    if (this.persistCallback) {
      this.persistCallback();
    }
  }
}
