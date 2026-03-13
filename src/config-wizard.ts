import type { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import type { ModeFailoverConfig, ModelRef } from "./types.js";

/**
 * Register config wizard commands
 */
export function registerConfigCommands(program: Command): void {
  const config = program.command("config")
    .description("Configuration wizard for mode-failover plugin");

  // Interactive wizard
  config.command("wizard")
    .description("Interactive configuration wizard")
    .option("--agent <agent-id>", "Configure for specific agent")
    .action(async (options: { agent?: string }) => {
      await runWizard(options.agent);
    });

  // Quick setup
  config.command("setup")
    .description("Quick setup with basic configuration")
    .option("--mode <mode>", "Selection mode (random|round-robin|weighted|smart)")
    .option("--models <models>", "Comma-separated model refs (e.g., zai/glm-5,zai/glm-4.7)")
    .option("--weights <weights>", "Comma-separated weights (e.g., 60,40)")
    .option("--agent <agent-id>", "Configure for specific agent")
    .action(async (options: { mode?: string; models?: string; weights?: string; agent?: string }) => {
      await quickSetup(options);
    });

  // Add model
  config.command("add-model <model-ref>")
    .description("Add a model to the pool")
    .option("--weight <weight>", "Model weight (0-100)", "50")
    .option("--agent <agent-id>", "Add to specific agent config")
    .action(async (modelRef: string, options: { weight: string; agent?: string }) => {
      await addModel(modelRef, options.weight, options.agent);
    });

  // Remove model
  config.command("remove-model <model-ref>")
    .description("Remove a model from the pool")
    .option("--agent <agent-id>", "Remove from specific agent config")
    .action(async (modelRef: string, options: { agent?: string }) => {
      await removeModel(modelRef, options.agent);
    });

  // Set mode
  config.command("set-mode <mode>")
    .description("Set selection mode")
    .option("--agent <agent-id>", "Set mode for specific agent")
    .action(async (mode: string, options: { agent?: string }) => {
      await setMode(mode, options.agent);
    });

  // Enable/disable agent
  config.command("enable-agent <agent-id>")
    .description("Enable plugin for specific agent")
    .action(async (agentId: string) => {
      await setAgentEnabled(agentId, true);
    });

  config.command("disable-agent <agent-id>")
    .description("Disable plugin for specific agent")
    .action(async (agentId: string) => {
      await setAgentEnabled(agentId, false);
    });

  // Show config
  config.command("show")
    .description("Show current configuration")
    .option("--agent <agent-id>", "Show config for specific agent")
    .action(async (options: { agent?: string }) => {
      await showConfig(options.agent);
    });

  // Reset state
  config.command("reset-state")
    .description("Reset plugin state (clear caches)")
    .action(async () => {
      await resetState();
    });
}

/**
 * Interactive configuration wizard
 */
async function runWizard(agentId?: string): Promise<void> {
  console.log("\n🎨 Mode Failover Configuration Wizard");
  console.log("═".repeat(50));

  if (agentId) {
    console.log(`Configuring for agent: ${agentId}\n`);
  } else {
    console.log("Configuring global settings\n");
  }

  // This would use inquirer or similar in production
  // For now, show instructions
  console.log("📋 Steps:");
  console.log("1. Choose selection mode (random/round-robin/weighted/smart)");
  console.log("2. Add models to the pool");
  console.log("3. Set weights for each model");
  console.log("4. Configure optional settings");
  console.log("\n💡 Use these commands:");
  console.log("  openclaw failover config set-mode <mode>");
  console.log("  openclaw failover config add-model <model-ref> --weight <weight>");
  console.log("  openclaw failover config show");
  console.log();

  process.exit(0);
}

/**
 * Quick setup with parameters
 */
async function quickSetup(options: {
  mode?: string;
  models?: string;
  weights?: string;
  agent?: string;
}): Promise<void> {
  const configPath = getConfigPath();

  // Validate mode
  const validModes = ["random", "round-robin", "weighted", "smart"];
  const mode = options.mode || "weighted";
  if (!validModes.includes(mode)) {
    console.error(`❌ Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`);
    process.exit(1);
  }

  // Parse models
  if (!options.models) {
    console.error("❌ --models is required");
    process.exit(1);
  }
  const modelRefs = options.models.split(",").map(m => m.trim());

  // Parse weights
  let weights: number[] = [];
  if (options.weights) {
    weights = options.weights.split(",").map(w => parseInt(w.trim(), 10));
    if (weights.some(w => isNaN(w) || w < 0 || w > 100)) {
      console.error("❌ Invalid weights. Must be numbers between 0 and 100");
      process.exit(1);
    }
  } else {
    // Default: equal weights
    weights = modelRefs.map(() => Math.round(100 / modelRefs.length));
  }

  // Build models array
  const models: ModelRef[] = modelRefs.map((ref, i) => ({
    ref,
    weight: weights[i] || 50,
    enabled: true,
  }));

  // Read current config
  let config = readConfig(configPath);

  // Update config
  if (options.agent) {
    // Agent-specific config
    if (!config.plugins.entries["mode-failover"].config.agents) {
      config.plugins.entries["mode-failover"].config.agents = {};
    }
    config.plugins.entries["mode-failover"].config.agents[options.agent] = {
      enabled: true,
      config: { mode, models },
    };
  } else {
    // Global config
    config.plugins.entries["mode-failover"].config.mode = mode;
    config.plugins.entries["mode-failover"].config.models = models;
  }

  // Write config
  writeConfig(configPath, config);

  console.log(`✅ Configuration updated${options.agent ? ` for agent: ${options.agent}` : ""}`);
  console.log(`   Mode: ${mode}`);
  console.log(`   Models: ${models.map(m => `${m.ref}(${m.weight})`).join(", ")}`);
  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");
  console.log("💡 Reset state to clear caches: openclaw failover config reset-state");

  process.exit(0);
}

/**
 * Add model to pool
 */
async function addModel(modelRef: string, weightStr: string, agentId?: string): Promise<void> {
  const weight = parseInt(weightStr, 10);
  if (isNaN(weight) || weight < 0 || weight > 100) {
    console.error("❌ Weight must be a number between 0 and 100");
    process.exit(1);
  }

  const configPath = getConfigPath();
  let config = readConfig(configPath);

  const model: ModelRef = { ref: modelRef, weight, enabled: true };

  if (agentId) {
    // Add to agent config
    if (!config.plugins.entries["mode-failover"].config.agents) {
      config.plugins.entries["mode-failover"].config.agents = {};
    }
    if (!config.plugins.entries["mode-failover"].config.agents[agentId]) {
      config.plugins.entries["mode-failover"].config.agents[agentId] = {
        enabled: true,
        config: { models: [] },
      };
    }
    const agentConfig = config.plugins.entries["mode-failover"].config.agents[agentId];
    if (!agentConfig.config!.models) {
      agentConfig.config!.models = [];
    }

    // Check if model exists
    const existing = agentConfig.config!.models!.find(m => m.ref === modelRef);
    if (existing) {
      existing.weight = weight;
      console.log(`✅ Updated model in agent ${agentId}: ${modelRef} (weight: ${weight})`);
    } else {
      agentConfig.config!.models!.push(model);
      console.log(`✅ Added model to agent ${agentId}: ${modelRef} (weight: ${weight})`);
    }
  } else {
    // Add to global config
    const existing = config.plugins.entries["mode-failover"].config.models.find(m => m.ref === modelRef);
    if (existing) {
      existing.weight = weight;
      console.log(`✅ Updated model: ${modelRef} (weight: ${weight})`);
    } else {
      config.plugins.entries["mode-failover"].config.models.push(model);
      console.log(`✅ Added model: ${modelRef} (weight: ${weight})`);
    }
  }

  writeConfig(configPath, config);
  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");

  process.exit(0);
}

/**
 * Remove model from pool
 */
async function removeModel(modelRef: string, agentId?: string): Promise<void> {
  const configPath = getConfigPath();
  let config = readConfig(configPath);

  if (agentId) {
    // Remove from agent config
    const agentConfig = config.plugins.entries["mode-failover"].config.agents?.[agentId];
    if (!agentConfig || !agentConfig.config?.models) {
      console.error(`❌ Agent ${agentId} not found or has no models`);
      process.exit(1);
    }

    const index = agentConfig.config.models.findIndex(m => m.ref === modelRef);
    if (index >= 0) {
      agentConfig.config.models.splice(index, 1);
      writeConfig(configPath, config);
      console.log(`✅ Removed model from agent ${agentId}: ${modelRef}`);
    } else {
      console.log(`⚠️  Model not found in agent ${agentId}: ${modelRef}`);
    }
  } else {
    // Remove from global config
    const index = config.plugins.entries["mode-failover"].config.models.findIndex(m => m.ref === modelRef);
    if (index >= 0) {
      config.plugins.entries["mode-failover"].config.models.splice(index, 1);
      writeConfig(configPath, config);
      console.log(`✅ Removed model: ${modelRef}`);
    } else {
      console.log(`⚠️  Model not found: ${modelRef}`);
    }
  }

  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");
  process.exit(0);
}

/**
 * Set selection mode
 */
async function setMode(mode: string, agentId?: string): Promise<void> {
  const validModes = ["random", "round-robin", "weighted", "smart"];
  if (!validModes.includes(mode)) {
    console.error(`❌ Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`);
    process.exit(1);
  }

  const configPath = getConfigPath();
  let config = readConfig(configPath);

  if (agentId) {
    // Set for agent
    if (!config.plugins.entries["mode-failover"].config.agents) {
      config.plugins.entries["mode-failover"].config.agents = {};
    }
    if (!config.plugins.entries["mode-failover"].config.agents[agentId]) {
      config.plugins.entries["mode-failover"].config.agents[agentId] = {
        enabled: true,
        config: {},
      };
    }
    config.plugins.entries["mode-failover"].config.agents[agentId].config!.mode = mode as any;
    console.log(`✅ Set mode for agent ${agentId}: ${mode}`);
  } else {
    // Set global
    config.plugins.entries["mode-failover"].config.mode = mode as any;
    console.log(`✅ Set global mode: ${mode}`);
  }

  writeConfig(configPath, config);
  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");
  process.exit(0);
}

/**
 * Enable/disable agent
 */
async function setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
  const configPath = getConfigPath();
  let config = readConfig(configPath);

  if (!config.plugins.entries["mode-failover"].config.agents) {
    config.plugins.entries["mode-failover"].config.agents = {};
  }

  if (!config.plugins.entries["mode-failover"].config.agents[agentId]) {
    config.plugins.entries["mode-failover"].config.agents[agentId] = {
      enabled,
      config: {},
    };
  } else {
    config.plugins.entries["mode-failover"].config.agents[agentId].enabled = enabled;
  }

  writeConfig(configPath, config);
  console.log(`✅ ${enabled ? "Enabled" : "Disabled"} plugin for agent: ${agentId}`);
  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");
  process.exit(0);
}

