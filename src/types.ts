import { z } from "zod";

// -----------------------------------------------------------------------------
// Model Reference
// -----------------------------------------------------------------------------

export const ModelRefSchema = z.object({
  ref: z.string(),
  weight: z.number().min(0).max(100).default(50),
  enabled: z.boolean().default(true),  // 默认启用，而不是禁用
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export function parseModelRef(ref: string): { provider: string; model: string } {
  const parts = ref.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid model ref format: ${ref}. Expected "provider/model"`);
  }
  return { provider: parts[0], model: parts[1] };
}

export function modelRefKey(ref: ModelRef | string): string {
  return typeof ref === "string" ? ref : ref.ref;
}

// -----------------------------------------------------------------------------
// Error Types (v1.0.5)
// -----------------------------------------------------------------------------

/**
 * Error type classification
 */
export const ErrorTypeSchema = z.enum([
  "rate_limit",      // Rate limit exceeded (429)
  "timeout",         // Request timeout
  "network_error",   // Network connectivity issues
  "auth_error",      // Authentication/authorization failure (401, 403)
  "not_found",       // Resource not found (404)
  "server_error",    // Internal server error (5xx)
  "invalid_request",  // Invalid request parameters (400)
  "content_filter",  // Content policy violation
  "unknown",         // Unknown error type
]);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

/**
 * Error category - determines handling strategy
 */
export const ErrorTypeCategorySchema = z.enum([
  "transient",   // Temporary errors, auto-recover (rate_limit, timeout, network_error, server_error)
  "permanent",   // Permanent errors, require manual recovery (auth_error, not_found)
  "business",    // Business logic errors, should not disable model (invalid_request, content_filter)
]);
export type ErrorTypeCategory = z.infer<typeof ErrorTypeCategorySchema>;

/**
 * Error history entry
 */
export const ErrorHistoryEntrySchema = z.object({
  timestamp: z.number(),
  error: z.string(),
  errorType: ErrorTypeSchema.default("unknown"),
});
export type ErrorHistoryEntry = z.infer<typeof ErrorHistoryEntrySchema>;

/**
 * Error handling configuration for specific error type
 */
export const ErrorHandlingRuleSchema = z.object({
  disableDuration: z.number().min(0).default(60),  // Duration in seconds (0 = permanent)
  maxRetries: z.number().min(0).max(10).default(3),
  requireManualRecovery: z.boolean().default(false),
});
export type ErrorHandlingRule = z.infer<typeof ErrorHandlingRuleSchema>;

/**
 * Error handling configuration (v1.0.5)
 */
export const ErrorHandlingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  transientErrors: z.record(z.string(), ErrorHandlingRuleSchema),
  permanentErrors: z.record(z.string(), ErrorHandlingRuleSchema),
  ignoreErrors: z.array(z.string()).default([
    "invalid_request",
    "content_filter",
  ]),
});
export type ErrorHandlingConfig = z.infer<typeof ErrorHandlingConfigSchema>;

/**
 * Fallback configuration (v1.0.7)
 */
export const FallbackConfigSchema = z.object({
  enabled: z.boolean().default(true),
  forceRecoveryInterval: z.number().min(1).max(3600).default(60),  // seconds
  alwaysKeepOne: z.boolean().default(true),
});
export type FallbackConfig = z.infer<typeof FallbackConfigSchema>;

// -----------------------------------------------------------------------------
// Selection Context
// -----------------------------------------------------------------------------

export const SelectionContextSchema = z.object({
  sessionKey: z.string(),
  agentId: z.string().optional(),
  previousModel: z.string().optional(),
  excludeModels: z.array(z.string()).optional(),
});
export type SelectionContext = z.infer<typeof SelectionContextSchema>;

// -----------------------------------------------------------------------------
// Model Health Stats
// -----------------------------------------------------------------------------

export const ModelHealthStatusSchema = z.enum(["healthy", "degraded", "unhealthy"]);
export type ModelHealthStatus = z.infer<typeof ModelHealthStatusSchema>;

export const ModelHealthStatsSchema = z.object({
  totalRequests: z.number().default(0),
  successCount: z.number().default(0),
  failureCount: z.number().default(0),
  avgLatencyMs: z.number().default(0),
  lastError: z.string().optional(),
  lastErrorAt: z.number().optional(),
  lastSuccessAt: z.number().optional(),
  status: ModelHealthStatusSchema.default("healthy"),
  // New in v1.0.5
  lastErrorType: ErrorTypeSchema.optional(),
  disabledAt: z.number().optional(),
  disabledUntil: z.number().optional(),
  disableReason: ErrorTypeSchema.optional(),
});
export type ModelHealthStats = z.infer<typeof ModelHealthStatsSchema>;

// -----------------------------------------------------------------------------
// Session Binding
// -----------------------------------------------------------------------------

export const SessionBindingSchema = z.object({
  modelRef: z.string(),
  selectedAt: z.number(),
  expiresAt: z.number(),
});
export type SessionBinding = z.infer<typeof SessionBindingSchema>;

// -----------------------------------------------------------------------------
// Hourly Stats
// -----------------------------------------------------------------------------

export const HourlyStatsSchema = z.object({
  hour: z.number(),
  requests: z.number().default(0),
  successes: z.number().default(0),
  failures: z.number().default(0),
  totalLatencyMs: z.number().default(0),
});
export type HourlyStats = z.infer<typeof HourlyStatsSchema>;

// -----------------------------------------------------------------------------
// Model Usage Stats
// -----------------------------------------------------------------------------

export const ModelUsageStatsSchema = ModelHealthStatsSchema.extend({
  hourlyStats: z.record(z.string(), HourlyStatsSchema).default({}),
});
export type ModelUsageStats = z.infer<typeof ModelUsageStatsSchema>;

// -----------------------------------------------------------------------------
// Plugin State
// -----------------------------------------------------------------------------

export const PluginStateSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["random", "round-robin", "weighted", "smart"]),
  roundRobinIndex: z.number().default(0),
  sessionModels: z.record(z.string(), SessionBindingSchema).default({}),
  modelHealth: z.record(z.string(), z.object({
    status: ModelHealthStatusSchema,
    cooldownUntil: z.number().nullable(),
  })).default({}),
  enabled: z.boolean().default(false),
});
export type PluginState = z.infer<typeof PluginStateSchema>;

// -----------------------------------------------------------------------------
// Selector Mode
// -----------------------------------------------------------------------------

export type SelectorMode = "random" | "round-robin" | "weighted" | "smart";

// -----------------------------------------------------------------------------
// Model Selector Interface
// -----------------------------------------------------------------------------

export interface ModelSelector {
  select(context: SelectionContext, models?: ModelRef[]): Promise<ModelRef | null>;
  reset(): void;
  updateStats?(model: ModelRef, success: boolean, latencyMs: number): void;
}

// -----------------------------------------------------------------------------
// Config Types
// -----------------------------------------------------------------------------

export const StickinessConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ttlMinutes: z.number().min(0).max(1440).default(10),
  maxSessionModels: z.number().min(1).max(10).default(1),
});
export type StickinessConfig = z.infer<typeof StickinessConfigSchema>;

export const FailoverConfigSchema = z.object({
  enabled: z.boolean().default(false),
  errorThreshold: z.number().min(1).max(100).default(1),
  errorWindowMinutes: z.number().min(1).max(60).default(5),
  cooldownMinutes: z.number().min(1).max(1440).default(30),
  recoveryProbeInterval: z.number().min(1).max(60).default(5),
  timeoutMs: z.number().min(5000).max(300000).default(30000), // 30 seconds timeout
  // New in v1.0.5
  errorHandling: ErrorHandlingConfigSchema.optional(),
  // New in v1.0.7
  fallback: FallbackConfigSchema.optional(),
});
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;

export const StatsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  persistInterval: z.number().min(10000).max(300000).default(60000),
  maxHistoryHours: z.number().min(1).max(168).default(24),
});
export type StatsConfig = z.infer<typeof StatsConfigSchema>;

export const ModeFailoverConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["random", "round-robin", "weighted", "smart"]).default("weighted"),
  models: z.array(ModelRefSchema).min(1),
  stickiness: StickinessConfigSchema,
  failover: FailoverConfigSchema,
  stats: StatsConfigSchema,
  agents: z.record(z.string(), z.object({
    enabled: z.boolean().default(false),
    config: z.object({
      mode: z.enum(["random", "round-robin", "weighted", "smart"]).optional(),
      models: z.array(ModelRefSchema).min(1).optional(),
      stickiness: StickinessConfigSchema.optional(),
      failover: FailoverConfigSchema.optional(),
      stats: StatsConfigSchema.optional(),
    }).optional(),
  })).optional(),
});
export type ModeFailoverConfig = z.infer<typeof ModeFailoverConfigSchema>;

// -----------------------------------------------------------------------------
// Plugin Status (for CLI)
// -----------------------------------------------------------------------------

export const PluginStatusSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["random", "round-robin", "weighted", "smart"]),
  modelCount: z.number(),
  models: z.array(z.object({
    ref: z.string(),
    weight: z.number(),
    enabled: z.boolean(),
    status: ModelHealthStatusSchema,
  })),
  activeSessions: z.number(),
});
export type PluginStatus = z.infer<typeof PluginStatusSchema>;
