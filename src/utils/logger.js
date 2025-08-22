// Simple logger implementation
const logger = {
  info: (message, meta = {}) => {
    console.log(`[INFO] ${message}`, meta);
  },
  warn: (message, meta = {}) => {
    console.log(`[WARN] ${message}`, meta);
  },
  error: (message, meta = {}) => {
    console.error(`[ERROR] ${message}`, meta);
  },
  debug: (message, meta = {}) => {
    console.log(`[DEBUG] ${message}`, meta);
  },
  
  // Custom methods for different log types
  api: (message, meta = {}) => {
    console.log(`[API] ${message}`, meta);
  },
  
  service: (serviceName, message, meta = {}) => {
    console.log(`[${serviceName}] ${message}`, meta);
  },
  
  performance: (message, metrics = {}) => {
    console.log(`[PERFORMANCE] ${message}`, metrics);
  },
  
  security: (message, meta = {}) => {
    console.log(`[SECURITY] ${message}`, meta);
  },
  
  startup: (message, meta = {}) => {
    console.log(`[STARTUP] ${message}`, meta);
  },
  
  database: (message, meta = {}) => {
    console.log(`[DATABASE] ${message}`, meta);
  },
  
  // Request logging middleware helper
  createRequestLogger: () => {
    return (req, res, next) => {
      const startTime = Date.now();
      const originalSend = res.send;
      
      // Override res.send to capture response
      res.send = function(data) {
        const duration = Date.now() - startTime;
        
        // Log request details
        if (res.statusCode >= 400) {
          console.log(`[WARN] HTTP Request Failed: ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
        } else if (req.originalUrl !== '/health' && req.originalUrl !== '/healthz') {
          // Don't log health checks to reduce noise
          console.log(`[INFO] HTTP Request: ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
        }
        
        return originalSend.call(this, data);
      };
      
      next();
    };
  },
  
  // Error logging helper
  logError: (error, context = {}) => {
    console.error(`[ERROR] Application Error: ${error.message}`, context);
  },
  
  // System info logging
  logSystemInfo: () => {
    console.log(`[STARTUP] System Information: Node ${process.version}, ${process.platform}`);
  },
  
  // Environment logging
  logEnvironment: () => {
    console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || 'development'}`);
  }
};

// Export logger and helpers
module.exports = logger;

