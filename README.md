# mode-failover

> OpenClaw plugin for flexible model selection with random, weighted, and smart failover modes

**Version**: 1.0.0
**Plugin ID**: `mode-failover`
**License**: MIT

## Features

- ✅ **Four Selection Modes**
  - `random` - Randomly select from model pool
  - `round-robin` - Cycle through models in order
  - `weighted` - Select based on configured weights
  - `smart` - Select based on health status and performance

- ✅ **Timeout Detection** - Automatically detect and avoid slow models (30s default)
- ✅ **Session Stickiness** - Keep using the same model within a session
- ✅ **Auto Failover** - Automatically switch to healthy models on failures
- ✅ **Statistics Collection** - Track usage, success rates, and latency
- ✅ **Agent-Level Config** - Different settings for different agents

## Quick Start

### Installation

### Install via NPM

```bash
npm install mode-failover
```

### Configure in OpenClaw

Add the plugin to your OpenClaw configuration (`~/.openclaw/openclaw.json`):

```json5
{
  plugins: {
    entries: {
      "mode-failover": {
        enabled: true,
        config: {
          mode: "smart",
          models: [
            { ref: "zai/glm-5", weight: 50 },
            { ref: "zai/glm-4.7", weight: 50 }
          ]
        }
      }
    }
  }
}
```

### Restart OpenClaw Gateway

```bash
openclaw gateway restart
```

### Verify Installation

```bash
openclaw failover status
```

**⚠️ Important**:
- After modifying configuration, always restart the gateway
- When disabling the plugin, delete the state file to avoid issues:
  ```bash
  rm -rf ~/.openclaw/mode-failover
  ```

### Minimal Configuration

```json5
{
  enabled: true,
  mode: "weighted",
  models: [
    { ref: "zai/glm-5", weight: 70 },
    { ref: "zai/glm-4.7", weight: 30 }
  ]
}
```

### Recommended Configuration (High Availability)

```json5
{
  mode: "smart",
  models: [
    { ref: "zai/glm-5", weight: 50 },
    { ref: "zai/glm-4.7", weight: 50 }
  ],
  stickiness: {
    enabled: false  // ✅ Allow fast failover
  },
  failover: {
    enabled: true,
    errorThreshold: 1,  // ✅ Failover on first error
    timeoutMs: 30000,   // ✅ 30 second timeout
    cooldownMinutes: 5  // ✅ Quick recovery
  }
}
```

## Timeout Detection

The plugin includes automatic timeout detection to quickly identify and avoid slow or unresponsive models:

### Configuration

```json5
{
  failover: {
    enabled: true,
    errorThreshold: 1,
    timeoutMs: 30000  // 30 seconds (default)
  }
}
```

### How It Works

1. **Request Monitoring**: Every request is monitored for latency
2. **Timeout Detection**: If a request exceeds `timeoutMs`, it's treated as a failure
3. **Immediate Failover**: Timeout triggers immediate model failover (bypasses error threshold)
4. **Health Impact**: Timeout events immediately mark the model as unhealthy

### Example

```json5
{
  failover: {
    timeoutMs: 30000,  // 30 seconds
    errorThreshold: 1,  // Failover on first error
    cooldownMinutes: 5  // Wait 5 minutes before retrying
  }
}
```

## Smart Mode Optimizations

The `smart` mode includes aggressive failover logic for high-availability scenarios:

### Features

- **Dynamic Weight Adjustment**: Models are weighted based on health, latency, and error rates
- **Aggressive Error Penalty**: Models with errors get significantly reduced weight
- **Timeout Detection**: Slow requests immediately reduce model weight
- **Fast Failover**: No waiting for multiple errors - failover happens immediately

### Error Rate Penalties

| Error Rate | Weight Multiplier |
|------------|------------------|
| 0% errors | 1.0 (full weight) |
| 10% errors | 0.7 (30% reduction) |
| 20% errors | 0.4 (60% reduction) |
| 30%+ errors | 0.1 (90% reduction) |

### Recommended Configuration

```json5
{
  mode: "smart",
  failover: {
    enabled: true,
    errorThreshold: 1,  // Fast failover
    timeoutMs: 30000,   // 30 second timeout
    cooldownMinutes: 5  // Quick recovery
  },
  stickiness: {
    enabled: false  // Allow smart mode to work optimally
  }
}
```

## Configuration

### Agent-Level Configuration

You can configure the plugin globally and override settings for specific agents:

```json5
{
  plugins: {
    entries: {
      "mode-failover": {
        enabled: true,
        config: {
          // Global default configuration
          mode: "weighted",
          models: [
            { ref: "zai/glm-5", weight: 50 },
            { ref: "anthropic/claude", weight: 50 }
          ],
          stickiness: { enabled: true, ttlMinutes: 60 }
        },
        agents: {
          // Agent-specific overrides
          "main": {
            enabled: true,
            config: {
              mode: "smart",  // Override mode for main agent
              models: [
                { ref: "zai/glm-5", weight: 80 },
                { ref: "anthropic/claude", weight: 20 }
              ]
            }
          },
          "product": {
            enabled: false  // Disable plugin for product agent
          }
        }
      }
    }
  }
}
```

