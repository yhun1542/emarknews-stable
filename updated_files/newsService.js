/**
 * Emark 뉴스 서비스 (섹션 통합 + 가중치 프로필 포함 완성본)
 * - 섹션: buzz, world, korea, japan, business, tech
 * - 소스: X(Basic recent), Reddit, YouTube(mostPopular), RSS 화이트리스트
 * - 빠른 길: Phase1(600ms) → Phase2(1500ms) 백필(캐시: Redis)
 * - 랭킹: 섹션별 가중치 프로필(신선도/가속도/참여/신뢰/다양성/로케일)
 *
 * 환경변수(.env)
 * REDIS_URL=redis://localhost:6379
 * X_BEARER_TOKEN=...
 * REDDIT_TOKEN=...
 * REDDIT_USER_AGENT=emark-buzz/1.0
 * YOUTUBE_API_KEY=...
 *
 * FAST_PHASE1_DEADLINE_MS=600
 * FAST_PHASE2_DEADLINE_MS=1500
 * FAST_FIRST_BATCH_SIZE=24
 * FAST_FULL_MAX=100
 * FAST_REDIS_TTL_SEC=60
 * FULL_REDIS_TTL_SEC=600
 * RANK_TAU_MIN=90
 *
 * # (선택) 섹션별 가중치 오버라이드: "f,v,e,s,d,l" 형식으로 지정
 * WEIGHTS_BUZZ=0.25,0.40,0.15,0.10,0.05,0.05
 * WEIGHTS_WORLD=0.35,0.15,0.10,0.30,0.05,0.05
 * WEIGHTS_KOREA=0.30,0.20,0.10,0.30,0.05,0.05
 * WEIGHTS_JAPAN=0.30,0.20,0.10,0.30,0.05,0.05
 * WEIGHTS_BUSINESS=0.25,0.20,0.20,0.30,0.03,0.02
 * WEIGHTS_TECH=0.20,0.40,0.20,0.15,0.03,0.02
 */
const axios = require('axios');
const Parser = require('rss-parser');
const IORedis = require('ioredis');
const crypto = require('crypto');
const cors = require('cors'); // Express에 CORS 추가

// -------------------------------
// 구성 및 상수
// -------------------------------
const CONFIG = {
  API_TIMEOUT: 5000,
  BETA: 1000, // 참여도 계산 상수
  DIVERSITY_PENALTY_BASE: 0.1, // 다양성 패널티 기본 계수
  RANK_TAU_MIN: Number(process.env.RANK_TAU_MIN || 90),
  FAST: {
    PHASE1_MS: Number(process.env.FAST_PHASE1_DEADLINE_MS || 600),
    PHASE2_MS: Number(process.env.FAST_PHASE2_DEADLINE_MS || 1500),
    FIRST_BATCH: Number(process.env.FAST_FIRST_BATCH_SIZE || 24),
    FULL_MAX: Number(process.env.FAST_FULL_MAX || 100),
    TTL_FAST: Number(process.env.FAST_REDIS_TTL_SEC || 60),
    TTL_FULL: Number(process.env.FULL_REDIS_TTL_SEC || 600),
  },
  SOURCE_WEIGHTS: {
    'bbc.co.uk':5,'reuters.com':5,'aljazeera.com':4,'cnn.com':4,
    'yna.co.kr':4,'khan.co.kr':3,'hani.co.kr':3,
    'nhk.or.jp':5,'asahi.com':4,'mainichi.jp':4,
    'ft.com':5,'wsj.com':5,'bloomberg.com':5,'cnbc.com':4,
    'theverge.com':4,'arstechnica.com':4,'techcrunch.com':4,'wired.com':4,
    'reddit.com':3,'x.com':3,'youtube.com':4
  },
  YOUTUBE_CHANNEL_WHITELIST: new Set([
    'UC_4xOZ8s_fFlWmJ7GJ8d6LQ', // Yonhap
    'UCEgdi0XIXXZ-qJOFPf4JSKw', // CNN
    'UCWJ2lWNubArHWmf3FIHbfcQ' // The Verge
  ]),
  SECTIONS: ['buzz', 'world', 'korea', 'japan', 'business', 'tech'],
};

// 섹션별 가중치 프로필 (기본값)
const DEFAULT_WEIGHTS = {
  buzz: { f:0.25, v:0.40, e:0.15, s:0.10, d:0.05, l:0.05 },
  world: { f:0.35, v:0.15, e:0.10, s:0.30, d:0.05, l:0.05 },
  korea: { f:0.30, v:0.20, e:0.10, s:0.30, d:0.05, l:0.05 },
  japan: { f:0.30, v:0.20, e:0.10, s:0.30, d:0.05, l:0.05 },
  business: { f:0.25, v:0.20, e:0.20, s:0.30, d:0.03, l:0.02 },
  tech: { f:0.20, v:0.40, e:0.20, s:0.15, d:0.03, l:0.02 },
};

