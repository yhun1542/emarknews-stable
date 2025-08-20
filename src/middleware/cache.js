const redisClient = require('../config/redis');

/**
 * 캐시 미들웨어
 * @param {number} ttl - Time to live in seconds
 */
const cache = (ttl = 3600) => {
  return async (req, res, next) => {
    try {
      // Redis가 연결되지 않았으면 캐시 없이 진행
      if (!redisClient.isConnected) {
        return next();
      }

      const key = `cache:${req.originalUrl}`;
      const cachedData = await redisClient.get(key);

      if (cachedData) {
        console.log(`📄 캐시에서 데이터 반환: ${key}`);
        return res.json(cachedData);
      }

      // 원본 res.json 함수 저장
      const originalJson = res.json;

      // res.json 오버라이드하여 캐시 저장
      res.json = function(data) {
        redisClient.set(key, data, ttl).catch(err => {
          console.error('캐시 저장 오류:', err);
        });
        
        console.log(`💾 데이터를 캐시에 저장: ${key}`);
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      console.error('캐시 미들웨어 오류:', error);
      next();
    }
  };
};

module.exports = { cache };
