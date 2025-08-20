const logger = require('../utils/logger');

// Import services
const newsService = require('../services/newsService');
const currencyService = require('../services/currencyService');
const youtubeService = require('../services/youtubeService');
const aiService = require('../services/aiService');

// Server configuration
const serverConfig = {
  // Basic server settings
  port: process.env.PORT || 8080,
  host: process.env.HOST || '0.0.0.0',
  
  // Environment settings
  nodeEnv: process.env.NODE_ENV || 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Security settings
  trustProxy: true,
  corsOrigin: process.env.CORS_ORIGIN || true,
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    message: 'Too many requests from this IP, please try again later.'
  },
  
  // Cache settings
  cache: {
    ttl: parseInt(process.env.CACHE_TTL) || 600, // 10 minutes
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 120 // 2 minutes
  },
  
  // API settings
  api: {
    prefix: '/api',
    version: 'v1',
    timeout: parseInt(process.env.API_TIMEOUT) || 30000 // 30 seconds
  },
  
  // Service update intervals
  updateIntervals: {
    news: parseInt(process.env.NEWS_UPDATE_INTERVAL) || 600000, // 10 minutes
    currency: parseInt(process.env.CURRENCY_UPDATE_INTERVAL) || 1800000, // 30 minutes
    youtube: parseInt(process.env.YOUTUBE_UPDATE_INTERVAL) || 1800000 // 30 minutes
  },
  
  // Logging settings
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined'
  },
  
  // Health check settings
  healthCheck: {
    endpoint: '/health',
    timeout: 5000
  },
  
  // Static file settings
  static: {
    maxAge: '1h',
    etag: true,
    lastModified: true
  },
  
  // Request settings
  request: {
    limit: '10mb',
    parameterLimit: 1000,
    timeout: 30000
  }
};

// Service initialization function
async function initializeServices() {
  const initResults = [];
  
  try {
    logger.info('🔧 Initializing services...');
    
    // Initialize news service
    try {
      if (typeof newsService.startBackgroundUpdates === 'function') {
        newsService.startBackgroundUpdates();
        logger.info('✅ News service initialized');
        initResults.push({ service: 'news', status: 'success' });
      }
    } catch (error) {
      logger.warn('⚠️ News service initialization failed:', error.message);
      initResults.push({ service: 'news', status: 'failed', error: error.message });
    }
    
    // Initialize currency service
    try {
      if (typeof currencyService.startBackgroundUpdates === 'function') {
        currencyService.startBackgroundUpdates();
        logger.info('✅ Currency service initialized');
        initResults.push({ service: 'currency', status: 'success' });
      }
    } catch (error) {
      logger.warn('⚠️ Currency service initialization failed:', error.message);
      initResults.push({ service: 'currency', status: 'failed', error: error.message });
    }
    
    // Initialize YouTube service
    try {
      if (typeof youtubeService.startBackgroundUpdates === 'function') {
        youtubeService.startBackgroundUpdates();
        logger.info('✅ YouTube service initialized');
        initResults.push({ service: 'youtube', status: 'success' });
      }
    } catch (error) {
      logger.warn('⚠️ YouTube service initialization failed:', error.message);
      initResults.push({ service: 'youtube', status: 'failed', error: error.message });
    }
    
    // Initialize AI service (no background updates needed, just verify)
    try {
      const aiStatus = aiService.getStatus();
      logger.info('✅ AI service initialized', aiStatus.hasOpenAI ? '(with OpenAI)' : '(basic mode)');
      initResults.push({ service: 'ai', status: 'success', openai: aiStatus.hasOpenAI });
    } catch (error) {
      logger.warn('⚠️ AI service initialization failed:', error.message);
      initResults.push({ service: 'ai', status: 'failed', error: error.message });
    }
    
    const successCount = initResults.filter(r => r.status === 'success').length;
    const totalCount = initResults.length;
    
    logger.info(`🎯 Services initialized: ${successCount}/${totalCount} successful`);
    
    return {
      success: successCount === totalCount,
      results: initResults,
      summary: `${successCount}/${totalCount} services initialized successfully`
    };
    
  } catch (error) {
    logger.error('❌ Service initialization failed:', error);
    throw error;
  }
}

