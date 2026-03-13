import type { ModelRef, ModelHealthStats, ModelHealthStatus, FailoverConfig } from "../types.js";

interface HealthEntry {
  modelRef: string;
  stats: ModelHealthStats;
  errorHistory: Array<{ timestamp: number; error: string }>;
  cooldownUntil: number | null;
}

/**
 * Health Monitor - tracks model health status and handles failover logic
 */
export class HealthMonitor {
  private entries: Map<string, HealthEntry>;
  private config: FailoverConfig;

  constructor(config: FailoverConfig) {
    this.entries = new Map();
    this.config = config;
  }

  isHealthy(model: ModelRef): boolean {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    if (!entry) return true;

    // Check if in cooldown period
    if (entry.cooldownUntil && Date.now() < entry.cooldownUntil) {
      return false;
    }

    return entry.stats.status !== "unhealthy";
  }

  recordSuccess(model: ModelRef, latencyMs: number): void {
    const key = this.getModelKey(model);
    const entry = this.getOrCreateEntry(model);

    // Check for timeout (even on success)
    if (this.config.timeoutMs && latencyMs > this.config.timeoutMs) {
      // Treat as failure due to timeout
      this.recordFailure(model, new Error(`Request timeout after ${latencyMs}ms (threshold: ${this.config.timeoutMs}ms)`));
      return;
    }

    entry.stats.totalRequests++;
    entry.stats.successCount++;
    entry.stats.avgLatencyMs = this.updateAverage(
      entry.stats.avgLatencyMs,
      latencyMs,
      entry.stats.successCount
    );
    entry.stats.lastSuccessAt = Date.now();

    // If was in cooldown, check if can recover
    if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
      entry.cooldownUntil = null;
      entry.stats.status = "healthy";
    }

    // Update status
    this.updateStatus(entry);
  }

  recordFailure(model: ModelRef, error: Error): void {
    const key = this.getModelKey(model);
    const entry = this.getOrCreateEntry(model);

    entry.stats.totalRequests++;
    entry.stats.failureCount++;
    entry.stats.lastError = error.message;
    entry.stats.lastErrorAt = Date.now();

    // Record error history
    entry.errorHistory.push({
      timestamp: Date.now(),
      error: error.message,
    });

    // Clean up expired error records
    const windowStart = Date.now() - this.config.errorWindowMinutes * 60 * 1000;
    entry.errorHistory = entry.errorHistory.filter(e => e.timestamp >= windowStart);

    // Check if need to enter cooldown
    if (entry.errorHistory.length >= this.config.errorThreshold) {
      entry.cooldownUntil = Date.now() + this.config.cooldownMinutes * 60 * 1000;
      entry.stats.status = "unhealthy";
    }

    this.updateStatus(entry);
  }

  /**
   * Record a timeout event - immediately marks model as unhealthy
   */
  recordTimeout(model: ModelRef, latencyMs: number): void {
    const error = new Error(`Request timeout after ${latencyMs}ms (threshold: ${this.config.timeoutMs}ms)`);
    this.recordFailure(model, error);
    
    // For timeout, immediately mark as unhealthy regardless of error threshold
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);
    if (entry) {
      entry.cooldownUntil = Date.now() + this.config.cooldownMinutes * 60 * 1000;
      entry.stats.status = "unhealthy";
    }
  }

  recordResult(model: ModelRef, success: boolean, latencyMs: number): void {
    if (success) {
      this.recordSuccess(model, latencyMs);
    } else {
      this.recordFailure(model, new Error("Request failed"));
    }
  }

  getStats(model: ModelRef): ModelHealthStats {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    if (!entry) {
      return {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        status: "healthy",
      };
    }

    return { ...entry.stats };
  }

  getStatus(model: ModelRef): ModelHealthStatus {
    return this.getStats(model).status;
  }

  getCooldownInfo(model: ModelRef): { inCooldown: boolean; remainingMs: number } {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    if (!entry?.cooldownUntil) {
      return { inCooldown: false, remainingMs: 0 };
    }

    const remainingMs = Math.max(0, entry.cooldownUntil - Date.now());
    return { inCooldown: remainingMs > 0, remainingMs };
  }

  reset(model?: ModelRef): void {
    if (model) {
      this.entries.delete(this.getModelKey(model));
    } else {
      this.entries.clear();
    }
  }

  // For state persistence
  getState(): Record<string, { status: ModelHealthStatus; cooldownUntil: number | null }> {
    const result: Record<string, { status: ModelHealthStatus; cooldownUntil: number | null }> = {};
    for (const [key, entry] of this.entries.entries()) {
      result[key] = {
        status: entry.stats.status,
        cooldownUntil: entry.cooldownUntil,
      };
    }
    return result;
  }

  setState(state: Record<string, { status: ModelHealthStatus; cooldownUntil: number | null }>): void {
    for (const [key, value] of Object.entries(state)) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.stats.status = value.status;
        entry.cooldownUntil = value.cooldownUntil;
      }
    }
  }

  private getOrCreateEntry(model: ModelRef): HealthEntry {
    const key = this.getModelKey(model);
    let entry = this.entries.get(key);

    if (!entry) {
      entry = {
        modelRef: key,
        stats: {
          totalRequests: 0,
          successCount: 0,
          failureCount: 0,
          avgLatencyMs: 0,
          status: "healthy",
        },
        errorHistory: [],
        cooldownUntil: null,
      };
      this.entries.set(key, entry);
    }

    return entry;
  }

  private updateStatus(entry: HealthEntry): void {
    if (entry.cooldownUntil) {
      entry.stats.status = "unhealthy";
      return;
    }

    const errorRate = entry.stats.totalRequests > 0
      ? entry.stats.failureCount / entry.stats.totalRequests
      : 0;

    if (errorRate > 0.5) {
      entry.stats.status = "degraded";
    } else {
      entry.stats.status = "healthy";
    }
  }

  private updateAverage(current: number, newValue: number, count: number): number {
    return ((current * (count - 1)) + newValue) / count;
  }

  private getModelKey(model: ModelRef): string {
    return model.ref;
  }
}
