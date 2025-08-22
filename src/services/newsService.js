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

