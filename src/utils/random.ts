/**
 * Cryptographically secure random number generator
 * Falls back to Math.random if crypto is not available
 */
export function secureRandom(): number {
  // Node.js environment
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const crypto = require("crypto");
      const buffer = crypto.randomBytes(4);
      return buffer.readUInt32BE(0) / 0xffffffff;
    } catch {
      // Fallback to Math.random
    }
  }

  // Browser environment with Web Crypto API
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    globalThis.crypto.getRandomValues(array);
    return array[0] / 0xffffffff;
  }

  // Final fallback
  return Math.random();
}

/**
 * Shuffle an array using Fisher-Yates algorithm
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
