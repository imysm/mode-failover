import { z } from "zod";
import {
  ModeFailoverConfigSchema,
  type ModeFailoverConfig,
  type ModelRef,
} from "./types.js";

/**
 * Deep merge two objects (agent config overrides global config)
 */
function deepMerge<T extends Record<string, unknown>>(
  global: T,
  agent: Partial<T>
): T {
  const result = { ...global };

  for (const key in agent) {
    const agentValue = agent[key];
    const globalValue = global[key];

    if (
      agentValue !== undefined &&
      typeof agentValue === "object" &&
      agentValue !== null &&
      !Array.isArray(agentValue) &&
      typeof globalValue === "object" &&
      globalValue !== null &&
      !Array.isArray(globalValue)
    ) {
      // Deep merge objects
      result[key] = deepMerge(
        globalValue as Record<string, unknown>,
        agentValue as Record<string, unknown>
      ) as T[Extract<keyof T, string>];
    } else if (agentValue !== undefined) {
      // Override with agent value
      result[key] = agentValue as T[Extract<keyof T, string>];
    }
  }

  return result;
}

export class ConfigManager {
  private config: ModeFailoverConfig;

  constructor(rawConfig: unknown) {
    this.config = this.parse(rawConfig);
    this.validate();
  }

  private parse(raw: unknown): ModeFailoverConfig {
    const input = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};

    // Apply defaults for nested objects
    const failoverInput = typeof input.failover === "object" && input.failover !== null
      ? input.failover as Record<string, unknown>
      : {};
    const errorHandlingInput = typeof failoverInput.errorHandling === "object" && failoverInput.errorHandling !== null
      ? failoverInput.errorHandling as Record<string, unknown>
      : {};

    const config = {
      enabled: typeof input.enabled === "boolean" ? input.enabled : true,
      mode: (input.mode ?? "weighted") as ModeFailoverConfig["mode"],
      models: Array.isArray(input.models) ? input.models as ModeFailoverConfig["models"] : [],
      stickiness: {
        enabled: false,
        ttlMinutes: 10,
        maxSessionModels: 1,
        ...(typeof input.stickiness === "object" ? input.stickiness : {}),
      },
      failover: {
        enabled: typeof failoverInput.enabled === "boolean" ? failoverInput.enabled : false,
        errorThreshold: typeof failoverInput.errorThreshold === "number" ? failoverInput.errorThreshold : 1,
        errorWindowMinutes: typeof failoverInput.errorWindowMinutes === "number" ? failoverInput.errorWindowMinutes : 5,
        cooldownMinutes: typeof failoverInput.cooldownMinutes === "number" ? failoverInput.cooldownMinutes : 30,
        recoveryProbeInterval: typeof failoverInput.recoveryProbeInterval === "number" ? failoverInput.recoveryProbeInterval : 5,
        timeoutMs: typeof failoverInput.timeoutMs === "number" ? failoverInput.timeoutMs : 30000,
        // v1.0.5: Error handling defaults
        errorHandling: {
          enabled: typeof errorHandlingInput.enabled === "boolean" ? errorHandlingInput.enabled : false,
          transientErrors: typeof errorHandlingInput.transientErrors === "object" && errorHandlingInput.transientErrors !== null
            ? errorHandlingInput.transientErrors as ModeFailoverConfig["failover"]["errorHandling"]["transientErrors"]
            : {
                "rate_limit": { disableDuration: 60, maxRetries: 3 },
                "timeout": { disableDuration: 30, maxRetries: 2 },
                "network_error": { disableDuration: 30, maxRetries: 3 },
                "server_error": { disableDuration: 120, maxRetries: 2 },
              },
          permanentErrors: typeof errorHandlingInput.permanentErrors === "object" && errorHandlingInput.permanentErrors !== null
            ? errorHandlingInput.permanentErrors as ModeFailoverConfig["failover"]["errorHandling"]["permanentErrors"]
            : {
                "auth_error": { disableDuration: 0, maxRetries: 0, requireManualRecovery: true },
                "not_found": { disableDuration: 0, maxRetries: 0, requireManualRecovery: true },
              },
          ignoreErrors: Array.isArray(errorHandlingInput.ignoreErrors) ? errorHandlingInput.ignoreErrors : ["invalid_request", "content_filter"],
        },
      },
      stats: {
        enabled: false,
        persistInterval: 60000,
        maxHistoryHours: 24,
        ...(typeof input.stats === "object" ? input.stats : {}),
      },
      agents: typeof input.agents === "object" ? input.agents as ModeFailoverConfig["agents"] : {},
    };

