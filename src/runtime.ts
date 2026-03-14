import { ConfigManager } from "./config.js";
import { SelectorEngine } from "./selector/index.js";
import { HealthMonitor } from "./health/monitor.js";
import { SessionManager } from "./session/sticky.js";
import { StatsCollector } from "./stats/collector.js";
import type {
  ModeFailoverConfig,
  ModelRef,
  SelectionContext,
  PluginState,
  PluginStatus,
  SelectorMode,
  ModelHealthStatus,
} from "./types.js";
import * as fs from "fs";
import * as path from "path";

export interface ModeFailoverRuntimeOptions {
  configManager: ConfigManager;
  selectorEngine: SelectorEngine;
  healthMonitor: HealthMonitor;
  sessionManager: SessionManager;
  statsCollector: StatsCollector;
  logger: {
    debug?: (message: string, data?: Record<string, unknown>) => void;
    info: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
  stateDir?: string;
}

/**
 * Runtime manager for the mode_failover plugin
 */
export class ModeFailoverRuntime {
  private configManager: ConfigManager;
  private selectorEngine: SelectorEngine;
  private healthMonitor: HealthMonitor;
  private sessionManager: SessionManager;
  private statsCollector: StatsCollector;
  private logger: ModeFailoverRuntimeOptions["logger"];
  private stateDir: string;
  private enabled: boolean = true;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: ModeFailoverRuntimeOptions) {
    this.configManager = options.configManager;
    this.selectorEngine = options.selectorEngine;
    this.healthMonitor = options.healthMonitor;
    this.sessionManager = options.sessionManager;
    this.statsCollector = options.statsCollector;
    this.logger = options.logger;
    this.stateDir = options.stateDir ?? process.env.OPENCLAW_STATE_DIR ?? path.join(process.env.HOME ?? "", ".openclaw", "mode-failover");

    // Set up stats persistence callback
    this.statsCollector.setPersistCallback(() => this.persistState());
  }

  async selectModel(context: SelectionContext): Promise<ModelRef | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      // Get config for this agent (with agent-level overrides)
      const config = this.configManager.getConfigForAgent(context.agentId);
      
      // If null, plugin is disabled for this agent
      if (!config) {
        this.logger.debug?.("Plugin disabled for agent", { agentId: context.agentId });
        return null;
      }

      // Check session stickiness first
      const stickyModel = this.sessionManager.getModel(context.sessionKey);
      if (stickyModel) {
        this.logger.debug?.("Using sticky model", { sessionKey: context.sessionKey, model: stickyModel.ref });
        return stickyModel;
      }

      // Get unhealthy models to exclude
      const excludeModels: string[] = [];

      if (config.failover.enabled) {
        for (const model of config.models) {
          if (!this.healthMonitor.isHealthy(model)) {
            excludeModels.push(model.ref);
          }
        }
      }

      // Select using the configured strategy
      const selectedModel = await this.selectorEngine.select({
        ...context,
        excludeModels: excludeModels.length > 0 ? excludeModels : undefined,
      }, config);

      // Set session binding
      this.sessionManager.setModel(context.sessionKey, selectedModel);

      this.logger.debug?.("Selected model", {
        sessionKey: context.sessionKey,
        agentId: context.agentId,
        model: selectedModel.ref,
        mode: config.mode,
      });

