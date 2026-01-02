type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function baseLog(level: LogLevel, event: string, meta?: Record<string, any>) {
    const payload = {
        level,
        event,
        ts: new Date().toISOString(),
        ...meta,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
}

export const logDebug = (event: string, meta?: Record<string, any>) => baseLog('debug', event, meta);
export const logInfo = (event: string, meta?: Record<string, any>) => baseLog('info', event, meta);
export const logWarn = (event: string, meta?: Record<string, any>) => baseLog('warn', event, meta);
export const logError = (event: string, meta?: Record<string, any>) => baseLog('error', event, meta);