    return ModeFailoverConfigSchema.parse(config);
  }

  private validate(): void {
    const cfg = this.config;

    // Validate models
    if (cfg.models.length === 0) {
      throw new Error("At least one model must be configured");
    }

    // Validate model refs format
    for (const model of cfg.models) {
      const parts = model.ref.split("/");
      if (parts.length !== 2) {
        throw new Error(`Invalid model ref format: ${model.ref}. Expected "provider/model"`);
      }
    }

    // Validate weight sum for weighted mode
    if (cfg.mode === "weighted") {
      const totalWeight = cfg.models.reduce((sum, m) => sum + (m.enabled ? m.weight : 0), 0);
      if (totalWeight === 0) {
        throw new Error("At least one enabled model must have weight > 0 in weighted mode");
      }
    }

    // Validate agent configs
    if (cfg.agents) {
      for (const [agentId, agentConfig] of Object.entries(cfg.agents)) {
        if (agentConfig.config?.models) {
          for (const model of agentConfig.config.models) {
            const parts = model.ref.split("/");
            if (parts.length !== 2) {
              throw new Error(`Invalid model ref format in agent ${agentId}: ${model.ref}`);
            }
          }
        }
      }
    }
  }

  get(): ModeFailoverConfig {
    return this.config;
  }

  /**
   * Get config for a specific agent (with agent-level overrides)
   * 
   * Logic:
   * 1. No agentId → return global config
   * 2. agentId not in agents config → return global config
   * 3. agentId in agents, enabled=false → return null (plugin disabled for this agent)
   * 4. agentId in agents, enabled=true → deep merge agent config with global config
   */
  getConfigForAgent(agentId?: string): ModeFailoverConfig | null {
    // Case 1 & 2: No agentId or not configured → use global config
    if (!agentId || !this.config.agents || !this.config.agents[agentId]) {
      return this.config;
    }

    const agentEntry = this.config.agents[agentId];

    // Case 3: Agent explicitly disabled
    if (agentEntry.enabled === false) {
      return null;
    }

    // Case 4: Merge agent config with global config
    if (!agentEntry.config) {
      return this.config;
    }

    // Deep merge: agent config overrides global config
    const mergedConfig = deepMerge(this.config, agentEntry.config as Partial<ModeFailoverConfig>);

    // Re-validate merged config
    try {
      ModeFailoverConfigSchema.parse(mergedConfig);
    } catch (error) {
      throw new Error(`Invalid merged config for agent ${agentId}: ${error}`);
    }

    return mergedConfig;
  }

  getEnabledModels(agentId?: string): ModelRef[] {
    const config = this.getConfigForAgent(agentId);
    if (!config) return [];
    return config.models.filter(m => m.enabled && m.weight > 0);
  }

  getAllModels(): ModelRef[] {
    return this.config.models;
  }

  updateConfig(updates: Partial<ModeFailoverConfig>): void {
    this.config = ModeFailoverConfigSchema.parse({
      ...this.config,
      ...updates,
    });
    this.validate();
  }

  setMode(mode: ModeFailoverConfig["mode"]): void {
    this.config.mode = mode;
    this.validate();
  }

  addModel(model: ModelRef): void {
    // Check if model already exists
    const existing = this.config.models.find(m => m.ref === model.ref);
    if (existing) {
      // Update existing model
      Object.assign(existing, model);
    } else {
      this.config.models.push(model);
    }
    this.validate();
  }

  removeModel(ref: string): boolean {
    const index = this.config.models.findIndex(m => m.ref === ref);
    if (index >= 0) {
      this.config.models.splice(index, 1);
      this.validate();
      return true;
    }
    return false;
  }
}

// Config schema for openclaw.plugin.json
export const modeFailoverConfigSchema = {
  parse(value: unknown): ModeFailoverConfig {
    const manager = new ConfigManager(value);
    return manager.get();
  },
};