#### Configuration Merge Logic

1. **No agentId** → Use global config
2. **agentId not in agents config** → Use global config
3. **agentId with `enabled: false`** → Plugin disabled for this agent
4. **agentId with `enabled: true`** → Deep merge agent config with global config

**Example**: Agent config overrides specific fields while inheriting others:
```json5
// Global config
{
  mode: "weighted",
  models: [...],
  stickiness: { enabled: true, ttlMinutes: 60 },
  failover: { enabled: true }
}

// Agent config (only overrides mode)
{
  mode: "smart"
}

// Result for this agent
{
  mode: "smart",  // From agent config
  models: [...],  // From global config
  stickiness: { enabled: true, ttlMinutes: 60 },  // From global config
  failover: { enabled: true }  // From global config
}
```

### Basic Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Enable/disable the plugin |
| `mode` | string | "weighted" | Selection mode (random, round-robin, weighted, smart) |
| `models` | array | required | List of models in the pool |

### Model Configuration

```json5
{
  models: [
    {
      ref: "zai/glm-5",    // Model reference: provider/model
      weight: 70,              // Selection weight (0-100)
      enabled: true            // Whether model is available
    }
  ]
}
```

### Session Stickiness

```json5
{
  stickiness: {
    enabled: true,           // Keep same model per session
    ttlMinutes: 60,          // Stickiness expiration
    maxSessionModels: 1      // Max models per session
  }
}
```

### Failover Settings

```json5
{
  failover: {
    enabled: true,           // Enable auto-failover
    errorThreshold: 3,       // Errors before marking unhealthy
    errorWindowMinutes: 5,   // Error counting window
    cooldownMinutes: 30,     // Cooldown for unhealthy models
    recoveryProbeInterval: 5 // Recovery check interval
  }
}
```

### Statistics Settings

```json5
{
  stats: {
    enabled: true,           // Enable stats collection
    persistInterval: 60000,  // Persist interval (ms)
    maxHistoryHours: 24      // History retention
  }
}
```

## CLI Commands

```bash
# View status
openclaw failover status

# View statistics
openclaw failover stats
openclaw failover stats --json

# Change mode
openclaw failover mode random
openclaw failover mode weighted
openclaw failover mode smart

# Manage models
openclaw failover add zai/glm-5 --weight 70
openclaw failover remove zai/glm-5

# Reset statistics
openclaw failover reset-stats

# Enable/disable
openclaw failover enable
openclaw failover disable
```

## Selection Modes

### Random Mode

Randomly selects a model from the pool. Useful for:
- Distributing API quota usage
- A/B testing models
- Load balancing

### Round-Robin Mode

Cycles through models in order. Useful for:
- Even distribution across models
- Predictable model rotation

### Weighted Mode

Selects models based on configured weights. Useful for:
- Cost optimization (use cheaper models more)
- Quality/cost tradeoffs
- Gradual rollout of new models

Example: 70% GPT-4, 30% Claude
```json5
models: [
  { ref: "zai/glm-5", weight: 70 },
  { ref: "anthropic/claude", weight: 30 }
]
```

### Smart Mode

Selects models based on health and performance. Features:
- Monitors response time and success rate
- Automatically reduces weight of degraded models
- Avoids unhealthy models during cooldown
- Prefers faster models

## Health Status

Models can have three health states:

| Status | Description |
|--------|-------------|
| `healthy` | Normal operation |
| `degraded` | High error rate (>20%), reduced weight |
| `unhealthy` | Too many errors, in cooldown |

## Example Configurations

### Cost Optimization

Use GPT-4 for 30% of requests, Claude for 70%:

```json5
{
  mode: "weighted",
  models: [
    { ref: "zai/glm-5", weight: 30 },
    { ref: "anthropic/claude", weight: 70 }
  ]
}
```

### High Availability

Primary model with fallbacks:

```json5
{
  mode: "smart",
  models: [
    { ref: "zai/glm-5", weight: 100 },
    { ref: "anthropic/claude", weight: 100 },
    { ref: "google/gemini-pro", weight: 100 }
  ],
  failover: {
    enabled: true,
    errorThreshold: 2,
    cooldownMinutes: 15
  }
}
```

### Load Balancing

Distribute evenly across providers:

```json5
{
  mode: "round-robin",
  models: [
    { ref: "zai/glm-5", weight: 100 },
    { ref: "anthropic/claude", weight: 100 },
    { ref: "google/gemini-pro", weight: 100 }
  ]
}
```

## State Persistence

The plugin persists state to `~/.openclaw/mode-failover/state.json`:
- Current selection mode
- Round-robin index
- Session bindings
- Model health status

State is restored on gateway restart.

## Troubleshooting

### Plugin Not Working

**Symptom**: Plugin enabled but not selecting models

**Solutions**:
1. Check if plugin is enabled:
   ```bash
   openclaw failover status
   ```

2. Verify configuration syntax:
   ```bash
   cat ~/.openclaw/openclaw.json | jq '.plugins.entries."mode-failover"'
   ```