// Validate environment variables
function validateEnvironment() {
  const warnings = [];
  const errors = [];
  
  // Check required environment variables
  const requiredEnvVars = {
    'NODE_ENV': process.env.NODE_ENV || 'production'
  };
  
  // Check optional but recommended environment variables
  const optionalEnvVars = {
    'REDIS_URL': process.env.REDIS_URL,
    'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
    'NEWS_API_KEY': process.env.NEWS_API_KEY,
    'YOUTUBE_API_KEY': process.env.YOUTUBE_API_KEY,
    'CURRENCY_API_KEY': process.env.CURRENCY_API_KEY
  };
  
  // Log environment status
  logger.info('📋 Environment validation:');
  
  Object.entries(requiredEnvVars).forEach(([key, value]) => {
    if (value) {
      logger.info(`  ✅ ${key}: ${key === 'NODE_ENV' ? value : '[SET]'}`);
    } else {
      errors.push(`Missing required environment variable: ${key}`);
      logger.error(`  ❌ ${key}: [MISSING]`);
    }
  });
  
  Object.entries(optionalEnvVars).forEach(([key, value]) => {
    if (value) {
      logger.info(`  ✅ ${key}: [SET]`);
    } else {
      warnings.push(`Optional environment variable not set: ${key}`);
      logger.warn(`  ⚠️ ${key}: [NOT SET]`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      required: Object.keys(requiredEnvVars).length,
      optional: Object.keys(optionalEnvVars).length,
      set: Object.values({...requiredEnvVars, ...optionalEnvVars}).filter(Boolean).length
    }
  };
}

// Get service status
function getServiceStatus() {
  const services = {};
  
  try {
    // News service status
    services.news = {
      active: true,
      hasBackgroundUpdates: typeof newsService.startBackgroundUpdates === 'function'
    };
  } catch (error) {
    services.news = { active: false, error: error.message };
  }
  
  try {
    // Currency service status
    services.currency = currencyService.getStatus ? currencyService.getStatus() : { active: true };
  } catch (error) {
    services.currency = { active: false, error: error.message };
  }
  
  try {
    // YouTube service status
    services.youtube = youtubeService.getStatus ? youtubeService.getStatus() : { active: true };
  } catch (error) {
    services.youtube = { active: false, error: error.message };
  }
  
  try {
    // AI service status
    services.ai = aiService.getStatus ? aiService.getStatus() : { active: true };
  } catch (error) {
    services.ai = { active: false, error: error.message };
  }
  
  return services;
}

// Graceful shutdown handler
function setupGracefulShutdown(server, onShutdown) {
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`📡 Received ${signal}, starting graceful shutdown...`);
      
      if (onShutdown) {
        await onShutdown();
      }
      
      if (server) {
        server.close((err) => {
          if (err) {
            logger.error('❌ Error during server close:', err);
            process.exit(1);
          } else {
            logger.info('✅ Server closed successfully');
            process.exit(0);
          }
        });
      } else {
        process.exit(0);
      }
    });
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('💥 Uncaught Exception:', error);
    process.exit(1);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
  });
}

// Performance monitoring
function getPerformanceMetrics() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.floor(memUsage.rss / 1024 / 1024), // MB
      heapTotal: Math.floor(memUsage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.floor(memUsage.heapUsed / 1024 / 1024), // MB
      external: Math.floor(memUsage.external / 1024 / 1024) // MB
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version
  };
}

// Start performance monitoring
function startPerformanceMonitoring() {
  // Log performance metrics every 5 minutes
  setInterval(() => {
    const metrics = getPerformanceMetrics();
    logger.info('📊 Performance metrics:', {
      uptime: `${metrics.uptime}s`,
      memory: `${metrics.memory.heapUsed}/${metrics.memory.heapTotal}MB`,
      pid: metrics.pid
    });
  }, 5 * 60 * 1000);
  
  logger.info('📊 Performance monitoring started');
}

module.exports = {
  serverConfig,
  initializeServices,
  validateEnvironment,
  getServiceStatus,
  setupGracefulShutdown,
  getPerformanceMetrics,
  startPerformanceMonitoring
};