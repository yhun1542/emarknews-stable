const redis = require('redis');
const logger = require('../utils/logger');

let client = null;

async function connectRedis() {
    try {
        const redisUrl = process.env.REDIS_URL;
        
        if (!redisUrl) {
            logger.warn('Redis URL not provided');
            return null;
        }

        client = redis.createClient({ 
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 3) return false;
                    return Math.min(retries * 100, 3000);
                }
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

        await client.connect();
        return client;
    } catch (error) {
        logger.error('Redis connection failed:', error.message);
        return null;
    }
}

// Safe Redis wrapper
const redisWrapper = {
    get: async (key) => {
        if (!client?.isOpen) return null;
        try {
            return await client.get(key);
        } catch (err) {
            return null;
        }
    },
    set: async (key, value, options) => {
        if (!client?.isOpen) return null;
        try {
            return await client.set(key, value, options);
        } catch (err) {
            return null;
        }
    },
    del: async (key) => {
        if (!client?.isOpen) return null;
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
