// app.js (강화)
const express = require('express');
const cors = require('cors');
const NewsService = require('./src/services/newsService');
const app = express();

app.use(cors()); // CORS 활성화
app.use(express.json());
app.use(express.static('public')); // 정적 파일 서빙

const news = new NewsService();

app.get('/api/:section/fast', async (req, res, next) => {
  try {
    const result = await news.getNews(req.params.section, true);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: 'Failed to fetch news' });
    }
  } catch (e) {
    next(e);
  }
});

app.get('/api/:section', async (req, res, next) => {
  try {
    const result = await news.getNews(req.params.section, false);
    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: 'Failed to fetch news' });
    }
  } catch (e) {
    next(e);
  }
});

// 프론트엔드 호환을 위한 /api/news/:section 라우트
app.get('/api/news/:section', async (req, res, next) => {
  try {
    const result = await news.getNews(req.params.section, true);
    if (result.success) {
      // 프론트엔드가 기대하는 형식으로 응답
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch news' });
    }
  } catch (e) {
    next(e);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`News API ready on port ${PORT}`));

module.exports = app;