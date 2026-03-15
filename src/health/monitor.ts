import type { ModelRef, ModelHealthStats, ModelHealthStatus, FailoverConfig, ErrorType, ErrorTypeCategory } from "../types.js";
import { errorClassifier } from "../error/classifier.js";

interface HealthEntry {
  modelRef: string;
  stats: ModelHealthStats;
  errorHistory: Array<{ timestamp: number; error: string; errorType: ErrorType }>;
  cooldownUntil: number | null;
  disabledUntil: number | null; // New in v1.0.5
  disableReason: ErrorType | null; // New in v1.0.5
}

interface Logger {
  debug?: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Health Monitor - tracks model health status and handles failover logic
 * v1.0.5: Added error classification support
 */
export class HealthMonitor {
  private entries: Map<string, HealthEntry>;
  private config: FailoverConfig;
  private logger: Logger;

  constructor(config: FailoverConfig, logger: Logger = console) {
    this.entries = new Map();
    this.config = config;
    this.logger = logger;
  }

  /**
   * Check if model is healthy (available for selection)
   */
  isHealthy(model: ModelRef): boolean {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    if (!entry) return true;

    // Check if in cooldown period (legacy failover)
    if (entry.cooldownUntil && Date.now() < entry.cooldownUntil) {
      return false;
    }

    // Check if in error-based disabled period (v1.0.5)
    if (entry.disabledUntil && Date.now() < entry.disabledUntil) {
      return false;
    }

    return entry.stats.status !== "unhealthy";
  }

  /**
   * Record successful request
   */
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
    const now = Date.now();
    let recovered = false;

    if (entry.cooldownUntil && now >= entry.cooldownUntil) {
      entry.cooldownUntil = null;
      recovered = true;
    }

    if (entry.disabledUntil && now >= entry.disabledUntil) {
      this.logger.info?.("Model auto-recovered from error-based disable", {
        model: key,
        reason: entry.disableReason || "unknown",
      });
      entry.disabledUntil = null;
      entry.stats.disabledUntil = undefined;
      entry.stats.disableReason = undefined;
      entry.stats.status = "healthy";
      recovered = true;
    }

    if (recovered) {
      this.logger.info?.("Model recovered", { model: key });
    }

    // Update status
    this.updateStatus(entry);
  }

  /**
   * Record failed request with error classification (v1.0.5)
   */
  recordFailure(model: ModelRef, error: Error): void {
    const key = this.getModelKey(model);
    const entry = this.getOrCreateEntry(model);

    entry.stats.totalRequests++;
    entry.stats.failureCount++;
    entry.stats.lastError = error.message;
    entry.stats.lastErrorAt = Date.now();

    // Classify error (v1.0.5)
    const { type: errorType, category } = errorClassifier.classify(error);
    entry.stats.lastErrorType = errorType;

    // Check if error should be ignored (business errors)
    if (this.config.errorHandling?.enabled) {
      if (errorClassifier.shouldIgnore(errorType, this.config.errorHandling.ignoreErrors)) {
        this.logger.debug?.("Error ignored (business error)", {
          model: key,
          errorType,
          message: error.message,
        });
        return; // Don't disable model for business errors
      }
    }

    // Record error history with type (v1.0.5)
    entry.errorHistory.push({
      timestamp: Date.now(),
      error: error.message,
      errorType,
    });

    // Clean up expired error records
    const windowStart = Date.now() - this.config.errorWindowMinutes * 60 * 1000;
    entry.errorHistory = entry.errorHistory.filter(e => e.timestamp >= windowStart);

    // Handle error based on new classification (v1.0.5)
    if (this.config.errorHandling?.enabled) {
      this.handleErrorClassification(model, entry, errorType, category);
    } else {
      // Legacy behavior: use error threshold
      if (entry.errorHistory.length >= this.config.errorThreshold) {
        entry.cooldownUntil = Date.now() + this.config.cooldownMinutes * 60 * 1000;
        entry.stats.status = "unhealthy";
        this.logger.info?.("Model marked unhealthy (legacy failover)", {
          model: key,
          errorCount: entry.errorHistory.length,
          cooldownMinutes: this.config.cooldownMinutes,
        });
      }
    }

    this.updateStatus(entry);
  }