// 환경변수 오버라이드 파서
const parseWeight = (envVal, fallback) => {
  if (!envVal) return fallback;
  try {
    const [f, v, e, s, d, l] = envVal.split(',').map(Number);
    if ([f, v, e, s, d, l].some(Number.isNaN)) return fallback;
    return { f, v, e, s, d, l };
  } catch {
    return fallback;
  }
};

const SECTION_WEIGHTS = {
  buzz: parseWeight(process.env.WEIGHTS_BUZZ, DEFAULT_WEIGHTS.buzz),
  world: parseWeight(process.env.WEIGHTS_WORLD, DEFAULT_WEIGHTS.world),
  korea: parseWeight(process.env.WEIGHTS_KOREA, DEFAULT_WEIGHTS.korea),
  japan: parseWeight(process.env.WEIGHTS_JAPAN, DEFAULT_WEIGHTS.japan),
  business: parseWeight(process.env.WEIGHTS_BUSINESS, DEFAULT_WEIGHTS.business),
  tech: parseWeight(process.env.WEIGHTS_TECH, DEFAULT_WEIGHTS.tech),
};

// 섹션별 소스/쿼리/피드 (제공된 것 그대로, 언어 필터 확장)
const TW_QUERIES = { /* ... 제공된 TW_QUERIES 객체 ... */ }; // 생략, 원본 그대로
const REDDIT_EP = { /* ... 제공된 REDDIT_EP 객체 ... */ };
const YT_REGIONS = { /* ... 제공된 YT_REGIONS 객체 ... */ };
const RSS_FEEDS = { /* ... 제공된 RSS_FEEDS 객체 ... */ };

// -------------------------------
// 공통 유틸
// -------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

const domainFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
};

const minutesSince = (iso) => {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 99999;
  return Math.max(0, (Date.now() - date.getTime()) / 60000);
};

const freshness = (ageMin) => Math.exp(-ageMin / CONFIG.RANK_TAU_MIN);

const deduplicate = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = sha256((item.title || '') + (item.url || ''));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const filterRecent = (items, hours = 12) => items.filter((item) => minutesSince(item.publishedAt) <= hours * 60);

// -------------------------------
// NewsService
// -------------------------------
class NewsService {
  /**
   * @param {Object} opts - 옵션
   * @param {Object} opts.logger - 로거 (기본: console)
   */
  constructor(opts = {}) {
    this.logger = opts.logger || console;
    this.redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.xApi = axios.create({ baseURL: 'https://api.twitter.com/2', timeout: CONFIG.API_TIMEOUT, headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN || ''}` } });
    this.redditApi = axios.create({ baseURL: 'https://oauth.reddit.com', timeout: CONFIG.API_TIMEOUT, headers: { Authorization: `Bearer ${process.env.REDDIT_TOKEN || ''}`, 'User-Agent': process.env.REDDIT_USER_AGENT || 'emark-buzz/1.0' } });
    this.youtubeApi = axios.create({ baseURL: 'https://www.googleapis.com/youtube/v3', timeout: CONFIG.API_TIMEOUT });
    this.rssParser = new Parser();
  }

  // 소스별 캐시 헬퍼 (재시도 1회 포함)
  async getCachedOrFetch(key, fetchFn, ttl) {
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
    let data;
    try {
      data = await fetchFn();
    } catch (err) {
      this.logger.warn('Fetch fail, retrying once', err.message);
      try {
        data = await fetchFn(); // 간단 재시도
      } catch (retryErr) {
        this.logger.error('Retry failed', retryErr.message);
        data = [];
      }
    }
    await this.redis.set(key, JSON.stringify(data), 'EX', ttl).catch((err) => this.logger.error('Redis set error', err));
    return data;
  }

  /**
   * 섹션 빠른 가져오기
   * @param {string} section - 섹션 이름
   * @param {number} page - 페이지 번호 (기본: 1)
   * @param {number} limit - 페이지당 항목 수 (기본: FAST.FIRST_BATCH)
   */
  async getSectionFast(section = 'buzz', page = 1, limit = CONFIG.FAST.FIRST_BATCH) {
    if (!CONFIG.SECTIONS.includes(section)) throw new Error('Invalid section');
    const key = `${section}_fast_${page}_${limit}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);

    const twQueries = TW_QUERIES[section] || [];
    const redditEps = REDDIT_EP[section] || [];
    const rssFeeds = RSS_FEEDS[section] || [];
    const ytRegions = YT_REGIONS[section] || [];

    const phase1Tasks = [
      ...twQueries.slice(0, 2).map((q) => this.fetchFromXRecent({ query: q })),
      ...redditEps.slice(0, 2).map((r) => this.fetchFromRedditAPI(r)),
      ...rssFeeds.slice(0, 2).map((r) => this.fetchFromRSS(r.url)),
    ];
    const phase1Results = await Promise.allSettled(phase1Tasks.map((task) => Promise.race([task, new Promise((_, rej) => setTimeout(() => rej('timeout'), CONFIG.FAST.PHASE1_MS))])));
    const firstItems = phase1Results.filter((res) => res.status === 'fulfilled').flatMap((res) => res.value || []);

    const ranked = this.rankAndSort(section, deduplicate(filterRecent(firstItems))).slice((page - 1) * limit, page * limit);
    const initial = { section, articles: ranked, total: ranked.length, partial: true, timestamp: new Date().toISOString() };
    await this.redis.set(key, JSON.stringify(initial), 'EX', CONFIG.FAST.TTL_FAST).catch((err) => this.logger.error('Redis set error', err));

    (async () => {
      const phase2Tasks = [
        ...ytRegions.map((y) => this.fetchFromYouTubeTrending(y)),
        ...rssFeeds.slice(2).map((r) => this.fetchFromRSS(r.url)),
        ...twQueries.slice(2).map((q) => this.fetchFromXRecent({ query: q })),
      ];
      const phase2Results = await Promise.allSettled(phase2Tasks.map((task) => Promise.race([task, new Promise((_, rej) => setTimeout(() => rej('timeout'), CONFIG.FAST.PHASE2_MS))])));
      const extraItems = phase2Results.filter((res) => res.status === 'fulfilled').flatMap((res) => res.value || []);

      const merged = deduplicate(filterRecent([...firstItems, ...extraItems]));
      const fullRanked = this.rankAndSort(section, merged).slice(0, CONFIG.FAST.FULL_MAX);
      await this.redis.set(key, JSON.stringify({ section, articles: fullRanked, total: fullRanked.length, partial: false, timestamp: new Date().toISOString() }), 'EX', CONFIG.FAST.TTL_FULL).catch((err) => this.logger.error('Redis set error', err));
    })();

    return initial;
  }

