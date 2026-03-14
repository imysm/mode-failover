# Changelog

All notable changes to the mode-failover plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-03-14

### Fixed

- **Null Reference Error** - Fixed crash when no healthy model available
  - Added null check before accessing `selectedModel.ref`
  - Returns null gracefully when all models are unhealthy
  - Logs warning instead of crashing

### Changed

- **Default Model Enabled** - `enabled` defaults to `true` instead of `false`
  - New models are enabled by default when added to config
  - More intuitive behavior for users

### Added

- **clear-state CLI Command** - Clear all persistent state
  - `openclaw failover clear-state` - Deletes state file and resets health status
  - Useful for testing or recovering from bad state

- **Persistent enable/disable** - Enable/disable now persists to config file
  - `openclaw failover enable` - Updates runtime + config file
  - `openclaw failover disable` - Updates runtime + config file
  - Changes survive gateway restart

## [1.0.0] - 2026-03-13

### Added

- **Timeout Detection** - Automatically detect and avoid slow models
  - New configuration option: `failover.timeoutMs` (default: 30000ms)
  - Requests exceeding timeout are treated as failures
  - Immediate failover on timeout (bypasses error threshold)
  - Timeout events immediately mark model as unhealthy

- **Smart Mode Optimizations** - Aggressive failover logic for high availability
  - Dynamic weight adjustment based on health, latency, and error rates
  - Error rate penalties: 10% errors = 30% weight reduction, 20% = 60%, 30%+ = 90%
  - Timeout immediately reduces model weight to 10%
  - Fast failover without waiting for multiple errors

- **Agent-Level Configuration** - Different settings for different agents
  - Per-agent configuration overrides
  - Deep merge logic for agent config
  - Enable/disable plugin per agent

- **Session Stickiness** - Keep using same model within a session
  - Configurable TTL and max session models
  - Default: disabled (to allow fast failover)

- **Auto Failover** - Automatically switch to healthy models
  - Configurable error threshold and cooldown
  - Error window for counting consecutive errors
  - Recovery probe for automatic recovery

- **Statistics Collection** - Track model usage and performance
  - Request counts, success rates, latency
  - Configurable persistence and history retention

- **CLI Commands** - Manage plugin from command line
  - `openclaw failover status` - View plugin status
  - `openclaw failover stats` - View statistics
  - `openclaw failover mode` - Change selection mode
  - `openclaw failover add/remove` - Manage models
  - `openclaw failover enable/disable` - Enable/disable plugin
  - `openclaw failover reset-stats` - Reset statistics

- **Four Selection Modes**
  - `random` - Random selection from model pool
  - `round-robin` - Cycle through models in order
  - `weighted` - Select based on configured weights
  - `smart` - Select based on health and performance

### Changed

- **Default Configuration** - Optimized for high availability
  - `stickiness.enabled`: `true` → `false` (avoid caching failed models)
  - `stickiness.ttlMinutes`: `60` → `10` (shorter TTL)
  - `failover.errorThreshold`: `3` → `1` (faster failover)
  - Default models: `openai/gpt-4` → `zai/glm-5`, `anthropic/claude` → `zai/glm-4.7`

- **Package Naming** - Simplified to single ID
  - Plugin ID: `mode-failover` (used everywhere)
  - NPM package: `mode-failover`
  - No more mismatch warnings

- **Removed Config Commands** - Avoid CLI conflicts
  - Removed `openclaw failover config` command
  - Use `openclaw config` or edit `~/.openclaw/openclaw.json` directly
  - Simpler and more consistent

### Fixed

- **Plugin ID Mismatch** - Warning about mismatch between manifest and package name
  - Unified plugin ID and package name to `mode-failover`
  - No more warnings in gateway logs

- **Config Command Conflict** - `openclaw failover config` conflicted with `openclaw config`
  - Removed config commands entirely
  - Users now use standard config methods

- **Default Models** - Example models were not practical
  - Changed from `openai/gpt-4` and `anthropic/claude` to `zai/glm-5` and `zai/glm-4.7`
  - More relevant to typical use cases

### Documentation

- **Comprehensive README** - Complete documentation
  - Quick start guide
  - Configuration reference
  - Selection modes explained
  - Troubleshooting guide
  - Performance tuning recommendations
  - Example configurations

- **Timeout Detection Docs** - Detailed explanation
  - How timeout detection works
  - Configuration options
  - Example usage

- **Smart Mode Docs** - Optimization details
  - Error rate penalty table
  - Dynamic weight calculation
  - Recommended configuration

### Performance

- **Minimal Overhead** - Optimized for production use
  - Simple mathematical operations for weight calculation
  - No blocking operations
  - Efficient state persistence

- **Fast Failover** - Quick response to failures
  - Immediate failover on timeout or error
  - No waiting for multiple errors
  - Quick recovery with short cooldown

## [0.1.0] - 2026-03-09

### Added

- Initial release
- Basic model selection with four modes
- Session stickiness
- Auto failover
- Statistics collection
- CLI commands

[1.0.0]: https://github.com/imysm/mode-failover/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/imysm/mode-failover/releases/tag/v0.1.0