  /**
   * Handle error-based classification (v1.0.5)
   */
  private handleErrorClassification(
    model: ModelRef,
    entry: HealthEntry,
    errorType: ErrorType,
    category: ErrorTypeCategory,
  ): void {
    const key = this.getModelKey(model);

    // Get error handling rule
    const rule = this.getErrorHandlingRule(errorType);

    // Permanent errors: disable immediately, require manual recovery
    if (category === "permanent" || rule.disableDuration === 0) {
      entry.disabledUntil = null; // Permanent
      entry.stats.disabledUntil = null;
      entry.disableReason = errorType;
      entry.stats.disableReason = errorType;
      entry.stats.status = "unhealthy";

      this.logger.warn?.("Model permanently disabled (manual recovery required)", {
        model: key,
        errorType,
        error: entry.stats.lastError,
        command: `openclaw failover recover ${key}`,
      });
      return;
    }

    // Transient errors: apply disable duration
    if (category === "transient") {
      const disableSeconds = rule.disableDuration;

      // Only disable if not already disabled or if new error type requires longer duration
      const now = Date.now();
      const currentDisabledUntil = entry.disabledUntil || 0;

      // Extend or set new disable period
      if (now >= currentDisabledUntil) {
        entry.disabledUntil = Date.now() + disableSeconds * 1000;
        entry.stats.disabledUntil = entry.disabledUntil;
        entry.disableReason = errorType;
        entry.stats.disableReason = errorType;
        entry.stats.status = "unhealthy";

        this.logger.info?.("Model temporarily disabled", {
          model: key,
          errorType,
          disableDuration: `${disableSeconds}s`,
        });
      }
    }

    // Business errors: should not reach here (filtered earlier)
  }

  /**
   * Get error handling rule for error type (v1.0.5)
   */
  private getErrorHandlingRule(errorType: ErrorType): { disableDuration: number; maxRetries: number } {
    if (!this.config.errorHandling?.enabled) {
      return { disableDuration: this.config.cooldownMinutes * 60, maxRetries: 3 };
    }

    // Check transient errors
    if (errorType in (this.config.errorHandling.transientErrors || {})) {
      return this.config.errorHandling.transientErrors[errorType];
    }

    // Check permanent errors
    if (errorType in (this.config.errorHandling.permanentErrors || {})) {
      return this.config.errorHandling.permanentErrors[errorType];
    }

    // Default: use generic transient rule
    return { disableDuration: 60, maxRetries: 3 };
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

  getCooldownInfo(model: ModelRef): {
    inCooldown: boolean;
    remainingMs: number;
    reason?: ErrorType | null;
  } {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    // Check error-based disable first (v1.0.5)
    if (entry?.disabledUntil) {
      const remainingMs = Math.max(0, entry.disabledUntil - Date.now());
      if (remainingMs > 0) {
        return {
          inCooldown: true,
          remainingMs,
          reason: entry.disableReason,
        };
      }
    }

    // Fall back to legacy cooldown
    if (entry?.cooldownUntil) {
      const remainingMs = Math.max(0, entry.cooldownUntil - Date.now());
      return {
        inCooldown: remainingMs > 0,
        remainingMs,
        reason: null,
      };
    }

    return { inCooldown: false, remainingMs: 0, reason: null };
  }

  /**
   * Manually recover a model (v1.0.5)
   */
  recover(model: ModelRef): boolean {
    const key = this.getModelKey(model);
    const entry = this.entries.get(key);

    if (!entry) {
      this.logger.warn?.("Model not found in health monitor", { model: key });
      return false;
    }

    // Clear all disable states
    entry.cooldownUntil = null;
    entry.disabledUntil = null;
    entry.disableReason = null;
    entry.stats.disabledUntil = undefined;
    entry.stats.disableReason = undefined;
    entry.stats.status = "healthy";

    this.logger.info?.("Model manually recovered", { model: key });
    return true;
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
        disabledUntil: null,
        disableReason: null,
      };
      this.entries.set(key, entry);
    }

    return entry;
  }

  private updateStatus(entry: HealthEntry): void {
    if (entry.cooldownUntil || entry.disabledUntil) {
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
