import * as fs from "fs";
import * as path from "path";
import type { Command } from "commander";
import type { ModeFailoverRuntime } from "./runtime.js";

/**
 * Get the OpenClaw config file path
 */
function getConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG_PATH;
  if (envPath) {
    return envPath;
  }
  return path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
}

/**
 * Update the enabled flag in the config file
 */
function updateConfigEnabled(enabled: boolean): boolean {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      console.error(`❌ Config file not found: ${configPath}`);
      return false;
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Update the enabled flag
    if (!config.plugins) {
      config.plugins = {};
    }
    if (!config.plugins.entries) {
      config.plugins.entries = {};
    }
    if (!config.plugins.entries["mode-failover"]) {
      config.plugins.entries["mode-failover"] = {};
    }

    config.plugins.entries["mode-failover"].enabled = enabled;

    // Write back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error(`❌ Failed to update config: ${error}`);
    return false;
  }
}

/**
 * Register CLI commands for the failover plugin
 */
export function registerFailoverCliCommands(
  program: Command,
  runtime: ModeFailoverRuntime
): void {
  const failover = program.command("failover")
    .description("Manage model failover and selection modes");

  // status
  failover.command("status")
    .description("Show current failover configuration and status")
    .action(() => {
      const status = runtime.getStatus();
      console.log("\n📊 Mode Failover Status");
      console.log("═".repeat(50));
      console.log(`Status: ${status.enabled ? "✅ Enabled" : "❌ Disabled"}`);
      console.log(`Mode: ${status.mode}`);
      console.log(`Active Sessions: ${status.activeSessions}`);
      console.log(`\n📦 Model Pool (${status.modelCount} models):`);
      console.log("─".repeat(50));

      for (const model of status.models) {
        const statusIcon = model.status === "healthy" ? "✅" :
                          model.status === "degraded" ? "⚠️" : "❌";
        const enabledIcon = model.enabled ? "" : " (disabled)";
        console.log(`  ${statusIcon} ${model.ref.padEnd(35)} weight: ${model.weight}${enabledIcon}`);
      }
      console.log();
      process.exit(0);
    });

  // stats
  failover.command("stats")
    .description("Show model usage statistics")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const stats = runtime.getStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
        return;
      }

      console.log("\n📈 Model Usage Statistics");
      console.log("═".repeat(80));
      console.log(
        "Model".padEnd(40),
        "Requests".padEnd(10),
        "Success%".padEnd(10),
        "Avg Latency"
      );
      console.log("─".repeat(80));

      for (const [model, stat] of Object.entries(stats)) {
        const successRate = stat.totalRequests > 0
          ? ((stat.successCount / stat.totalRequests) * 100).toFixed(1)
          : "N/A";
        const latency = stat.avgLatencyMs > 0
          ? `${stat.avgLatencyMs.toFixed(0)}ms`
          : "N/A";

        const statusIcon = stat.status === "healthy" ? "✅" :
                          stat.status === "degraded" ? "⚠️" : "❌";

        console.log(
          `${statusIcon} ${model}`.padEnd(40),
          String(stat.totalRequests).padEnd(10),
          `${successRate}%`.padEnd(10),
          latency
        );
      }
      console.log("─".repeat(80));
      console.log();
      process.exit(0);
    });

  // mode
  failover.command("mode <mode>")
    .description("Set selection mode (random|round-robin|weighted|smart)")
    .action((mode: string) => {
      const validModes = ["random", "round-robin", "weighted", "smart"];
      if (!validModes.includes(mode)) {
        console.error(`❌ Invalid mode: ${mode}. Valid modes: ${validModes.join(", ")}`);
        process.exit(1);
      }
      runtime.setMode(mode as "random" | "round-robin" | "weighted" | "smart");
      console.log(`✅ Mode set to: ${mode}`);
      console.log("⚠️  Note: Changes are runtime only. Update config file to persist.");
      process.exit(0);
    });

  // add
  failover.command("add <model-ref>")
    .description("Add a model to the selection pool")
    .option("-w, --weight <weight>", "Model weight (0-100)", "50")
    .action((modelRef: string, options: { weight: string }) => {
      const weight = parseInt(options.weight, 10);
      if (isNaN(weight) || weight < 0 || weight > 100) {
        console.error("❌ Weight must be a number between 0 and 100");
        process.exit(1);
      }

      runtime.addModel({ ref: modelRef, weight, enabled: true });
      console.log(`✅ Added model: ${modelRef} (weight: ${weight})`);
      console.log("⚠️  Note: Changes are runtime only. Update config file to persist.");
      process.exit(0);
    });

  // remove
  failover.command("remove <model-ref>")
    .description("Remove a model from the selection pool")
    .action((modelRef: string) => {
      const removed = runtime.removeModel(modelRef);
      if (removed) {
        console.log(`✅ Removed model: ${modelRef}`);
        console.log("⚠️  Note: Changes are runtime only. Update config file to persist.");
      } else {
        console.log(`⚠️  Model not found: ${modelRef}`);
      }
      process.exit(0);
    });

  // reset-stats
  failover.command("reset-stats")
    .description("Reset usage statistics and health status")
    .action(() => {
      runtime.resetStats();
      console.log("✅ Statistics and health status reset");
      console.log("ℹ️  All models are now considered healthy");
      process.exit(0);
    });

  // recover (v1.0.5)
  failover.command("recover <model-ref>")
    .description("Manually recover a disabled model (v1.0.5)")
    .action((modelRef: string) => {
      const recovered = runtime.recoverModel(modelRef);
      if (recovered) {
        console.log(`✅ Model recovered: ${modelRef}`);
        console.log("ℹ️  Model is now available for selection");
      } else {
        console.log(`⚠️  Model not found in health monitor: ${modelRef}`);
      }
      process.exit(0);
    });

  // clear-state
  failover.command("clear-state")
    .description("Clear persistent state (health status, sessions, etc.)")
    .action(() => {
      runtime.clearPersistedState();
      console.log("✅ Persistent state cleared");
      console.log("ℹ️  All models will start fresh on next restart");
      process.exit(0);
    });

  // enable
  failover.command("enable")
    .description("Enable failover plugin")
    .action(() => {
      runtime.setEnabled(true);
      const updated = updateConfigEnabled(true);
      if (updated) {
        console.log("✅ Failover enabled");
        console.log("✅ Config file updated");
      } else {
        console.log("✅ Failover enabled (runtime only)");
        console.log("⚠️  Failed to update config file");
      }
      process.exit(0);
    });

  // disable
  failover.command("disable")
    .description("Disable failover plugin")
    .action(() => {
      runtime.setEnabled(false);
      const updated = updateConfigEnabled(false);
      if (updated) {
        console.log("✅ Failover disabled");
        console.log("✅ Config file updated");
      } else {
        console.log("✅ Failover disabled (runtime only)");
        console.log("⚠️  Failed to update config file");
      }
      process.exit(0);
    });
}
