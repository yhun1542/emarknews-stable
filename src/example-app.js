// EmarkNews Phoenix Redis 통합 예시
const express = require('express');
const redisClient = require('./config/redis');
const { cache } = require('./middleware/cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Redis 연결 초기화
redisClient.connect().catch(err => {
  console.error('Redis 연결 실패:', err);
});

// 미들웨어
app.use(express.json());

// 캐시 적용된 API 라우트 예시
app.get('/api/news/:section', cache(1800), (req, res) => {
  const { section } = req.params;
  
  // 실제 뉴스 데이터 로직이 여기에 들어갑니다
  const newsData = {
    section,
    articles: [
      { id: 1, title: '샘플 뉴스 1', timestamp: new Date().toISOString() },
      { id: 2, title: '샘플 뉴스 2', timestamp: new Date().toISOString() }
    ],
    cached: false
  };
  
  res.json(newsData);
});

app.get('/api/currency', cache(300), (req, res) => {
  // 환율 데이터 로직
  const currencyData = {
    usd_krw: 1350.50,
    eur_krw: 1450.30,
    jpy_krw: 9.15,
    timestamp: new Date().toISOString(),
    cached: false
  };
  
  res.json(currencyData);
});

// 헬스 체크 (Redis 상태 포함)
app.get('/health', (req, res) => {
  const redisStatus = redisClient.getConnectionStatus();
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    redis: redisStatus,
    service: 'emarknews-phoenix'
  });
});

// 캐시 관리 API
app.delete('/api/cache/:key?', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (key) {
      const deleted = await redisClient.del(`cache:${key}`);
      res.json({ message: `캐시 키 삭제: ${key}`, success: deleted });
    } else {
      const flushed = await redisClient.flushAll();
      res.json({ message: '모든 캐시 삭제', success: flushed });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 EmarkNews Phoenix 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📍 Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
  });
}

module.exports = app;