3. Check gateway logs:
   ```bash
   journalctl --user -u openclaw-gateway --since "5 minutes ago" | grep failover
   ```

### Models Not Switching

**Symptom**: All requests use the same model

**Causes**:
1. **Session stickiness enabled** - Disable for fast failover:
   ```json5
   stickiness: { enabled: false }
   ```

2. **Error threshold too high** - Lower to 1:
   ```json5
   failover: { errorThreshold: 1 }
   ```

3. **Cooldown period too long** - Reduce to 5 minutes:
   ```json5
   failover: { cooldownMinutes: 5 }
   ```

### Timeout Detection Not Working

**Symptom**: Slow requests don't trigger failover

**Solution**: Enable and configure timeout detection:
```json5
failover: {
  enabled: true,
  timeoutMs: 30000  // 30 seconds
}
```

### Agent-Level Config Not Applied

**Symptom**: Agent config ignored

**Solutions**:
1. **Check agent ID**: Must match exactly (case-sensitive)
2. **Check structure**: `agents` must be inside `config`, not at `entries` level
3. **Check enabled**: Agent config must have `enabled: true`

**Correct structure**:
```json5
{
  plugins: {
    entries: {
      "mode-failover": {
        enabled: true,
        config: {
          // Global config here
          agents: {  // ← Inside config
            "main": {
              enabled: true,
              config: {
                mode: "smart"  // Agent override
              }
            }
          }
        }
      }
    }
  }
}
```

### Warning: "plugin id mismatch"

**Symptom**: Warning in logs about plugin ID mismatch

**Solution**: This is fixed in version 1.0.0. If you see this warning:
1. Update to latest version
2. Clear state: `rm -rf ~/.openclaw/mode-failover`
3. Restart gateway: `openclaw gateway restart`

## Performance Tuning

### For High Traffic

**Goal**: Minimize overhead, maximize throughput

**Recommended config**:
```json5
{
  mode: "weighted",  // Faster than smart mode
  stickiness: { enabled: true, ttlMinutes: 60 },  // Reduce switching
  stats: { enabled: false }  // Disable stats collection
}
```

### For High Availability

**Goal**: Fast failover, minimal downtime

**Recommended config**:
```json5
{
  mode: "smart",
  stickiness: { enabled: false },  // Allow fast switching
  failover: {
    enabled: true,
    errorThreshold: 1,  // Failover immediately
    timeoutMs: 20000,   // 20 second timeout (faster detection)
    cooldownMinutes: 3  // Quick recovery
  }
}
```

### For Cost Optimization

**Goal**: Use cheaper models more often

**Recommended config**:
```json5
{
  mode: "weighted",
  models: [
    { ref: "cheap-model", weight: 80 },  // Use 80% of time
    { ref: "expensive-model", weight: 20 }  // Use 20% of time
  ],
  stickiness: { enabled: true },  // Avoid switching mid-session
  failover: { enabled: false }  // Don't auto-switch
}
```

### For Testing

**Goal**: Even distribution, easy to observe

**Recommended config**:
```json5
{
  mode: "round-robin",  // Predictable rotation
  models: [
    { ref: "model-a", weight: 100 },
    { ref: "model-b", weight: 100 }
  ],
  stickiness: { enabled: false },
  stats: { enabled: true }  // Track everything
}
```

## Configuration Reference

### Complete Configuration Schema

```json5
{
  enabled: true,  // boolean, default: true
  mode: "weighted",  // "random" | "round-robin" | "weighted" | "smart"
  models: [  // array, required
    {
      ref: "provider/model",  // string, required
      weight: 50,  // number (0-100), default: 50
      enabled: true  // boolean, default: true
    }
  ],
  stickiness: {
    enabled: false,  // boolean, default: false
    ttlMinutes: 10,  // number (0-1440), default: 10
    maxSessionModels: 1  // number (1-10), default: 1
  },
  failover: {
    enabled: true,  // boolean, default: true
    errorThreshold: 1,  // number (1-100), default: 1
    errorWindowMinutes: 5,  // number (1-60), default: 5
    cooldownMinutes: 30,  // number (1-1440), default: 30
    recoveryProbeInterval: 5,  // number (1-60), default: 5
    timeoutMs: 30000  // number (5000-300000), default: 30000
  },
  stats: {
    enabled: true,  // boolean, default: true
    persistInterval: 60000,  // number (10000-300000), default: 60000
    maxHistoryHours: 24  // number (1-168), default: 24
  },
  agents: {  // optional
    "agent-id": {
      enabled: true,  // boolean
      config: {  // Same structure as global config (partial)
        mode: "smart",
        models: [...],
        // ... other options
      }
    }
  }
}
```

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Plugin enabled |
| `mode` | `"weighted"` | Selection mode |
| `stickiness.enabled` | `false` | Session stickiness off |
| `stickiness.ttlMinutes` | `10` | 10 minute TTL |
| `failover.enabled` | `true` | Auto failover on |
| `failover.errorThreshold` | `1` | Failover on 1st error |
| `failover.timeoutMs` | `30000` | 30 second timeout |
| `stats.enabled` | `true` | Stats collection on |

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT
