const Parser = require('rss-parser');
const axios = require('axios');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');
const ratingService = require('./ratingservice');

// 환경 변수 로드
const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your-newsapi-key-here';
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || 'your-naver-client-id';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'your-naver-client-secret';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || 'your-twitter-bearer-token';
const API_TIMEOUT = 8000; // API 호출 8초 타임아웃
const RSS_TIMEOUT = 5000; // RSS는 더 빠른 실패를 위해 5초 타임아웃

class NewsService {
    constructor() {
        this.parser = new Parser({
            timeout: RSS_TIMEOUT,
            headers: {
                'User-Agent': 'EmarkNews/2.0 (Advanced News Aggregator)'
            }
        });
        // Axios 인스턴스 설정 (Gemini 장점: 효율적 연결 관리)
        this.newsApi = axios.create({
            baseURL: 'https://newsapi.org/v2/',
            headers: NEWS_API_KEY ? { 'X-Api-Key': NEWS_API_KEY } : {},
            timeout: API_TIMEOUT
        });
        this.naverApi = axios.create({
            baseURL: 'https://openapi.naver.com/v1/search/',
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID || '',
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET || ''
            },
            timeout: API_TIMEOUT
        });
        this.xApi = axios.create({
            baseURL: 'https://api.twitter.com/2/',
            headers: X_BEARER_TOKEN ? { 'Authorization': `Bearer ${X_BEARER_TOKEN}` } : {},
            timeout: API_TIMEOUT
        });
        // 소스 정의 (Grok 장점: 섹션별 API/RSS 구조 + 다양한 RSS)
        this.sources = {
            world: {
                api: [
                    { type: 'newsapi', params: { category: 'general', country: 'us,gb' } }
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC', lang: 'en' },
                    { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN', lang: 'en' },
                    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'New York Times', lang: 'en' },
                    { url: 'https://www.reuters.com/arc/outboundfeeds/news-feed/?outputType=xml', name: 'Reuters', lang: 'en' }, // 유효 URL 수정
                    { url: 'https://abcnews.go.com/abcnews/internationalheadlines/rss', name: 'ABC News', lang: 'en' }
                ]
            },
            korea: {
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } }
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC', lang: 'ko' },
                    { url: 'https://en.yna.co.kr/rss/topnews.xml', name: 'Yonhap', lang: 'ko' },
                    { url: 'https://www.koreaherald.com/common/rss_xml.php?ct=010000000000', name: 'Korea Herald', lang: 'ko' },
                    { url: 'http://world.kbs.co.kr/rss/news.xml?lang=e', name: 'KBS World', lang: 'ko' },
                    { url: 'http://rss.hani.co.kr/rss/lead.xml', name: '한겨레', lang: 'ko' } // Gemini 추가
                ]
            },
            kr: { // korea와 동일
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } }
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC', lang: 'ko' },
                    { url: 'https://en.yna.co.kr/rss/topnews.xml', name: 'Yonhap', lang: 'ko' },
                    { url: 'https://www.koreaherald.com/common/rss_xml.php?ct=010000000000', name: 'Korea Herald', lang: 'ko' },
                    { url: 'http://world.kbs.co.kr/rss/news.xml?lang=e', name: 'KBS World', lang: 'ko' },
                    { url: 'http://rss.hani.co.kr/rss/lead.xml', name: '한겨레', lang: 'ko' }
                ]
            },
            tech: {
                api: [
                    { type: 'newsapi', params: { category: 'technology' } }
                ],
                rss: [
                    { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch', lang: 'en' },
                    { url: 'https://www.androidauthority.com/feed/', name: 'Android Authority', lang: 'en' },
                    { url: 'https://9to5mac.com/feed/', name: '9to5Mac', lang: 'en' },
                    { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', lang: 'en' },
                    { url: 'https://www.wired.com/feed/rss', name: 'Wired', lang: 'en' } // Gemini 추가
                ]
            },
            japan: {
                api: [
                    { type: 'newsapi', params: { country: 'jp', category: 'general' } }
                ],
                rss: [
                    { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK', lang: 'ja' }
                ]
            },
            business: {
                api: [
                    { type: 'newsapi', params: { category: 'business' } }
                ],
                rss: [
                    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/wsj/xml/rss/3_7085.xml', name: 'WSJ Business', lang: 'en' }
                ]
            },
            buzz: {
                api: [
                    { type: 'twitter', params: { trends: true } },
                    { type: 'newsapi', params: { category: 'entertainment' } }
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', name: 'BBC Entertainment', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch', lang: 'en' }, // Gemini
                    { url: 'https://www.wired.com/feed/rss', name: 'Wired', lang: 'en' } // Gemini
                ]
            }
        };
    }

    // 메인 로직 (Gemini 장점: allSettled + 캐시 버전)
    async getNews(section = 'world', useCache = true) {
        const cacheKey = `news_v3:${section}`;
        if (useCache) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    logger.info(`Cache hit for section: ${section}`);
                    const parsedCache = JSON.parse(cached);
                    return { success: true, data: { ...parsedCache, cached: true } };
                }
            } catch (error) {
                logger.warn('Cache read failed:', error.message);
            }
        }
        logger.info(`Fetching fresh data for section: ${section}`);
        const sources = this.sources[section] || this.sources.world;
        const fetchPromises = [];
        // API promises (Grok + Gemini 쿼리 다양화)
        sources.api.forEach(apiSource => {
            if (apiSource.type === 'newsapi') {
                fetchPromises.push(this.fetchFromNewsAPI(apiSource.params, 'en'));
            } else if (apiSource.type === 'naver') {
                fetchPromises.push(this.fetchFromNaverAPI(apiSource.params.query, apiSource.params.display));
            } else if (apiSource.type === 'twitter') {
                fetchPromises.push(this.fetchFromXAPI());
            }
        });
        // RSS promises (Grok 다양성 + Gemini allSettled)
        if (sources.rss.length > 0) {
            fetchPromises.push(this.fetchFromRSS(sources.rss));
        }
        const results = await Promise.allSettled(fetchPromises);
        const rawArticles = results
            .filter(result => result.status === 'fulfilled' && result.value && result.value.length > 0)
            .flatMap(result => result.value);
        const uniqueArticles = this.deduplicateAndSort(rawArticles);
        const processedArticles = await this.processArticlesWithAI(uniqueArticles.slice(0, 50), section);
        const finalResult = {
            articles: processedArticles,
            total: processedArticles.length,
            timestamp: new Date().toISOString(),
            cached: false,
            sources: [...(sources.api?.map(s => s.type) || []), ...(sources.rss?.map(s => s.name) || [])]
        };
        if (useCache && processedArticles.length > 0) {
            try {
                await redis.set(cacheKey, JSON.stringify(finalResult), { EX: 600 });
            } catch (error) {
                logger.warn('Cache write failed:', error.message);
            }
        }
        return { success: true, data: finalResult };
    }

    // Fetch 함수 (Gemini 장점: v2 X API + normalize)
    async fetchFromNewsAPI(params, language) {
        if (!NEWS_API_KEY) return [];
        try {
            const response = await this.newsApi.get('top-headlines', { params });
            return response.data.articles.map(item => this.normalizeArticle(item, 'NewsAPI', language));
        } catch (error) {
            logger.error(`NewsAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromNaverAPI(query, display = 20) {
        if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
        try {
            const response = await this.naverApi.get('news.json', { params: { query, display, sort: 'date' } });
            return response.data.items.map(item => this.normalizeArticle(item, 'NaverAPI', 'ko'));
        } catch (error) {
            logger.error(`Naver API fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromXAPI() {
        if (!X_BEARER_TOKEN) return [];
        try {
            const query = '(trending OR viral OR buzz) -is:retweet lang:en';
            const response = await this.xApi.get('tweets/search/recent', {
                params: {
                    query: query,
                    max_results: 30,
                    'tweet.fields': 'created_at,text',
                    'expansions': 'author_id',
                    'user.fields': 'name,username,profile_image_url'
                }
            });
            const users = response.data.includes?.users?.reduce((acc, user) => { acc[user.id] = user; return acc; }, {}) || {};
            return response.data.data.map(item => this.normalizeArticle({ ...item, user: users[item.author_id] }, 'X_API', 'en'));
        } catch (error) {
            logger.error(`X API fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromRSS(sources) {
        const rssPromises = sources.map(async (source) => {
            try {
                const feed = await this.parser.parseURL(source.url);
                return feed.items.slice(0, 10).map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
            } catch (error) {
                logger.warn(`RSS fetch failed from ${source.name}: ${error.message}`);
                return [];
            }
        });
        const results = await Promise.all(rssPromises);
        return results.flat();
    }

    // Normalize (Gemini 장점)
    normalizeArticle(item, apiSource, language, sourceName = null) {
        let title, description, url, urlToImage, publishedAt, source;
        try {
            switch (apiSource) {
                case 'NewsAPI':
                    title = item.title;
                    description = item.description || item.content || '';
                    url = item.url;
                    urlToImage = item.urlToImage;
                    publishedAt = item.publishedAt || new Date().toISOString();
                    source = item.source?.name || 'NewsAPI';
                    break;
                case 'NaverAPI':
                    title = this.stripHtml(item.title);
                    description = this.stripHtml(item.description);
                    url = item.originallink || item.link;
                    urlToImage = null;
                    publishedAt = item.pubDate || new Date().toISOString();
                    source = 'Naver News';
                    break;
                case 'X_API':
                    title = `Trending on X: ${item.text.substring(0, 80)}...`;
                    description = item.text;
                    source = `X (@${item.user?.username || 'unknown'})`;
                    url = `https://twitter.com/${item.user?.username || 'x'}/status/${item.id}`;
                    urlToImage = item.user?.profile_image_url?.replace('_normal', '') || null;
                    publishedAt = item.created_at || new Date().toISOString();
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
                    return null;
            }
            if (!title || !url) return null;
            return { title, description, content: description, url, urlToImage, source, publishedAt, apiSource, language };
        } catch (error) {
            logger.warn(`Normalization failed from ${apiSource}: ${error.message}`);
            return null;
        }
    }

    // 후처리 (Grok + Gemini)
    deduplicateAndSort(articles) {
        return articles
            .filter(article => article !== null)
            .filter((article, index, self) => index === self.findIndex(a => a.url === article.url))
            .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    // AI 처리 (Gemini 장점: 태스크 분리 + Grok 플래그)
    async processArticlesWithAI(articles, section) {
        return Promise.all(articles.map(async (article) => {
            let titleKo = article.title;
            let descriptionKo = article.description;
            let summaryPoints = ['요약 정보를 생성 중입니다...'];
            let aiDetailedSummary = '';
            let hasTranslation = false;
            const needsTranslation = article.language !== 'ko';
            const aiTasks = [];
            if (needsTranslation) {
                aiTasks.push(
                    aiService.translateToKorean(article.title).then(t => { if (t) { titleKo = t; hasTranslation = true; } }).catch(e => logger.warn(`Title translation failed: ${e.message}`)),
                    aiService.translateToKorean(article.description).then(d => { if (d) { descriptionKo = d; hasTranslation = true; } }).catch(e => logger.warn(`Description translation failed: ${e.message}`))
                );
            }
            await Promise.all(aiTasks);
            const contentForSummary = descriptionKo || article.description;
            const summaryTasks = [];
            summaryTasks.push(
                aiService.generateSummaryPoints(contentForSummary).then(points => { if (points) summaryPoints = points; }).catch(e => { logger.warn(`Summary points failed: ${e.message}`); summaryPoints = ['AI 요약 서비스를 일시적으로 사용할 수 없습니다.']; }),
                aiService.generateDetailedSummary({ title: titleKo || article.title, content: contentForSummary }).then(summary => { if (summary) aiDetailedSummary = summary; }).catch(e => { logger.warn(`Detailed summary failed: ${e.message}`); aiDetailedSummary = '상세 요약을 생성할 수 없습니다.'; })
            );
            await Promise.all(summaryTasks);
            return {
                ...article,
                titleKo,
                descriptionKo,
                originalTextKo: descriptionKo,
                timeAgo: this.formatTimeAgo(article.publishedAt),
                rating: await ratingService.calculateRating(article),
                tags: await ratingService.generateTags(article),
                id: Buffer.from(article.url).toString('base64').slice(0, 12),
                aiDetailedSummary,
                summaryPoints,
                hasTranslation,
                hasSummary: summaryPoints.length > 0 && !summaryPoints[0].includes('없습니다'),
                section
            };
        }));
    }

    // 유틸 (Gemini 장점: 한국어 강화 + stripHtml)
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

}

module.exports = new NewsService();