      return selectedModel;
    } catch (error) {
      this.logger.error?.("Model selection failed", { error: String(error), sessionKey: context.sessionKey });
      return null;
    }
  }

  recordResult(model: ModelRef, success: boolean, latencyMs: number): void {
    if (!this.enabled) return;

    // Check for timeout (even on success)
    const config = this.configManager.get();
    if (config.failover.timeoutMs && latencyMs > config.failover.timeoutMs) {
      this.healthMonitor.recordTimeout(model, latencyMs);
      this.statsCollector.record(model, false, latencyMs);
      this.selectorEngine.updateStats(model, false, latencyMs);
      this.logger.warn?.("Request timeout detected", {
        model: model.ref,
        latencyMs,
        thresholdMs: config.failover.timeoutMs,
      });
      return;
    }

    // Record to health monitor
    if (success) {
      this.healthMonitor.recordSuccess(model, latencyMs);
    } else {
      this.healthMonitor.recordFailure(model, new Error("Request failed"));
    }

    // Record to stats collector
    this.statsCollector.record(model, success, latencyMs);

    // Update selector stats
    this.selectorEngine.updateStats(model, success, latencyMs);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger.info?.(`Failover plugin ${enabled ? "enabled" : "disabled"}`);
  }

  getStatus(): PluginStatus {
    const config = this.configManager.get();
    const models = config.models.map(m => ({
      ref: m.ref,
      weight: m.weight,
      enabled: m.enabled,
      status: this.healthMonitor.getStatus(m),
    }));

    return {
      enabled: this.enabled,
      mode: this.selectorEngine.getMode(),
      modelCount: config.models.length,
      models,
      activeSessions: this.sessionManager.getActiveSessionCount(),
    };
  }

  getStats(): Record<string, ReturnType<StatsCollector["getAllStats"]>[string]> {
    return this.statsCollector.getAllStats();
  }

  setMode(mode: SelectorMode): void {
    this.configManager.setMode(mode);
    this.selectorEngine.setMode(mode);
    this.logger.info?.("Mode changed", { mode });
  }

  getMode(): SelectorMode {
    return this.selectorEngine.getMode();
  }

  addModel(model: ModelRef): void {
    this.configManager.addModel(model);
    this.logger.info?.("Model added", { ref: model.ref, weight: model.weight });
  }

  removeModel(ref: string): boolean {
    const removed = this.configManager.removeModel(ref);
    if (removed) {
      this.logger.info?.("Model removed", { ref });
    }
    return removed;
  }

  resetStats(): void {
    this.statsCollector.reset();
    this.healthMonitor.reset();
    this.logger.info?.("Statistics reset");
  }

  clearPersistedState(): void {
    // Clear runtime health state
    this.healthMonitor.reset();
    this.sessionManager.clearAll();

    // Delete state file
    try {
      const stateFile = path.join(this.stateDir, "state.json");
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
        this.logger.info?.("State file deleted");
      }
    } catch (error) {
      this.logger.error?.("Failed to delete state file", { error: String(error) });
    }

    this.logger.info?.("Persisted state cleared");
  }

  clearSession(sessionKey: string): void {
    this.sessionManager.clear(sessionKey);
  }

  async restoreState(): Promise<void> {
    try {
      const stateFile = path.join(this.stateDir, "state.json");
      if (!fs.existsSync(stateFile)) {
        this.logger.debug?.("No state file found, starting fresh");
        return;
      }

      const content = await fs.promises.readFile(stateFile, "utf-8");
      const state: PluginState = JSON.parse(content);

      this.enabled = state.enabled ?? true;
      this.selectorEngine.setMode(state.mode);

      if (state.roundRobinIndex !== undefined) {
        this.selectorEngine.setRoundRobinState({ currentIndex: state.roundRobinIndex });
      }

      this.sessionManager.setState(state.sessionModels);
      this.healthMonitor.setState(state.modelHealth as Record<string, { status: ModelHealthStatus; cooldownUntil: number | null }>);

      this.logger.info?.("State restored", { mode: state.mode, enabled: this.enabled });
    } catch (error) {
      this.logger.error?.("Failed to restore state", { error: String(error) });
    }
  }

  async persistState(): Promise<void> {
    try {
      await fs.promises.mkdir(this.stateDir, { recursive: true });

      const state: PluginState = {
        version: 1,
        mode: this.selectorEngine.getMode(),
        roundRobinIndex: this.selectorEngine.getRoundRobinState()?.currentIndex ?? 0,
        sessionModels: this.sessionManager.getState(),
        modelHealth: this.healthMonitor.getState(),
        enabled: this.enabled,
      };

      const stateFile = path.join(this.stateDir, "state.json");
      await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2));

      this.logger.debug?.("State persisted");
    } catch (error) {
      this.logger.error?.("Failed to persist state", { error: String(error) });
    }
  }

  startCleanup(intervalMs: number = 60 * 60 * 1000): void {
    this.cleanupTimer = setInterval(() => {
      const sessionCleaned = this.sessionManager.cleanup();
      const statsCleaned = this.statsCollector.cleanup();
      this.logger.debug?.("Cleanup completed", { sessionCleaned, statsCleaned });
    }, intervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  destroy(): void {
    this.stopCleanup();
    this.statsCollector.destroy();
    this.persistState();
  }
}
