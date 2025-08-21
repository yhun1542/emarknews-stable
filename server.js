const express = require("express");
const path = require("path");
const compression = require("compression");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");

// 기존 뉴스 서비스 import (CommonJS 방식 유지)
const NewsService = require("./src/services/newsService.js");

const app = express();
const PORT = process.env.PORT || 8080;

// 뉴스 서비스 인스턴스 생성
const newsService = new NewsService();

// 보안/성능 기본
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan("combined"));
app.use(cors());

// JSON 파싱
app.use(express.json());

// API는 캐시 금지
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// 기존 API 라우트들 유지
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 뉴스 API 라우트들
app.get('/api/:section', async (req, res) => {
    try {
        const { section } = req.params;
        const news = await newsService.getNews(section);
        res.json({ success: true, data: news });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/:section/fast', async (req, res) => {
    try {
        const { section } = req.params;
        const news = await newsService.getNews(section, true); // fast mode
        res.json({ success: true, data: news });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 프론트엔드 호환을 위한 라우트
app.get('/api/news/:section', async (req, res) => {
    try {
        const { section } = req.params;
        const news = await newsService.getNews(section, true);
        res.json({ success: true, data: news });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 정적 리소스: 1년 + immutable
const staticDir = path.join(__dirname, "public");
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

// 기타 정적 핸들링(없는 경로는 404)
app.use((req, res) => res.status(404).send("Not Found"));

app.listen(PORT, () => {
  console.log(`🚀 EmarkNews Server running on :${PORT}`);
});