  /**
   * 섹션 전체 가져오기
   * @param {string} section - 섹션 이름
   * @param {number} page - 페이지 번호 (기본: 1)
   * @param {number} limit - 페이지당 항목 수 (기본: FAST.FULL_MAX)
   */
  async getSectionFull(section = 'buzz', page = 1, limit = CONFIG.FAST.FULL_MAX) {
    if (!CONFIG.SECTIONS.includes(section)) throw new Error('Invalid section');
    const key = `${section}_full_${page}_${limit}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);

    const twQueries = TW_QUERIES[section] || [];
    const redditEps = REDDIT_EP[section] || [];
    const ytRegions = YT_REGIONS[section] || [];
    const rssFeeds = RSS_FEEDS[section] || [];

    const tasks = [
      ...twQueries.map((q) => this.fetchFromXRecent({ query: q })),
      ...redditEps.map((r) => this.fetchFromRedditAPI(r)),
      ...ytRegions.map((y) => this.fetchFromYouTubeTrending(y)),
      ...rssFeeds.map((r) => this.fetchFromRSS(r.url)),
    ];
    const settled = await Promise.allSettled(tasks);
    const rawItems = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value || []);
    const ranked = this.rankAndSort(section, deduplicate(filterRecent(rawItems))).slice((page - 1) * limit, page * limit);
    const payload = { section, articles: ranked, total: ranked.length, partial: false, timestamp: new Date().toISOString() };
    await this.redis.set(key, JSON.stringify(payload), 'EX', CONFIG.FAST.TTL_FULL).catch((err) => this.logger.error('Redis set error', err));
    return payload;
  }

  // Fetchers (캐싱 적용)
  async fetchFromXRecent({ query, max_results = 50 }) {
    const cacheKey = `x_${sha256(query)}_${max_results}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      const params = { query, max_results: Math.min(max_results, 100), 'tweet.fields': 'created_at,public_metrics,lang', 'expansions': 'author_id', 'user.fields': 'username,public_metrics' };
      const { data } = await this.xApi.get('/tweets/search/recent', { params });
      const users = (data?.includes?.users || []).reduce((map, user) => { map[user.id] = user; return map; }, {});
      return (data?.data || []).map((tweet) => {
        const metrics = tweet.public_metrics || {};
        const author = users[tweet.author_id] || {};
        return this.normalizeItem({
          title: (tweet.text || '').replace(/\n+/g, ' ').slice(0, 220),
          url: `https://x.com/i/web/status/${tweet.id}`,
          source: 'X', lang: tweet.lang || 'und', publishedAt: tweet.created_at,
          reactions: (metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0) + (metrics.quote_count || 0),
          followers: author.public_metrics?.followers_count || 0,
          domain: 'x.com', _srcType: 'x'
        });
      });
    }, CONFIG.FAST.TTL_FULL);
  }

  async fetchFromRedditAPI({ path = '/r/all/new', limit = 100 }) {
    const cacheKey = `reddit_${path}_${limit}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      const { data } = await this.redditApi.get(`${path}?limit=${Math.min(limit, 100)}`);
      return (data?.data?.children || []).map((post) => {
        const postData = post.data || {};
        return this.normalizeItem({
          title: postData.title, url: `https://reddit.com${postData.permalink}`,
          source: 'Reddit', lang: 'en',
          publishedAt: new Date((postData.created_utc || 0) * 1000).toISOString(),
          reactions: (postData.ups || 0) + (postData.num_comments || 0),
          followers: postData.subreddit_subscribers || 0,
          domain: 'reddit.com', _srcType: 'reddit'
        });
      });
    }, CONFIG.FAST.TTL_FULL);
  }

  async fetchFromYouTubeTrending({ regionCode = 'US', maxResults = 30 }) {
    const cacheKey = `yt_${regionCode}_${maxResults}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      const params = { part: 'snippet,statistics', chart: 'mostPopular', regionCode, maxResults: Math.min(maxResults, 50), key: process.env.YOUTUBE_API_KEY };
      const { data } = await this.youtubeApi.get('/videos', { params });
      return (data?.items || []).filter((video) => CONFIG.YOUTUBE_CHANNEL_WHITELIST.has(video.snippet?.channelId)).map((video) => {
        const snippet = video.snippet || {};
        const stats = video.statistics || {};
        return this.normalizeItem({
          title: snippet.title, url: `https://youtube.com/watch?v=${video.id}`,
          source: 'YouTube', lang: (snippet.defaultAudioLanguage || snippet.defaultLanguage || 'und').slice(0, 2),
          publishedAt: snippet.publishedAt,
          reactions: (+stats.viewCount || 0) + (+stats.likeCount || 0) + (+stats.commentCount || 0),
          followers: 0, domain: 'youtube.com', _srcType: 'yt'
        });
      });
    }, CONFIG.FAST.TTL_FULL);
  }

  async fetchFromRSS(url) {
    const cacheKey = `rss_${sha256(url)}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      const feed = await this.rssParser.parseURL(url);
      return (feed.items || []).map((feedItem) => this.normalizeItem({
        title: feedItem.title || '', url: feedItem.link || '', source: 'RSS', lang: 'und',
        publishedAt: feedItem.isoDate || feedItem.pubDate || new Date().toISOString(),
        reactions: 0, followers: 0, domain: domainFromUrl(feedItem.link || ''), _srcType: 'rss', trust: 0.8
      }));
    }, CONFIG.FAST.TTL_FULL);
  }

  // Normalize + Rank
  normalizeItem(item) {
    const lang = (item.lang || 'und').slice(0, 2);
    const eng = (item.reactions || 0) / Math.max(1, (item.followers || 0) + CONFIG.BETA);
    const ageMin = minutesSince(item.publishedAt);
    const vel = (item.reactions || 0) / Math.max(1, ageMin); // 가속도: reactions per minute
    return { ...item, lang, eng, vel };
  }

  rankAndSort(section, items) {
    const rankedItems = [];
    const domainCounts = {};
    const weights = SECTION_WEIGHTS[section] || SECTION_WEIGHTS.buzz;
    const localePrefs = { korea: 'ko', japan: 'ja' }; // 섹션별 로케일 우선
    for (const item of items) {
      const domain = item.domain || 'unknown';
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      const divp = Math.min(1, CONFIG.DIVERSITY_PENALTY_BASE * Math.max(0, domainCounts[domain] - 2));
      const ageMin = minutesSince(item.publishedAt);
      const fresh = freshness(ageMin);
      const trustBase = CONFIG.SOURCE_WEIGHTS[domain] ?? 0.5;
      const trust = Math.min(1, (item.trust ?? trustBase));
      const localeMatch = (localePrefs[section] ? item.lang === localePrefs[section] : ['ko', 'ja', 'en'].includes(item.lang)) ? 1 : 0;
      const score = 
        weights.f * fresh +
        weights.v * (item.vel || 0) +
        weights.e * (item.eng || 0) +
        weights.s * trust -
        weights.d * divp +
        weights.l * localeMatch;
      rankedItems.push({ ...item, _score: score, _fresh: fresh, _ageMin: ageMin, _trust: trust, _divp: divp, localeMatch });
    }
    return rankedItems.sort((a, b) => b._score - a._score || a._ageMin - b._ageMin || b._trust - a._trust);
  }
}

module.exports = NewsService;

// app.js (강화)
const express = require('express');
const NewsService = require('./newsService');
const app = express();
app.use(cors()); // CORS 활성화
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(8080, () => console.log('News API ready'));