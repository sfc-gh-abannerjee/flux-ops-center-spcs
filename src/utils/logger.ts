/**
 * Production-safe logger utility
 * 
 * In development (import.meta.env.DEV): All logs are output
 * In production: Only errors are logged, all other logs are no-ops
 * 
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.log('Loading data...');  // Only in dev
 *   logger.error('Failed!', error); // Always logged
 */

const isDev = import.meta.env.DEV;

// No-op function for production
const noop = (..._args: unknown[]) => {};

export const logger = {
  /** Debug/info logs - only in development */
  log: isDev ? console.log.bind(console) : noop,
  
  /** Warning logs - only in development */
  warn: isDev ? console.warn.bind(console) : noop,
  
  /** Error logs - always logged (important for debugging production issues) */
  error: console.error.bind(console),
  
  /** Debug logs - only in development */
  debug: isDev ? console.debug.bind(console) : noop,
  
  /** Info logs - only in development */
  info: isDev ? console.info.bind(console) : noop,
  
  /** Group logs - only in development */
  group: isDev ? console.group.bind(console) : noop,
  groupEnd: isDev ? console.groupEnd.bind(console) : noop,
  
  /** Table logs - only in development */
  table: isDev ? console.table.bind(console) : noop,
  
  /** Time measurement - only in development */
  time: isDev ? console.time.bind(console) : noop,
  timeEnd: isDev ? console.timeEnd.bind(console) : noop,
};

export default logger;
