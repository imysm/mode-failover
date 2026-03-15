import type { ErrorType, ErrorTypeCategory } from "../types.js";

/**
 * Error pattern for classification
 */
interface ErrorPattern {
  type: ErrorType;
  category: ErrorTypeCategory;
  patterns: RegExp[];
  statusCode?: number | number[];
}

/**
 * Error Classifier - identifies error types from messages and status codes
 */
export class ErrorClassifier {
  private patterns: ErrorPattern[] = [
    {
      type: "rate_limit",
      category: "transient",
      patterns: [
        /rate limit/i,
        /too many requests/i,
        /quota exceeded/i,
        /request limit/i,
        /429/i,
      ],
      statusCode: 429,
    },
    {
      type: "timeout",
      category: "transient",
      patterns: [
        /timeout/i,
        /timed out/i,
        /ETIMEDOUT/i,
        /ETIMEDOUT/i,
        /ESOCKETTIMEDOUT/i,
      ],
    },
    {
      type: "network_error",
      category: "transient",
      patterns: [
        /network error/i,
        /ECONNREFUSED/i,
        /ENOTFOUND/i,
        /ECONNRESET/i,
        /EPIPE/i,
        /EHOSTUNREACH/i,
        /dns error/i,
        /connection refused/i,
        /connection reset/i,
      ],
    },
    {
      type: "auth_error",
      category: "permanent",
      patterns: [
        /invalid api key/i,
        /unauthorized/i,
        /authentication/i,
        /authorization/i,
        /401/i,
      ],
      statusCode: 401,
    },
    {
      type: "auth_error",
      category: "permanent",
      patterns: [
        /access denied/i,
        /forbidden/i,
        /permission denied/i,
        /403/i,
      ],
      statusCode: 403,
    },
    {
      type: "not_found",
      category: "permanent",
      patterns: [
        /model not found/i,
        /resource not found/i,
        /404/i,
      ],
      statusCode: 404,
    },
    {
      type: "server_error",
      category: "transient",
      patterns: [
        /internal server error/i,
        /server error/i,
        /502/i,
        /503/i,
        /504/i,
      ],
      statusCode: [500, 502, 503, 504],
    },
    {
      type: "invalid_request",
      category: "business",
      patterns: [
        /invalid parameter/i,
        /invalid request/i,
        /bad request/i,
        /400/i,
      ],
      statusCode: 400,
    },
    {
      type: "content_filter",
      category: "business",
      patterns: [
        /content policy/i,
        /content filter/i,
        /safety filter/i,
        /policy violation/i,
        /content violation/i,
      ],
    },
  ];

  /**
   * Classify error from message and optional status code
   */
  classify(error: Error | string, statusCode?: number): { type: ErrorType; category: ErrorTypeCategory } {
    const errorMessage = typeof error === "string" ? error : error.message;

    // First, check HTTP status code (more precise)
    if (statusCode !== undefined) {
      const statusCodeMatch = this.classifyByStatusCode(statusCode);
      if (statusCodeMatch.type !== "unknown") {
        return statusCodeMatch;
      }
    }

    // Then, check error message patterns
    for (const pattern of this.patterns) {
      for (const regex of pattern.patterns) {
        if (regex.test(errorMessage)) {
          return { type: pattern.type, category: pattern.category };
        }
      }
    }

    // Default to unknown
    return { type: "unknown", category: "transient" };
  }

  /**
   * Classify error by HTTP status code only
   */
  private classifyByStatusCode(statusCode: number): { type: ErrorType; category: ErrorTypeCategory } {
    // Check each pattern for status code match
    for (const pattern of this.patterns) {
      if (pattern.statusCode !== undefined) {
        const codes = Array.isArray(pattern.statusCode) ? pattern.statusCode : [pattern.statusCode];
        if (codes.includes(statusCode)) {
          return { type: pattern.type, category: pattern.category };
        }
      }
    }

    return { type: "unknown", category: "transient" };
  }

  /**
   * Check if error should be ignored (business errors)
   */
  shouldIgnore(errorType: ErrorType, ignoreErrors: string[]): boolean {
    return ignoreErrors.includes(errorType);
  }

  /**
   * Get error category
   */
  getCategory(errorType: ErrorType): ErrorTypeCategory {
    for (const pattern of this.patterns) {
      if (pattern.type === errorType) {
        return pattern.category;
      }
    }
    return "transient"; // Default
  }

  /**
   * Check if error type is transient (auto-recover)
   */
  isTransient(errorType: ErrorType): boolean {
    return this.getCategory(errorType) === "transient";
  }

  /**
   * Check if error type is permanent (requires manual recovery)
   */
  isPermanent(errorType: ErrorType): boolean {
    return this.getCategory(errorType) === "permanent";
  }

  /**
   * Check if error type is business (should not disable model)
   */
  isBusiness(errorType: ErrorType): boolean {
    return this.getCategory(errorType) === "business";
  }
}

// Export singleton instance
export const errorClassifier = new ErrorClassifier();
