// app.js (강화)
const express = require('express');
const cors = require('cors');
const NewsService = require('./src/services/newsService');
const app = express();

app.use(cors()); // CORS 활성화
app.use(express.json());

const news = new NewsService();

app.get('/api/:section/fast', async (req, res, next) => {
  try {
    const { page = 1, limit } = req.query;
    res.json(await news.getSectionFast(req.params.section, +page, +limit));
  } catch (e) {
    next(e);
  }
});

app.get('/api/:section', async (req, res, next) => {
  try {
    const { page = 1, limit } = req.query;
    res.json(await news.getSectionFull(req.params.section, +page, +limit));
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