/**
 * Show current configuration
 */
async function showConfig(agentId?: string): Promise<void> {
  const configPath = getConfigPath();
  const config = readConfig(configPath);

  if (agentId) {
    const agentConfig = config.plugins.entries["mode-failover"].config.agents?.[agentId];
    if (!agentConfig) {
      console.log(`⚠️  No configuration for agent: ${agentId}`);
      process.exit(0);
    }
    console.log(`\n📋 Configuration for agent: ${agentId}`);
    console.log("═".repeat(50));
    console.log(JSON.stringify(agentConfig, null, 2));
  } else {
    console.log("\n📋 Global Configuration");
    console.log("═".repeat(50));
    console.log(JSON.stringify(config.plugins.entries["mode-failover"].config, null, 2));
  }

  process.exit(0);
}

/**
 * Reset plugin state
 */
async function resetState(): Promise<void> {
  const statePath = path.join(process.env.HOME || "", ".openclaw", "mode-failover", "state.json");

  const emptyState = {
    version: 1,
    mode: "smart",
    roundRobinIndex: 0,
    sessionModels: {},
    modelHealth: {},
    enabled: true,
  };

  fs.writeFileSync(statePath, JSON.stringify(emptyState, null, 2));
  console.log("✅ Plugin state reset successfully");
  console.log("\n⚠️  Restart gateway to apply: openclaw gateway restart");
  process.exit(0);
}

/**
 * Get config file path
 */
function getConfigPath(): string {
  return path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
}

/**
 * Read config file
 */
function readConfig(configPath: string): any {
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Write config file
 */
function writeConfig(configPath: string, config: any): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}