import type { ModelRef, SessionBinding, StickinessConfig } from "../types.js";

/**
 * Session Manager - handles session-to-model binding (stickiness)
 */
export class SessionManager {
  private bindings: Map<string, SessionBinding>;
  private config: StickinessConfig;

  constructor(config: StickinessConfig) {
    this.bindings = new Map();
    this.config = config;
  }

  getModel(sessionKey: string): ModelRef | null {
    if (!this.config.enabled) {
      return null;
    }

    const binding = this.bindings.get(sessionKey);
    if (!binding) {
      return null;
    }

    // Check if expired
    if (Date.now() > binding.expiresAt) {
      this.bindings.delete(sessionKey);
      return null;
    }

    return { ref: binding.modelRef, weight: 0, enabled: true };
  }

  setModel(sessionKey: string, model: ModelRef): void {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();
    this.bindings.set(sessionKey, {
      modelRef: model.ref,
      selectedAt: now,
      expiresAt: now + this.config.ttlMinutes * 60 * 1000,
    });
  }

  clear(sessionKey: string): void {
    this.bindings.delete(sessionKey);
  }

  clearAll(): void {
    this.bindings.clear();
  }

  hasSession(sessionKey: string): boolean {
    return this.getModel(sessionKey) !== null;
  }

  getActiveSessionCount(): number {
    this.cleanup();
    return this.bindings.size;
  }

  // Clean up expired bindings
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, binding] of this.bindings.entries()) {
      if (now > binding.expiresAt) {
        this.bindings.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  // For state persistence
  getState(): Record<string, SessionBinding> {
    const result: Record<string, SessionBinding> = {};
    for (const [key, binding] of this.bindings.entries()) {
      result[key] = binding;
    }
    return result;
  }

  setState(state: Record<string, SessionBinding>): void {
    this.bindings.clear();
    for (const [key, binding] of Object.entries(state)) {
      // Only restore non-expired bindings
      if (binding.expiresAt > Date.now()) {
        this.bindings.set(key, binding);
      }
    }
  }

  // Update config
  updateConfig(config: StickinessConfig): void {
    this.config = config;
  }
}
