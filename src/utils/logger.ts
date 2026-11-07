export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

/**
 * Replace line breaks so a value from a request cannot start a new, forged
 * log line. Plain objects are left to console's inspect, which escapes line
 * breaks inside strings; an Error's stack is printed as it is.
 */
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/g, ' ');
}

export class Logger {
  private config: LoggerConfig;
  private static instance: Logger;
  private useFileLogging = false;
  private fileStream: any = null;
  // Cache environment variables for performance
  private readonly isStdio = process.env.MCP_MODE === 'stdio';
  private readonly isDisabled = process.env.DISABLE_CONSOLE_OUTPUT === 'true';
  private readonly isHttp = process.env.MCP_MODE === 'http';
  private readonly isTest = process.env.NODE_ENV === 'test' || process.env.TEST_ENVIRONMENT === 'true';

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: LogLevel.INFO,
      prefix: 'n8n-mcp',
      timestamp: true,
      ...config,
    };
  }

  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  private formatMessage(level: string, message: string): string {
    const parts: string[] = [];
    
    if (this.config.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }
    
    parts.push(`[${level}]`);
    parts.push(stripLineBreaks(String(message)));
    
    return parts.join(' ');
  }

  private log(level: LogLevel, levelName: string, message: string, ...args: any[]): void {
    // Allow ERROR level logs through in more cases for debugging
    const allowErrorLogs = level === LogLevel.ERROR && (this.isHttp || process.env.DEBUG === 'true');
    
    // Check environment variables FIRST, before level check
    // In stdio mode, suppress ALL console output to avoid corrupting JSON-RPC (except errors when debugging)
    // Also suppress in test mode unless debug is explicitly enabled
    if (this.isStdio || this.isDisabled || (this.isTest && process.env.DEBUG !== 'true')) {
      // Allow error logs through if debugging is enabled
      if (!allowErrorLogs) {
        return;
      }
    }
    
    if (level <= this.config.level || allowErrorLogs) {
      // Passed after a fixed '%s' so text in the message is never read as a
      // format directive.
      const formattedMessage = this.formatMessage(levelName, message);
      const safeArgs = args.map((arg) => (typeof arg === 'string' ? stripLineBreaks(arg) : arg));
      
      // In HTTP mode during request handling, suppress console output (except errors)
      // The ConsoleManager will handle this, but we add a safety check
      if (this.isHttp && process.env.MCP_REQUEST_ACTIVE === 'true' && !allowErrorLogs) {
        // Silently drop the log during active MCP requests (except errors)
        return;
      }
      
      switch (level) {
        case LogLevel.ERROR:
          console.error('%s', formattedMessage, ...safeArgs);
          break;
        case LogLevel.WARN:
          console.warn('%s', formattedMessage, ...safeArgs);
          break;
        default:
          console.log('%s', formattedMessage, ...safeArgs);
      }
    }
  }

  error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, 'ERROR', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, 'WARN', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, 'INFO', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  static parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error':
        return LogLevel.ERROR;
      case 'warn':
        return LogLevel.WARN;
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
      default:
        return LogLevel.INFO;
    }
  }
}

// Create a default logger instance
export const logger = Logger.getInstance({
  level: Logger.parseLogLevel(process.env.LOG_LEVEL || 'info'),
});