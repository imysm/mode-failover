import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ConfigManager } from "./config.js";
import { SelectorEngine } from "./selector/index.js";
import { HealthMonitor } from "./health/monitor.js";
import { SessionManager } from "./session/sticky.js";
import { StatsCollector } from "./stats/collector.js";
import { ModeFailoverRuntime } from "./runtime.js";
import { registerFailoverCliCommands } from "./cli.js";
// import { registerConfigCommands } from "./config-wizard.js";
import type { ModeFailoverConfig, ModelRef } from "./types.js";

// Config schema for the plugin system
const modeFailoverConfigSchema = {
  parse(value: unknown): ModeFailoverConfig {
    const manager = new ConfigManager(value);
    return manager.get();
  },
  uiHints: {
    mode: { label: "Selection Mode", help: "How to select models: random, round-robin, weighted, or smart" },
    models: { label: "Model Pool", help: "List of models to select from" },
    "models[].ref": { label: "Model Reference", placeholder: "openai/gpt-4" },
    "models[].weight": { label: "Weight", help: "Selection weight (0-100). Higher = more likely" },
    "models[].enabled": { label: "Enabled", help: "Whether this model is available" },
    "stickiness.enabled": { label: "Session Stickiness", help: "Keep same model per session" },
    "stickiness.ttlMinutes": { label: "Stickiness TTL (minutes)", advanced: true },
    "stickiness.maxSessionModels": { label: "Max Models Per Session", advanced: true },
    "failover.enabled": { label: "Auto Failover", help: "Switch to healthy models on failure" },
    "failover.errorThreshold": { label: "Error Threshold", advanced: true },
    "failover.errorWindowMinutes": { label: "Error Window (minutes)", advanced: true },
    "failover.cooldownMinutes": { label: "Cooldown (minutes)", advanced: true },
    "failover.recoveryProbeInterval": { label: "Recovery Probe (minutes)", advanced: true },
    "stats.enabled": { label: "Statistics", help: "Track model usage and performance" },
    "stats.persistInterval": { label: "Persist Interval (ms)", advanced: true },
    "stats.maxHistoryHours": { label: "History Retention (hours)", advanced: true },
  },
};

// Plugin definition
const modeFailoverPlugin = {
  id: "mode-failover",
  name: "Model Failover",
  description: "Flexible model selection with random, weighted, and smart failover modes",
  configSchema: modeFailoverConfigSchema,

  register(api: OpenClawPluginApi): void {
    const { pluginConfig, logger } = api;

    const configManager = new ConfigManager(pluginConfig);
    const cfg = configManager.get();

    if (!cfg.enabled) {
      logger.info("mode_failover plugin is disabled");
      return;
    }

    // Wrap logger to match runtime expectations
    const runtimeLogger = {
      debug: (msg: string, data?: Record<string, unknown>) => {
        if (logger.debug) {
          logger.debug(data ? `${msg} ${JSON.stringify(data)}` : msg);
        }
      },
      info: (msg: string, data?: Record<string, unknown>) => {
        logger.info(data ? `${msg} ${JSON.stringify(data)}` : msg);
      },
      warn: (msg: string, data?: Record<string, unknown>) => {
        logger.warn(data ? `${msg} ${JSON.stringify(data)}` : msg);
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        logger.error(data ? `${msg} ${JSON.stringify(data)}` : msg);
      },
    };

    const healthMonitor = new HealthMonitor(cfg.failover, runtimeLogger);
    const sessionManager = new SessionManager(cfg.stickiness);
    const statsCollector = new StatsCollector(cfg.stats);
    const selectorEngine = new SelectorEngine(cfg, healthMonitor);

    const runtime = new ModeFailoverRuntime({
      configManager,
      selectorEngine,
      healthMonitor,
      sessionManager,
      statsCollector,
      logger: runtimeLogger,
    });

    // Register CLI commands
    api.registerCli((cliCtx: any) => {
      registerFailoverCliCommands(cliCtx.program, runtime);
      // registerConfigCommands(cliCtx.program);  // Removed to avoid conflict with global config
    });

    // Hook: before_model_resolve - select model
    api.on("before_model_resolve", async (event: unknown, ctx: unknown) => {
      if (!runtime.isEnabled()) return;

      const context = ctx as { sessionKey?: string; agentId?: string };
      const sessionKey = context.sessionKey;
      if (!sessionKey) return;

      try {
        const selectedModel = await runtime.selectModel({
          sessionKey,
          agentId: context.agentId,
        });

        if (selectedModel) {
          const parts = selectedModel.ref.split("/");
          const provider = parts[0];
          const model = parts.slice(1).join("/");

          runtimeLogger.debug("Model selected by failover", { sessionKey, provider, model, mode: runtime.getMode() });

          return { providerOverride: provider, modelOverride: model };
        }
      } catch (error) {
        runtimeLogger.error("Model selection failed", { error: String(error), sessionKey });
      }
    });

    // Hook: llm_output - record stats
    api.on("llm_output", async (event: unknown, ctx: unknown) => {
      if (!runtime.isEnabled()) return;

      const context = ctx as { sessionKey?: string };
      if (!context.sessionKey) return;

      const evt = event as { provider?: string; model?: string };
      if (!evt.provider || !evt.model) return;

      const modelRef = `${evt.provider}/${evt.model}`;
      const model: ModelRef = { ref: modelRef, weight: 0, enabled: true };
      runtime.recordResult(model, true, 0);
    });

    // Hook: gateway_start - restore state
    api.on("gateway_start", async () => {
      await runtime.restoreState();
      runtime.startCleanup();
      runtimeLogger.info("mode_failover plugin initialized", { mode: cfg.mode });
    });

    // Hook: session_end - cleanup session binding
    api.on("session_end", async (event: unknown) => {
      const evt = event as { sessionKey?: string };
      if (evt.sessionKey) {
        runtime.clearSession(evt.sessionKey);
      }
    });

    runtimeLogger.info("mode_failover plugin loaded", { mode: cfg.mode, models: cfg.models.length });
  },
};

export default modeFailoverPlugin;

export type { ModeFailoverConfig, ModelRef } from "./types.js";
export { ConfigManager } from "./config.js";
export { SelectorEngine } from "./selector/index.js";
export { HealthMonitor } from "./health/monitor.js";
export { SessionManager } from "./session/sticky.js";
export { StatsCollector } from "./stats/collector.js";
export { ModeFailoverRuntime } from "./runtime.js";
