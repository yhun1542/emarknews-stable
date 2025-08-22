const pino = require('pino');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (error) {
    console.warn('Could not create logs directory:', error.message);
  }
}

// Define log configuration
const logConfig = {
  level: process.env.LOG_LEVEL || 'info',
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => {
      return { level: label };
    },
    bindings: (bindings) => {
      return { pid: bindings.pid, hostname: bindings.hostname };
    },
    log: (object) => {
      if (object.err) {
        // Handle Error objects
        const err = object.err;
        object.err = {
          message: err.message,
          stack: err.stack,
          type: err.name,
          code: err.code
        };
      }
      return object;
    }
  }
};

// Create logger instance
const pinoLogger = pino(logConfig);

// Create a wrapper with winston-like interface for compatibility
const logger = {
  info: (message, meta = {}) => pinoLogger.info(meta, message),
  warn: (message, meta = {}) => pinoLogger.warn(meta, message),
  error: (message, meta = {}) => pinoLogger.error(meta, message),
  debug: (message, meta = {}) => pinoLogger.debug(meta, message),
  
  // Custom methods for different log types
  api: (message, meta = {}) => {
    pinoLogger.info({ service: 'API', ...meta }, message);
  },
  
  service: (serviceName, message, meta = {}) => {
    pinoLogger.info({ service: serviceName, ...meta }, message);
  },
  
  performance: (message, metrics = {}) => {
    pinoLogger.info({ service: 'PERFORMANCE', ...metrics }, message);
  },
  
  security: (message, meta = {}) => {
    pinoLogger.warn({ service: 'SECURITY', ...meta }, message);
  },
  
  startup: (message, meta = {}) => {
    pinoLogger.info({ service: 'STARTUP', ...meta }, message);
  },
  
  database: (message, meta = {}) => {
    pinoLogger.info({ service: 'DATABASE', ...meta }, message);
  },
  
  // Request logging middleware helper
  createRequestLogger: () => {
    return (req, res, next) => {
      const startTime = Date.now();
      const originalSend = res.send;
      
      // Override res.send to capture response
      res.send = function(data) {
        const duration = Date.now() - startTime;
        const contentLength = data ? Buffer.byteLength(data, 'utf8') : 0;
        
        // Log request details
        const logData = {
          method: req.method,
          url: req.originalUrl,
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          contentLength: `${contentLength}B`
        };
        
        if (res.statusCode >= 400) {
          logger.warn('HTTP Request Failed', logData);
        } else if (req.originalUrl !== '/health' && req.originalUrl !== '/healthz') {
          // Don't log health checks to reduce noise
          logger.api('HTTP Request', logData);
        }
        
        return originalSend.call(this, data);
      };
      
      next();
    };
  },
  
  // Error logging helper
  logError: (error, context = {}) => {
    const errorData = {
      message: error.message,
      stack: error.stack,
      code: error.code,
      ...context
    };
    
    if (error.response) {
      // HTTP error
      errorData.status = error.response.status;
      errorData.statusText = error.response.statusText;
      errorData.url = error.config?.url;
    }
    
    logger.error('Application Error', errorData);
  },
  
  // System info logging
  logSystemInfo: () => {
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    logger.startup('System Information', systemInfo);
  },
  
  // Environment logging
  logEnvironment: () => {
    const env = {
      NODE_ENV: process.env.NODE_ENV,
      LOG_LEVEL: process.env.LOG_LEVEL,
      PORT: process.env.PORT,
      hasRedis: !!process.env.REDIS_URL,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasNewsAPI: !!process.env.NEWS_API_KEY,
      hasYouTube: !!process.env.YOUTUBE_API_KEY,
      hasCurrency: !!process.env.CURRENCY_API_KEY
    };
    
    logger.startup('Environment Configuration', env);
  }
};

// Export logger and helpers
module.exports = logger;

