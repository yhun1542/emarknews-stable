const axios = require('axios');
const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');
const ratingService = require('./ratingservice');

const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
const GNEWS_API_KEY = process.env.GNEWS_API_KEY || '';
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

class NewsService {
  constructor() {
    this.parser = new Parser({
      timeout: 5000,
      headers: { 'User-Agent': 'EmarkNews/2.0 (Advanced News Aggregator)' }
    });

    // Axios clients
    this.naverApi = axios.create({
      baseURL: 'https://openapi.naver.com/v1/search/',
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
      },
      timeout: 8000
    });

    this.gnewsApi = axios.create({
      baseURL: 'https://gnews.io/api/v4/',
      timeout: 8000
    });

    this.sectionTTLs = {
      world: 600,
      kr: 300,
      japan: 300,
      tech: 900,
      business: 900,
      buzz: 180
    };
    this.minRemainingRequests = 50;
    this.minRemainingTokens = 5000;

    // 소스 정의 - API 우선, RSS 다음 (일본 제외)
    this.sources = {
      world: {
        api: [{ type: 'gnews', params: { category: 'world', lang: 'en' } }],
        rss: [
          { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', lang: 'en' },
          { url: 'https://rss.cnn.com/rss/edition.rss', name: 'CNN', lang: 'en' },
          { url: 'https://feeds.feedburner.com/reuters/topNews', name: 'Reuters', lang: 'en' },
          { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', lang: 'en' }
        ]
      },
      kr: {
        api: [{ type: 'naver', params: { query: '속보 OR 긴급 OR 최신뉴스', display: 30 } }],
        rss: [
          { url: 'https://www.yna.co.kr/rss/news.xml', name: 'Yonhap News', lang: 'ko' },
          { url: 'https://rss.hankyung.com/news/economy.xml', name: 'Hankyung Economy', lang: 'ko' }
        ]
      },
      japan: {
        // 일본은 요청대로 RSS만 사용
        api: [],
        rss: [
          { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK', lang: 'ja' },
          { url: 'https://www.yomiuri.co.jp/rss/news.xml', name: 'Yomiuri Shimbun', lang: 'ja' }
        ]
      },
      tech: {
        api: [{ type: 'gnews', params: { category: 'technology', lang: 'en' } }],
        rss: [
          { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', lang: 'en' },
          { url: 'https://www.wired.com/feed/rss', name: 'Wired', lang: 'en' }
        ]
      },
      business: {
        api: [{ type: 'gnews', params: { category: 'business', lang: 'en' } }],
        rss: [
          { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets', lang: 'en' },
          { url: 'https://www.ft.com/rss/companies', name: 'Financial Times', lang: 'en' }
        ]
      },
      buzz: {
        api: [{ type: 'gnews', params: { category: 'entertainment', lang: 'en' } }],
        rss: [
          { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', name: 'BBC Entertainment', lang: 'en' }
        ]
      }
    };
  }

  // Entry
  async getNews(section = 'world', useCache = true, page = 1, limit = 50) {
    const cacheKey = `news_v4:${section}`;
    if (useCache) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          return { success: true, data: { ...parsed, cached: true } };
        }
      } catch (e) {
        logger.warn('Cache read failed:', e.message);
      }
    }

    const src = this.sources[section] || this.sources.world;
    const promises = [];

    // APIs - 일본 섹션을 제외하고 API를 우선적으로 처리
    if (section !== 'japan') {
      // API 호출 먼저 추가
      for (const apiSrc of (src.api || [])) {
        if (apiSrc.type === 'naver') promises.push(this.fetchFromNaverAPI(apiSrc.params.query, apiSrc.params.display));
        if (apiSrc.type === 'gnews') promises.push(this.fetchFromGNewsAPI(apiSrc.params));
      }
      // RSS는 그 다음에 추가
      if (src.rss?.length) promises.push(this.fetchFromRSS(src.rss));
    } else {
      // 일본 섹션은 RSS만 사용
      if (src.rss?.length) promises.push(this.fetchFromRSS(src.rss));
    }

    const results = await Promise.allSettled(promises);
    const rawArticles = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value || []);
    const unique = this.deduplicateAndSort(rawArticles);
    const processed = await this.processArticlesWithAI(unique.slice(0, limit), section);

    const out = {
      articles: processed,
      total: processed.length,
      timestamp: new Date().toISOString(),
      cached: false,
      sources: [...(src.api?.map(s => s.type) || []), ...(src.rss?.map(s => s.name) || [])]
    };

    if (useCache && processed.length) {
      try { await redis.set(cacheKey, JSON.stringify(out), { EX: this.sectionTTLs[section] || 600 }); }
      catch (e) { logger.warn('Cache write failed:', e.message); }
    }
    return { success: true, data: out };
  }

  // Naver optimized
  async fetchFromNaverAPI(query, display = 30) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
    const cacheKey = `naver:${query}:${display}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) { logger.warn(`Redis read failed: ${e.message}`); }

    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    let retries = 0;

    while (retries < 5) {
      try {
        const resp = await this.naverApi.get('news.json', {
          params: { query, display: Math.min(display, 100), sort: 'date' }
        });
        const items = (resp.data.items || []).map(item => ({
          ...this.normalizeArticle(item, 'NaverAPI', 'ko'),
          _keyword: query
        }));
        await redis.set(cacheKey, JSON.stringify(items), { EX: 300 });
        return items;
      } catch (err) {
        if (err.response?.status === 429) {
          const wait = Math.pow(2, retries) * 1000;
          logger.warn(`Naver API rate limit, retry in ${wait}ms`);
          await delay(wait); retries++;
        } else { logger.error(`Naver API error: ${err.message}`); break; }
      }
    }
    return [];
  }

  // GNews optimized
  async fetchFromGNewsAPI(params) {
    if (!GNEWS_API_KEY) return [];
    const cacheKey = `gnews:${params.category}:${params.lang}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) { logger.warn(`Redis read failed: ${e.message}`); }

    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    let retries = 0;
    while (retries < 5) {
      try {
        const resp = await this.gnewsApi.get('top-headlines', {
          params: { ...params, max: 50, apikey: GNEWS_API_KEY }
        });
        const articles = (resp.data.articles || []).map(it => this.normalizeGNewsArticle(it));
        await redis.set(cacheKey, JSON.stringify(articles), { EX: 300 });
        return articles;
      } catch (err) {
        if (err.response?.status === 429) {
          const wait = Math.pow(2, retries) * 1000;
          logger.warn(`GNews rate limit, retry in ${wait}ms`);
          await delay(wait); retries++;
        } else { logger.error(`GNews error: ${err.message}`); break; }
      }
    }
    return [];
  }

  // RSS optimized
  async fetchFromRSS(sources) {
    const tasks = sources.map(async (source) => {
      const cacheKey = `rss:${source.name}`;
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (e) { logger.warn(`Redis read failed: ${e.message}`); }
      let retries = 0;
      const delay = (ms) => new Promise(res => setTimeout(res, ms));
      while (retries < 3) {
        try {
          const feed = await this.parser.parseURL(source.url);
          const items = feed.items.map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
          await redis.set(cacheKey, JSON.stringify(items), { EX: 300 });
          return items;
        } catch (err) {
          if ((err.message || '').includes('429')) {
            const wait = Math.pow(2, retries) * 1000;
            logger.warn(`RSS rate limit for ${source.name}, retry in ${wait}ms`);
            await delay(wait); retries++;
          } else { logger.error(`RSS fetch failed: ${err.message}`); break; }
        }
      }
      return [];
    });
    const results = await Promise.allSettled(tasks);
    return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value || []);
  }

  // AI processing
  async processArticlesWithAI(articles, section) {
    const ttl = this.sectionTTLs[section] || 600;
    const tasks = articles.map(async (article) => {
      const cacheKey = `article:${section}:${Buffer.from(article.url || '').toString('base64').slice(0, 16)}`;
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        let titleKo = article.title;
        let descriptionKo = article.description;
        let summaryPoints = ['요약 정보를 생성 중입니다...'];
        let aiDetailedSummary = '';
        let hasTranslation = false;

        const s = aiService.getStatus();
        if (s.remainingRequests !== undefined && s.remainingTokens !== undefined) {
          if (s.remainingRequests < this.minRemainingRequests || s.remainingTokens < this.minRemainingTokens) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (article.language !== 'ko') {
          const [tTitle, tDesc] = await Promise.all([
            aiService.translateToKorean(article.title || '').catch(() => article.title),
            aiService.translateToKorean(article.description || '').catch(() => article.description)
          ]);
          titleKo = tTitle; descriptionKo = tDesc; hasTranslation = true;
        }

        const contentForSummary = descriptionKo || article.description || '';
        summaryPoints = await aiService.generateSummaryPoints(contentForSummary, 5)
          .catch(() => ['AI 요약 서비스를 일시적으로 사용할 수 없습니다.']);

        const rating = await ratingService.calculateRating(article);
        if (rating >= 4.0) {
          aiDetailedSummary = await aiService.generateDetailedSummary({ title: titleKo, content: contentForSummary })
            .catch(() => '상세 요약 생성 불가');
        }

        const processed = {
          ...article,
          titleKo,
          descriptionKo,
          originalTextKo: descriptionKo,
          timeAgo: this.formatTimeAgo(article.publishedAt),
          rating,
          tags: await ratingService.generateTags(article),
          id: `${section}_${Buffer.from((article.url || '')).toString('base64').slice(0, 12)}`,
          aiDetailedSummary,
          summaryPoints,
          hasTranslation,
          hasSummary: summaryPoints.length > 0,
          section
        };
        await redis.set(cacheKey, JSON.stringify(processed), { EX: ttl });
        return processed;
      } catch (e) {
        logger.warn(`AI 처리 실패: ${e.message}`);
        return { ...article, titleKo: article.title, descriptionKo: article.description, summaryPoints: ['AI 처리 실패'], aiDetailedSummary: '', hasTranslation: false, hasSummary: false };
      }
    });
    return Promise.all(tasks);
  }

  // Helpers
  normalizeArticle(item, apiSource, language, sourceName = null) {
    try {
      let title, description, url, urlToImage, publishedAt, source;
      switch (apiSource) {
        case 'NaverAPI':
          title = this.stripHtml(item.title);
          description = this.stripHtml(item.description);
          url = item.originallink || item.link;
          urlToImage = null;
          publishedAt = item.pubDate || new Date().toISOString();
          source = 'Naver News';
          break;
        case 'RSS':
          title = item.title;
          description = item.contentSnippet || item.content || '';
          url = item.link;
          urlToImage = item.enclosure?.url || null;
          publishedAt = item.pubDate || new Date().toISOString();
          source = sourceName || 'RSS Feed';
          break;
        default:
          // Generic
          title = item.title; description = item.description || item.content || '';
          url = item.url || item.link; urlToImage = item.urlToImage || item.image || null;
          publishedAt = item.publishedAt || item.pubDate || new Date().toISOString();
          source = item.source?.name || sourceName || 'News';
      }
      if (!title || !url) return null;
      return { title, description, content: description, url, urlToImage, source, publishedAt, apiSource, language };
    } catch (e) {
      logger.warn(`Normalization failed from ${apiSource}: ${e.message}`);
      return null;
    }
  }

  normalizeGNewsArticle(item) {
    return {
      title: item.title,
      description: item.description,
      content: item.description,
      url: item.url,
      urlToImage: item.image,
      source: { name: item.source?.name || 'GNews', id: item.source?.id || '' },
      publishedAt: item.publishedAt,
      apiSource: 'GNews',
      language: 'en'
    };
  }

  deduplicateAndSort(articles) {
    return (articles || [])
      .filter(a => a)
      .filter((a, i, self) => i === self.findIndex(x => x.url === a.url))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>?/gm, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }

  formatTimeAgo(publishedAt) {
    const now = new Date();
    const published = new Date(publishedAt);
    if (isNaN(published.getTime())) return '날짜 정보 없음';
    const diffMs = now - published;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    return `${diffDays}일 전`;
  }

  // Get article by ID for detail page
  async getArticleById(section, id) {
    try {
      // Handle both formats: with and without section prefix
      const actualId = id.startsWith(`${section}_`) ? id : `${section}_${id}`;
      const alternativeId = id.startsWith(`${section}_`) ? id.replace(`${section}_`, '') : id;
      
      // Try to get from cache first
      const cacheKey = `article:${section}:${Buffer.from(actualId).toString('base64').slice(0, 16)}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached) };
      }
      
      // If not in cache, fetch section news and find the article
      const result = await this.getNews(section, true);
      if (!result.success) {
        return { success: false, error: 'Failed to fetch section news' };
      }
      
      // Find article by ID (try both formats)
      const article = result.data.articles.find(a => 
        a.id === actualId || a.id === alternativeId || 
        a.id === `${section}_${alternativeId}` || a.id === alternativeId
      );
      
      if (!article) {
        return { success: false, error: 'Article not found' };
      }
      
      return { success: true, data: article };
    } catch (error) {
      logger.error(`Error fetching article by ID: ${error.message}`);
      return { success: false, error: 'Internal server error' };
    }
  }
}

module.exports = new NewsService();

