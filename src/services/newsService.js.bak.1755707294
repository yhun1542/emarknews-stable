const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');
const ratingService = require('./ratingservice');
const axios = require('axios'); // 추가: API 호출을 위한 라이브러리 (설치 필요 가정)

// 환경 변수나 config에서 API 키 로드 (보안을 위해 코드에 하드코딩하지 않음)
const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your-newsapi-key-here';
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || 'your-naver-client-id';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || 'your-naver-client-secret';
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || 'your-twitter-bearer-token';

class NewsService {
    constructor() {
        this.parser = new Parser({ 
            timeout: 10000,
            headers: {
                'User-Agent': 'EmarkNews/1.0 (News Aggregator)'
            }
        });
        this.sources = {
            world: {
                api: [
                    { type: 'newsapi', params: { category: 'general', country: 'us,gb' } }
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC' },
                    { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN' }
                ]
            },
            korea: {
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } }
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
                ]
            },
            kr: {
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } }
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
                ]
            },
            tech: {
                api: [
                    { type: 'newsapi', params: { category: 'technology' } }
                ],
                rss: [
                    { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch' },
                    { url: 'https://www.androidauthority.com/feed/', name: 'Android Authority' },
                    { url: 'https://9to5mac.com/feed/', name: '9to5Mac' },
                    { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' }
                ]
            },
            japan: {
                api: [
                    { type: 'newsapi', params: { country: 'jp', category: 'general' } }
                ],
                rss: [
                    { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK' }
                ]
            },
            business: {
                api: [
                    { type: 'newsapi', params: { category: 'business' } }
                ],
                rss: [
                    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets' },
                    { url: 'https://feeds.feedburner.com/wsj/xml/rss/3_7085.xml', name: 'WSJ Business' }
                ]
            },
            buzz: {
                api: [
                    { type: 'twitter', params: { trends: true } },
                    { type: 'newsapi', params: { category: 'entertainment' } }
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', name: 'BBC Entertainment' }
                ]
            }
        };
    }

    // 시간 차이 계산 함수 (기존 유지)
    formatTimeAgo(publishedAt) {
        const now = new Date();
        const published = new Date(publishedAt);
        const diffMs = now - published;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 60) {
            return `${diffMins}분 전`;
        } else if (diffHours < 24) {
            return `${diffHours}시간 전`;
        } else {
            return `${diffDays}일 전`;
        }
    }

    // 기사 중요도 평점 계산 (정교화: 더 많은 키워드, recency 보너스, 소스 가중치 세밀화)
    calculateRating(title, description, source, publishedAt) {
        let rating = 3; // 기본 평점
        const content = (title + ' ' + description).toLowerCase();
        
        // 중요 키워드 가중치 (확장: 더 많은 키워드 추가)
        if (content.includes('breaking') || content.includes('urgent') || content.includes('alert')) rating += 1.5;
        if (content.includes('exclusive') || content.includes('special') || content.includes('investigation')) rating += 1;
        if (content.includes('crisis') || content.includes('emergency') || content.includes('disaster') || content.includes('war') || content.includes('election')) rating += 1;
        if (content.includes('death') || content.includes('attack') || content.includes('protest')) rating += 0.5;
        
        // recency 보너스: 최신성 반영 (24시간 내 +1, 1시간 내 +0.5)
        const now = new Date();
        const published = new Date(publishedAt);
        const diffHours = (now - published) / (1000 * 60 * 60);
        if (diffHours < 1) rating += 0.5;
        if (diffHours < 24) rating += 1;
        
        // 소스별 가중치 (API 우선, 신뢰 소스 추가 가중)
        if (source.includes('API')) rating += 0.7; // API 소스 우선
        if (source === 'BBC' || source === 'CNN' || source === 'NHK' || source === 'Reuters' || source === 'AP') rating += 0.5;
        if (source === 'JTBC' || source === 'TechCrunch') rating += 0.3;
        
        return Math.min(5, Math.max(1, Math.round(rating * 10) / 10)); // 1~5 범위 내 소수점 1자리
    }

    // API 호출 헬퍼 함수들 (기존 유지)
    async fetchFromNewsAPI(params) {
        try {
            const response = await axios.get('https://newsapi.org/v2/top-headlines', {
                params: { ...params, apiKey: NEWS_API_KEY, pageSize: 20 }
            });
            return response.data.articles.map(article => ({
                title: article.title,
                description: article.description || '',
                url: article.url,
                urlToImage: article.urlToImage,
                publishedAt: article.publishedAt,
                source: article.source.name,
                content: article.content || article.description
            }));
        } catch (error) {
            logger.error('NewsAPI fetch failed:', error.message);
            return [];
        }
    }

    async fetchFromNaverAPI(params) {
        try {
            const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
                params: { ...params, sort: 'date' },
                headers: {
                    'X-Naver-Client-Id': NAVER_CLIENT_ID,
                    'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
                }
            });
            return response.data.items.map(item => ({
                title: item.title.replace(/<[^>]+>/g, ''),
                description: item.description.replace(/<[^>]+>/g, ''),
                url: item.link,
                urlToImage: null,
                publishedAt: item.pubDate,
                source: item.originallink.split('/')[2],
                content: item.description
            }));
        } catch (error) {
            logger.error('Naver API fetch failed:', error.message);
            return [];
        }
    }

    async fetchFromTwitterAPI(params) {
        try {
            const response = await axios.get('https://api.twitter.com/1.1/trends/place.json?id=1', {
                headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` }
            });
            const trends = response.data[0].trends.slice(0, 10);
            return trends.map(trend => ({
                title: trend.name,
                description: `Trending on X: ${trend.tweet_volume || 'N/A'} tweets`,
                url: trend.url,
                urlToImage: null,
                publishedAt: new Date().toISOString(),
                source: 'X',
                content: trend.name
            }));
        } catch (error) {
            logger.error('Twitter API fetch failed:', error.message);
            return [];
        }
    }

    async getNews(section = 'world', useCache = true) {
        const cacheKey = `news:${section}`;
        
        if (useCache) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const parsedCache = JSON.parse(cached);
                    return {
                        success: true,
                        data: {
                            articles: parsedCache.articles,
                            total: parsedCache.total,
                            timestamp: parsedCache.timestamp,
                            cached: true
                        }
                    };
                }
            } catch (error) {
                logger.warn('Cache read failed:', error.message);
            }
        }

        const sources = this.sources[section] || this.sources.world;
        const articles = [];

        // API 소스 먼저 병렬 fetching
        const apiFetches = sources.api?.map(async (apiSource) => {
            if (apiSource.type === 'newsapi') {
                return this.fetchFromNewsAPI(apiSource.params);
            } else if (apiSource.type === 'naver') {
                return this.fetchFromNaverAPI(apiSource.params);
            } else if (apiSource.type === 'twitter') {
                return this.fetchFromTwitterAPI(apiSource.params);
            }
            return [];
        }) || [];
        const apiResults = (await Promise.all(apiFetches)).flat();

        // RSS 소스 병렬 fetching
        const rssFetches = sources.rss?.map(async (source) => {
            try {
                const feed = await this.parser.parseURL(source.url);
                return feed.items.slice(0, 10).map(item => ({
                    title: item.title,
                    description: item.contentSnippet || item.content || '',
                    url: item.link,
                    urlToImage: item.enclosure?.url || null,
                    publishedAt: item.pubDate || new Date().toISOString(),
                    source: source.name,
                    content: item.content || item.contentSnippet
                }));
            } catch (error) {
                logger.error(`RSS fetch failed from ${source.name}:`, error.message);
                return [];
            }
        }) || [];
        const rssResults = (await Promise.all(rssFetches)).flat();

        // API + RSS 결합
        const rawArticles = [...apiResults, ...rssResults];

        // AI 처리 및 포맷팅 (병렬 처리)
        const processedArticles = await Promise.all(rawArticles.map(async (item) => {
            const title = item.title;
            const description = item.description || '';
            const publishedAt = item.publishedAt;
            const source = item.source;

            let titleKo = title;
            let descriptionKo = description;
            let summaryPoints = ['요약 정보를 생성 중입니다...'];
            let aiDetailedSummary = '';
            let originalTextKo = description;

            try {
                titleKo = await aiService.translateToKorean(title) || title;
                descriptionKo = await aiService.translateToKorean(description) || description;
                originalTextKo = descriptionKo;
                summaryPoints = await aiService.generateSummaryPoints(descriptionKo || description) || ['요약 정보를 생성할 수 없습니다.'];
                aiDetailedSummary = await aiService.generateDetailedSummary({ title: titleKo || title, content: descriptionKo || description }) || '상세 요약을 생성할 수 없습니다.';
            } catch (aiError) {
                logger.warn(`AI processing failed for article: ${title.substring(0, 50)}...`, aiError.message);
                titleKo = title;
                descriptionKo = description;
                originalTextKo = description;
                summaryPoints = ['AI 요약 서비스를 일시적으로 사용할 수 없습니다.'];
                aiDetailedSummary = '상세 요약을 생성할 수 없습니다.';
            }

            return {
                title,
                titleKo,
                description,
                descriptionKo,
                url: item.url,
                urlToImage: item.urlToImage,
                source,
                publishedAt,
                timeAgo: this.formatTimeAgo(publishedAt),
                rating: this.calculateRating(title, description, source, publishedAt), // publishedAt 전달 추가
                tags: await ratingService.generateTags(item),
                id: Buffer.from(item.url).toString('base64').slice(0, 12),
                aiDetailedSummary,
                originalTextKo,
                summaryPoints,
                hasTranslation: titleKo !== title || descriptionKo !== description,
                hasSummary: summaryPoints.length > 0,
                content: item.content,
                language: item.language || 'en',
                apiSource: source.includes('API') ? 'API' : 'RSS',
                section
            };
        }));

        // 중복 제거
        const uniqueArticles = processedArticles.filter((article, index, self) => 
            index === self.findIndex(a => a.url === article.url)
        );

        // ⭐ 스마트 정렬 (Hot Score 알고리즘) 적용 ⭐
        const smartSortedArticles = this.smartSort(uniqueArticles).slice(0, 50); // 최대 50개 제한

        const result = {
            articles: smartSortedArticles,
            total: uniqueArticles.length,
            timestamp: new Date().toISOString(),
            cached: false,
            sources: [...(sources.api?.map(s => s.type) || []), ...(sources.rss?.map(s => s.name) || [])]
        };

        if (useCache) {
            try {
                await redis.set(cacheKey, JSON.stringify(result), { EX: 600 });
            } catch (error) {
                logger.warn('Cache write failed:', error.message);
            }
        }

        return {
            success: true,
            data: result
        };
    }

    // --- ⭐ [신규 추가] 스마트 정렬 함수 (Hot Score 알고리즘) ⭐ ---
    /**
     * 기사를 중요도(Rating)와 최신성(Recency)을 조합하여 정렬합니다.
     * @param {Array} articles 정렬할 기사 배열
     * @returns {Array} 정렬된 기사 배열
     */
    smartSort(articles) {
        const now = new Date().getTime();
        
        // Gravity(중력) 설정: 값이 클수록 오래된 기사의 점수가 급격히 감소합니다. (1.5 ~ 1.8 권장)
        const gravity = 1.6; 

        const articlesWithScore = articles.map(article => {
            const publishedTime = new Date(article.publishedAt).getTime();

            // 유효하지 않은 날짜 처리
            if (isNaN(publishedTime)) {
                logger.warn(`Invalid date encountered for article: ${article.url}`);
                return { ...article, debugScore: 0 };
            }
            
            // 1. 기사 경과 시간 (시간 단위, 최소 0)
            const ageInHours = Math.max(0, (now - publishedTime) / (1000 * 60 * 60));
            
            // 2. 중요도 점수 (평점 기반, rating은 1~5점)
            // 평점(Rating)에 제곱을 하여 중요한 기사(Rating 4~5)의 가중치를 더 강조합니다.
            const rating = article.rating || 3; // 평점이 없으면 기본값 3
            const importanceScore = Math.pow(rating, 2); 

            // 3. Hot Score 계산 (Hacker News 알고리즘 응용)
            // Score = Importance / (Age + 2)^Gravity
            // 시간이 지날수록 분모가 커져서 전체 점수가 감소합니다.
            const score = importanceScore / Math.pow(ageInHours + 2, gravity);
            
            // 디버깅 및 확인을 위해 score를 기사 객체에 포함하여 반환 (프론트엔드에서 확인 가능)
            return { ...article, debugScore: parseFloat(score.toFixed(3)) };
        });

        // 최종 점수순으로 정렬 (내림차순)
        return articlesWithScore.sort((a, b) => b.debugScore - a.debugScore);
    }
}

module.exports = new NewsService();