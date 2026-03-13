import type { Command } from "commander";
import type { ModeFailoverRuntime } from "./runtime.js";

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
    .description("Reset usage statistics")
    .action(() => {
      runtime.resetStats();
      console.log("✅ Statistics reset");
      process.exit(0);
    });

  // enable
  failover.command("enable")
    .description("Enable failover plugin")
    .action(() => {
      runtime.setEnabled(true);
      console.log("✅ Failover enabled");
      console.log("⚠️  Note: Changes are runtime only. Update config file to persist.");
      process.exit(0);
    });

  // disable
  failover.command("disable")
    .description("Disable failover plugin")
    .action(() => {
      runtime.setEnabled(false);
      console.log("✅ Failover disabled");
      console.log("⚠️  Note: Changes are runtime only. Update config file to persist.");
      process.exit(0);
    });
}
