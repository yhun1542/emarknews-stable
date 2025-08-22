// Simple mock Redis implementation
const logger = require('../utils/logger');

// Safe Redis wrapper with mock implementation
const redisWrapper = {
    get: async (key) => {
        logger.info(`[MOCK REDIS] GET ${key}`);
        return null;
    },
    set: async (key, value, options) => {
        logger.info(`[MOCK REDIS] SET ${key}`);
        return "OK";
    },
    del: async (key) => {
        logger.info(`[MOCK REDIS] DEL ${key}`);
        return 1;
    }
};

// No-op function
async function connectRedis() {
    logger.info('Redis connection skipped (mock implementation)');
    return null;
}

module.exports = {
    connectRedis,
    redis: redisWrapper,
    getClient: () => null
};

