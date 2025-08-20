const logger = require('../utils/logger');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400);
    this.field = field;
    this.type = 'validation';
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.type = 'not_found';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
    this.type = 'rate_limit';
  }
}

class ServiceUnavailableError extends AppError {
  constructor(service = 'Service') {
    super(`${service} temporarily unavailable`, 503);
    this.type = 'service_unavailable';
  }
}

// Error handling middleware
const errorHandler = (error, req, res, next) => {
  let err = { ...error };
  err.message = error.message;
  err.stack = error.stack;

  // Log error details
  const errorContext = {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.method !== 'GET' ? req.body : undefined,
    params: req.params,
    query: req.query
  };

  // Determine error type and log accordingly
  if (error.isOperational) {
    logger.warn('Operational Error', {
      message: error.message,
      statusCode: error.statusCode,
      type: error.type || 'operational',
      ...errorContext
    });
  } else {
    logger.error('System Error', {
      message: error.message,
      stack: error.stack,
      ...errorContext
    });
  }

  // Handle specific error types
  
  // Mongoose/MongoDB errors
  if (error.name === 'CastError') {
    const message = `Invalid ${error.path}: ${error.value}`;
    err = new ValidationError(message, error.path);
  }

  // Mongoose validation errors
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(val => ({
      field: val.path,
      message: val.message
    }));
    const message = 'Validation failed';
    err = new ValidationError(message);
    err.errors = errors;
  }

  // Mongoose duplicate key errors
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const message = `Duplicate ${field}`;
    err = new ValidationError(message, field);
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    err = new AppError('Invalid token', 401);
  }

  if (error.name === 'TokenExpiredError') {
    err = new AppError('Token expired', 401);
  }

  // Redis connection errors
  if (error.code === 'ECONNREFUSED' && error.port === 6379) {
    err = new ServiceUnavailableError('Cache service');
  }

  // HTTP request errors (axios)
  if (error.response) {
    const status = error.response.status;
    const message = error.response.data?.message || error.message;
    
    if (status === 429) {
      err = new RateLimitError('External API rate limit exceeded');
    } else if (status >= 500) {
      err = new ServiceUnavailableError('External service');
    } else {
      err = new AppError(message, status);
    }
  }

  // Network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    err = new ServiceUnavailableError('External service');
  }

  // Timeout errors
  if (error.code === 'ETIMEDOUT') {
    err = new ServiceUnavailableError('Request timeout');
  }

  // Parse errors
  if (error.type === 'entity.parse.failed') {
    err = new ValidationError('Invalid JSON payload');
  }

  // Entity too large errors
  if (error.type === 'entity.too.large') {
    err = new ValidationError('Request payload too large');
  }

  // Set default error properties
  if (!err.statusCode) {
    err.statusCode = 500;
  }

  if (!err.message) {
    err.message = 'Something went wrong';
  }

  // Prepare error response
  const response = {
    success: false,
    error: err.message,
    status: err.status || 'error'
  };

  // Add additional error details in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.details = {
      type: err.type,
      code: err.code,
      field: err.field,
      errors: err.errors
    };
  }

  // Add error type for client handling
  if (err.type) {
    response.type = err.type;
  }

  // Add field information for validation errors
  if (err.field) {
    response.field = err.field;
  }

  // Add multiple validation errors
  if (err.errors) {
    response.errors = err.errors;
  }

  // Send error response
  res.status(err.statusCode).json(response);
};

// 404 Not Found handler
const notFound = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  const error = new NotFoundError(message);
  next(error);
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Validation middleware
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
        
        const validationError = new ValidationError('Validation failed');
        validationError.errors = errors;
        return next(validationError);
      }

      req[property] = value;
      next();
    } catch (err) {
      next(new ValidationError('Invalid validation schema'));
    }
  };
};

// Rate limiting error handler
const rateLimitHandler = (req, res) => {
  const error = new RateLimitError();
  const response = {
    success: false,
    error: error.message,
    type: error.type,
    retryAfter: Math.ceil(res.getHeader('Retry-After') || 60)
  };

  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    url: req.originalUrl,
    method: req.method,
    userAgent: req.get('User-Agent')
  });

  res.status(error.statusCode).json(response);
};

// Service health checker middleware
const serviceHealthCheck = (serviceName, healthCheckFn) => {
  return asyncHandler(async (req, res, next) => {
    try {
      const isHealthy = await healthCheckFn();
      if (!isHealthy) {
        throw new ServiceUnavailableError(serviceName);
      }
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(new ServiceUnavailableError(serviceName));
      }
    }
  });
};

// Request timeout middleware
const timeout = (seconds = 30) => {
  return (req, res, next) => {
    const timeoutId = setTimeout(() => {
      const error = new ServiceUnavailableError('Request timeout');
      error.code = 'TIMEOUT';
      next(error);
    }, seconds * 1000);

    res.on('finish', () => {
      clearTimeout(timeoutId);
    });

    res.on('close', () => {
      clearTimeout(timeoutId);
    });

    next();
  };
};

// Database connection error handler
const dbErrorHandler = (error) => {
  if (error.code === 'ECONNREFUSED') {
    return new ServiceUnavailableError('Database');
  }
  
  if (error.code === 'ENOTFOUND') {
    return new ServiceUnavailableError('Database host');
  }
  
  if (error.name === 'MongoError' && error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return new ValidationError(`Duplicate ${field}`, field);
  }
  
  return new AppError('Database error', 500, false);
};

// Global error handlers for uncaught exceptions
const setupGlobalErrorHandlers = () => {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception - Shutting down...', {
      message: error.message,
      stack: error.stack
    });
    
    // Close server gracefully
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString()
    });
    
    // Don't exit the process for unhandled rejections
    // Just log them and continue
  });
};

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  
  // Middleware
  errorHandler,
  notFound,
  asyncHandler,
  validate,
  rateLimitHandler,
  serviceHealthCheck,
  timeout,
  
  // Utilities
  dbErrorHandler,
  setupGlobalErrorHandlers
};
