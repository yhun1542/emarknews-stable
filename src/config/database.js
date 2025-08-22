const Redis = require('ioredis');
const logger = require('../utils/logger');

let client = null;

async function connectRedis() {
    try {
        const redisUrl = process.env.REDIS_URL;
        
        if (!redisUrl) {
            logger.warn('Redis URL not provided');
            return null;
        }

        client = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                if (times > 3) return false;
                return Math.min(times * 100, 3000);
            }
        });

        client.on('error', (err) => {
            logger.error('Redis error:', err.message);
        });

        client.on('connect', () => {
            logger.info('Redis connecting...');
        });

        client.on('ready', () => {
            logger.info('Redis ready');
        });

        return client;
    } catch (error) {
        logger.error('Redis connection failed:', error.message);
        return null;
    }
}

// Safe Redis wrapper
const redisWrapper = {
    get: async (key) => {
        if (!client) return null;
        try {
            return await client.get(key);
        } catch (err) {
            return null;
        }
    },
    set: async (key, value, options) => {
        if (!client) return null;
        try {
            if (options && options.EX) {
                return await client.set(key, value, 'EX', options.EX);
            }
            return await client.set(key, value);
        } catch (err) {
            return null;
        }
    },
    del: async (key) => {
        if (!client) return null;
        try {
            return await client.del(key);
        } catch (err) {
            return null;
        }
    }
};

module.exports = {
    connectRedis,
    redis: redisWrapper,
    getClient: () => client
};

