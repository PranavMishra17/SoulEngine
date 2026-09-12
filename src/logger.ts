import pino from 'pino';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as pino.Level;

const LOGGER_OPTIONS: pino.LoggerOptions = {
  level: LOG_LEVEL,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    service: 'evolve-npc',
    version: '1.0.0',
  },
};

// Tools whose stdout is a machine-readable stream (the playground's JSON lines)
// set LOG_DESTINATION=stderr before this module loads so logs never mix with data.
const baseLogger =
  process.env.LOG_DESTINATION === 'stderr'
    ? pino(LOGGER_OPTIONS, pino.destination(2))
    : pino(LOGGER_OPTIONS);

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  return baseLogger.child({ module: name });
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export const logger = createLogger('root');

