const winston = require('winston');
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

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]`;
    
    // Add service/module context if available
    if (meta.service) {
      logMessage += ` [${meta.service}]`;
    }
    
    logMessage += `: ${message}`;
    
    // Add stack trace for errors
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    // Add metadata if present
    if (Object.keys(meta).length > 0 && !meta.service) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    return logMessage;
  })
);

// Console format (more colorful for development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let logMessage = `${timestamp} ${level}: ${message}`;
    
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    if (Object.keys(meta).length > 0 && !meta.service) {
      logMessage += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create transports
const transports = [];

// Console transport (always active)
transports.push(new winston.transports.Console({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
  handleExceptions: true,
  handleRejections: true
}));

// File transports (only in production or when LOG_TO_FILE is set)
if (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
  try {
    // Combined log file
    transports.push(new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level: 'info',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    }));
    
    // Error log file
    transports.push(new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      handleExceptions: true,
      handleRejections: true
    }));
  } catch (error) {
    console.warn('Could not create file transports:', error.message);
  }
}

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false
});

// Add custom methods for different log types
logger.api = (message, meta = {}) => {
  logger.info(message, { service: 'API', ...meta });
};

logger.service = (serviceName, message, meta = {}) => {
  logger.info(message, { service: serviceName, ...meta });
};

logger.performance = (message, metrics = {}) => {
  logger.info(message, { service: 'PERFORMANCE', ...metrics });
};

logger.security = (message, meta = {}) => {
  logger.warn(message, { service: 'SECURITY', ...meta });
};

logger.startup = (message, meta = {}) => {
  logger.info(message, { service: 'STARTUP', ...meta });
};

logger.database = (message, meta = {}) => {
  logger.info(message, { service: 'DATABASE', ...meta });
};

// Request logging middleware helper
logger.createRequestLogger = () => {
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
};

// Error logging helper
logger.logError = (error, context = {}) => {
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
};

// System info logging
logger.logSystemInfo = () => {
  const systemInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  };
  
  logger.startup('System Information', systemInfo);
};

// Environment logging
logger.logEnvironment = () => {
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
};

// Graceful shutdown logging
logger.setupShutdownLogging = () => {
  process.on('SIGTERM', () => {
    logger.startup('Received SIGTERM, starting graceful shutdown');
  });
  
  process.on('SIGINT', () => {
    logger.startup('Received SIGINT, starting graceful shutdown');
  });
  
  process.on('exit', (code) => {
    logger.startup(`Process exiting with code: ${code}`);
  });
};

// Performance monitoring
let requestCount = 0;
let errorCount = 0;

logger.incrementRequestCount = () => {
  requestCount++;
};

logger.incrementErrorCount = () => {
  errorCount++;
};

logger.logPerformanceStats = () => {
  const stats = {
    requests: requestCount,
    errors: errorCount,
    errorRate: requestCount > 0 ? ((errorCount / requestCount) * 100).toFixed(2) + '%' : '0%',
    uptime: Math.floor(process.uptime()),
    memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  };
  
  logger.performance('Performance Statistics', stats);
  
  // Reset counters
  requestCount = 0;
  errorCount = 0;
};

// Start periodic performance logging
if (process.env.PERFORMANCE_LOGGING !== 'false') {
  setInterval(() => {
    logger.logPerformanceStats();
  }, 5 * 60 * 1000); // Every 5 minutes
}

// Log uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString()
  });
});

// Export logger and helpers
module.exports = logger;
