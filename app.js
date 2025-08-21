// app.js (강화)
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const NewsService = require('./src/services/newsService');

const app = express();

// 미들웨어 설정
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(cors()); // CORS 활성화
app.use(express.json());

// API는 캐시 금지
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// 정적 파일 서빙 (캐시 헤더 포함)
const staticDir = path.join(__dirname, 'public');
app.use(
  express.static(staticDir, {
    setHeaders: (res, filePath) => {
      if (/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|mp4|webm)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(html)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    },
    extensions: ["html"]
  })
);

// 개별 HTML 라우트는 재검증 헤더 보장
const htmlFiles = ["/index.html", "/detail.html"];
htmlFiles.forEach((p) => {
  app.get(p, (req, res) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.join(staticDir, p));
  });
});

// 루트 → index.html
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.sendFile(path.join(staticDir, "index.html"));
});

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

// 상세 기사 조회 API 엔드포인트
app.get('/api/article/:section/:id', async (req, res, next) => {
  try {
    const { section, id } = req.params;
    const result = await news.getArticleById(section, id);
    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(404).json({ 
        success: false,
        error: 'Article not found' 
      });
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