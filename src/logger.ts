import pino from 'pino';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as pino.Level;

const baseLogger = pino({
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
});

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  return baseLogger.child({ module: name });
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export const logger = createLogger('root');

