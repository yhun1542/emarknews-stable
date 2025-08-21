require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const helmet = require('helmet');

// Import custom modules
const { connectRedis, redis } = require('./config/database');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const { errorHandler, notFound } = require('./middleware/errorHandler');

class Application {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 8080;
    }

    async initialize() {
        try {
            logger.info('🚀 EmarkNews Phoenix Starting...');
            
            // Database connection
            await this.initializeDatabase();
            
            // Middleware
            this.setupMiddleware();
            
            // Routes
            this.setupRoutes();
            
            // Error handlers
            this.setupErrorHandlers();
            
            logger.info('✅ Application initialized successfully');
            return true;
        } catch (error) {
            logger.error('Initialization failed:', error);
            return false;
        }
    }

    async initializeDatabase() {
        try {
            await connectRedis();
            logger.info('✅ Redis connected');
        } catch (error) {
            logger.warn('⚠️ Redis not connected, running without cache');
        }
    }

    setupMiddleware() {
        // Trust proxy for Railway
        this.app.set('trust proxy', true);
        
        // Security
        this.app.use(helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false
        }));
        
        // CORS
        this.app.use(cors({
            origin: true,
            credentials: true
        }));
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Compression
        this.app.use(compression());
        
        // Request logging
        this.app.use((req, res, next) => {
            logger.info(`${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', async (req, res) => {
            const redisStatus = await redis.get('test').then(() => 'connected').catch(() => 'disconnected');
            res.json({
                status: 'healthy',
                version: '7.0.0',
                timestamp: new Date().toISOString(),
                redis: redisStatus,
                environment: process.env.NODE_ENV || 'production'
            });
        });

        // API routes
        this.app.use('/api', apiRoutes);

        // Static files
        const publicPath = path.join(__dirname, '..', 'public');
        this.app.use(express.static(publicPath));

        // SPA fallback
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(publicPath, 'index.html'));
        });
    }

    setupErrorHandlers() {
        this.app.use(notFound);
        this.app.use(errorHandler);

        // Graceful shutdown
        process.on('SIGTERM', this.gracefulShutdown.bind(this));
        process.on('SIGINT', this.gracefulShutdown.bind(this));
    }

    async start() {
        const initialized = await this.initialize();
        
        if (!initialized) {
            logger.error('Failed to initialize application');
            process.exit(1);
        }

        this.server = this.app.listen(this.port, '0.0.0.0', () => {
            logger.info(`✨ Server running on port ${this.port}`);
            logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
            
            if (process.env.RAILWAY_STATIC_URL) {
                logger.info(`🚂 Railway URL: ${process.env.RAILWAY_STATIC_URL}`);
            }
        });
    }

    async gracefulShutdown() {
        logger.info('Shutting down gracefully...');
        
        if (this.server) {
            this.server.close(() => {
                logger.info('Server closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    }
}

// Start application
if (require.main === module) {
    const app = new Application();
    app.start().catch(error => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = Application;
