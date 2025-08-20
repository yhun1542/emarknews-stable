const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Import services
const newsService = require('../services/newsService');
const currencyService = require('../services/currencyservice');
const youtubeService = require('../services/youtubeservice');
const aiService = require('../services/aiservice');
const ratingService = require('../services/ratingservice');

// Middleware for logging API requests
router.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    if (res.statusCode >= 400) {
      logger.warn(`API ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  
  next();
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const status = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        news: true,
        currency: true,
        youtube: true,
        ai: aiService.getStatus(),
        rating: ratingService.getStatus()
      }
    };

    res.json(status);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Health check failed'
    });
  }
});

// News endpoints
router.get('/news/:section?', async (req, res) => {
  try {
    const { section = 'world' } = req.params;
    const { cache = 'true', limit = '20' } = req.query;
    
    // Validate section
    const validSections = ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid section',
        validSections
      });
    }

    const useCache = cache !== 'false';
    const result = await newsService.getNews(section, useCache);
    
    // Apply limit if specified
    if (result.success && result.data.articles) {
      const limitNum = parseInt(limit, 10);
      if (limitNum > 0 && limitNum < result.data.articles.length) {
        result.data.articles = result.data.articles.slice(0, limitNum);
      }
    }

    res.json(result);
    
  } catch (error) {
    logger.error(`News API error for section ${req.params.section}:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all sections summary
router.get('/news', async (req, res) => {
  try {
    const sections = ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    const summaries = {};
    
    // Get first 5 articles from each section
    const promises = sections.map(async (section) => {
      try {
        const result = await newsService.getNews(section, true);
        if (result.success) {
          summaries[section] = {
            articles: result.data.articles.slice(0, 5),
            total: result.data.total,
            cached: result.data.cached
          };
        } else {
          summaries[section] = {
            articles: [],
            total: 0,
            error: result.error
          };
        }
      } catch (error) {
        logger.warn(`Failed to fetch summary for ${section}:`, error.message);
        summaries[section] = {
          articles: [],
          total: 0,
          error: error.message
        };
      }
    });
    
    await Promise.all(promises);
    
    res.json({
      success: true,
      data: {
        sections: summaries,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('News summary API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch news summary'
    });
  }
});

// Currency endpoints
router.get('/currency', async (req, res) => {
  try {
    const result = await currencyService.getCurrencyRates();
    res.json(result);
    
  } catch (error) {
    logger.error('Currency API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// YouTube endpoints
router.get('/youtube/:section?', async (req, res) => {
  try {
    const { section = 'world' } = req.params;
    const { limit = '10' } = req.query;
    
    // Validate section
    const validSections = ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid section',
        validSections
      });
    }

    const result = await youtubeService.getVideos(section);
    
    // Apply limit if specified
    if (result.success && result.data.videos) {
      const limitNum = parseInt(limit, 10);
      if (limitNum > 0 && limitNum < result.data.videos.length) {
        result.data.videos = result.data.videos.slice(0, limitNum);
      }
    }

    res.json(result);
    
  } catch (error) {
    logger.error(`YouTube API error for section ${req.params.section}:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// AI endpoints
router.post('/translate', async (req, res) => {
  try {
    const { text, target = 'ko' } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    if (target !== 'ko') {
      return res.status(400).json({
        success: false,
        error: 'Only Korean translation is supported'
      });
    }

    const translated = await aiService.translateToKorean(text);
    
    res.json({
      success: true,
      data: {
        original: text,
        translated,
        target,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Translation API error:', error);
    res.status(500).json({
      success: false,
      error: 'Translation failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/summarize', async (req, res) => {
  try {
    const { text, points = 3 } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    const summaryPoints = await aiService.generateSummaryPoints(text, parseInt(points));
    
    res.json({
      success: true,
      data: {
        original: text,
        summaryPoints,
        pointsRequested: parseInt(points),
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Summarization API error:', error);
    res.status(500).json({
      success: false,
      error: 'Summarization failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rating endpoints
router.post('/rate', async (req, res) => {
  try {
    const { article } = req.body;
    
    if (!article || !article.title) {
      return res.status(400).json({
        success: false,
        error: 'Article with title is required'
      });
    }

    const rating = await ratingService.calculateRating(article);
    const tags = await ratingService.generateTags(article);
    const importance = ratingService.getImportanceScore(article);
    
    res.json({
      success: true,
      data: {
        rating,
        tags,
        importance,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Rating API error:', error);
    res.status(500).json({
      success: false,
      error: 'Rating failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Analytics endpoints
router.get('/trending', async (req, res) => {
  try {
    // Get articles from all sections for trending analysis
    const sections = ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    const allArticles = [];
    
    for (const section of sections) {
      try {
        const result = await newsService.getNews(section, true);
        if (result.success) {
          allArticles.push(...result.data.articles.slice(0, 10));
        }
      } catch (error) {
        logger.warn(`Failed to fetch ${section} for trending:`, error.message);
      }
    }
    
    const trendingTopics = ratingService.getTrendingTopics(allArticles);
    
    res.json({
      success: true,
      data: {
        trending: trendingTopics,
        totalArticles: allArticles.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Trending API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trending topics'
    });
  }
});

// Statistics endpoint
router.get('/stats', async (req, res) => {
  try {
    const stats = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        news: { status: 'active' },
        currency: currencyService.getStatus(),
        youtube: youtubeService.getStatus(),
        ai: aiService.getStatus(),
        rating: ratingService.getStatus()
      },
      environment: process.env.NODE_ENV || 'production',
      version: '7.0.0'
    };

    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    logger.error('Stats API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Search endpoint
router.get('/search', async (req, res) => {
  try {
    const { q, section, limit = '20' } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchTerm = q.trim().toLowerCase();
    const sections = section ? [section] : ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    const results = [];
    
    for (const sect of sections) {
      try {
        const newsResult = await newsService.getNews(sect, true);
        if (newsResult.success) {
          const matchingArticles = newsResult.data.articles.filter(article => 
            article.title.toLowerCase().includes(searchTerm) ||
            (article.description && article.description.toLowerCase().includes(searchTerm)) ||
            (article.titleKo && article.titleKo.toLowerCase().includes(searchTerm))
          );
          results.push(...matchingArticles);
        }
      } catch (error) {
        logger.warn(`Search failed for section ${sect}:`, error.message);
      }
    }
    
    // Sort by relevance and date
    const sortedResults = results
      .sort((a, b) => {
        const aScore = this.calculateRelevanceScore(a, searchTerm);
        const bScore = this.calculateRelevanceScore(b, searchTerm);
        if (aScore !== bScore) return bScore - aScore;
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      })
      .slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: {
        query: q,
        results: sortedResults,
        total: sortedResults.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Search API error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Calculate relevance score for search results
function calculateRelevanceScore(article, searchTerm) {
  let score = 0;
  const term = searchTerm.toLowerCase();
  
  if (article.title.toLowerCase().includes(term)) {
    score += 10;
    if (article.title.toLowerCase().startsWith(term)) {
      score += 5;
    }
  }
  
  if (article.titleKo && article.titleKo.toLowerCase().includes(term)) {
    score += 8;
  }
  
  if (article.description && article.description.toLowerCase().includes(term)) {
    score += 5;
  }
  
  if (article.tags && article.tags.some(tag => tag.toLowerCase().includes(term))) {
    score += 3;
  }
  
  return score;
}

// Error handling middleware
router.use((error, req, res, next) => {
  logger.error('API Error:', error);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler for API routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl,
    availableEndpoints: [
      'GET /api/news/:section',
      'GET /api/currency',
      'GET /api/youtube/:section',
      'POST /api/translate',
      'POST /api/summarize',
      'POST /api/rate',
      'GET /api/trending',
      'GET /api/stats',
      'GET /api/search'
    ]
  });
});

module.exports = router;