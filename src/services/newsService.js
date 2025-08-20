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
                    { type: 'newsapi', params: { category: 'general', country: 'us,gb' } } // NewsAPI: 세계 뉴스 (US/GB 중심)
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC' },
                    { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN' }
                ]
            },
            korea: {
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } } // Naver API: 한국 뉴스 검색
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
                ]
            },
            kr: { // korea와 동일하게 매핑
                api: [
                    { type: 'naver', params: { query: '뉴스', display: 20 } }
                ],
                rss: [
                    { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
                ]
            },
            tech: {
                api: [
                    { type: 'newsapi', params: { category: 'technology' } } // NewsAPI: 테크 뉴스
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
                    { type: 'newsapi', params: { country: 'jp', category: 'general' } } // NewsAPI: 일본 뉴스 (country: jp)
                ],
                rss: [
                    { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK' }
                ]
            },
            business: {
                api: [
                    { type: 'newsapi', params: { category: 'business' } } // NewsAPI: 비즈니스 뉴스
                ],
                rss: [
                    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets' },
                    { url: 'https://feeds.feedburner.com/wsj/xml/rss/3_7085.xml', name: 'WSJ Business' }
                ]
            },
            buzz: {
                api: [
                    { type: 'twitter', params: { trends: true } }, // Twitter API: 트렌딩 토픽 (buzz 생성)
                    { type: 'newsapi', params: { category: 'entertainment' } } // NewsAPI: 엔터테인먼트 뉴스 추가
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

    // 기사 중요도 평점 계산 (기존 유지, API 소스에 가중치 추가)
    calculateRating(title, description, source) {
        let rating = 3;
        const content = (title + ' ' + description).toLowerCase();
        
        if (content.includes('breaking') || content.includes('urgent')) rating += 1;
        if (content.includes('exclusive') || content.includes('special')) rating += 0.5;
        if (content.includes('crisis') || content.includes('emergency')) rating += 0.5;
        
        // 소스별 가중치 (API 소스에 더 높은 가중치)
        if (source.includes('API')) rating += 0.5; // API 소스 우선
        if (source === 'BBC' || source === 'CNN' || source === 'NHK') rating += 0.3;
        
        return Math.min(5, Math.max(1, Math.round(rating * 10) / 10));
    }

    // API 호출 헬퍼 함수들
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
                title: item.title.replace(/<[^>]+>/g, ''), // HTML 태그 제거
                description: item.description.replace(/<[^>]+>/g, ''),
                url: item.link,
                urlToImage: null, // Naver는 기본 이미지 없음
                publishedAt: item.pubDate,
                source: item.originallink.split('/')[2] + ' (Naver API)', // 도메인 추출
                content: item.description
            }));
        } catch (error) {
            logger.error('Naver API fetch failed:', error.message);
            return [];
        }
    }

    async fetchFromTwitterAPI(params) {
        try {
            // 트렌딩 토픽 가져오기 (예: 전 세계 트렌드)
            const response = await axios.get('https://api.twitter.com/1.1/trends/place.json?id=1', {
                headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` }
            });
            const trends = response.data[0].trends.slice(0, 10); // 상위 10개 트렌드
            // 각 트렌드를 뉴스-like 아이템으로 변환 (buzz용)
            return trends.map(trend => ({
                title: trend.name,
                description: `Trending on X: ${trend.tweet_volume || 'N/A'} tweets`,
                url: trend.url,
                urlToImage: null,
                publishedAt: new Date().toISOString(),
                source: 'X (Twitter API)',
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

        // API 소스 먼저 병렬 fetching (주요 소스)
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

        // RSS 소스 병렬 fetching (보조 소스)
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

        // API + RSS 결합 (API 우선)
        const rawArticles = [...apiResults, ...rssResults];

        // AI 처리 및 포맷팅 (병렬로 처리하여 속도 최적화)
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
                rating: this.calculateRating(title, description, source),
                tags: await ratingService.generateTags(item),
                id: Buffer.from(item.url).toString('base64').slice(0, 12),
                aiDetailedSummary,
                originalTextKo,
                summaryPoints,
                hasTranslation: titleKo !== title || descriptionKo !== description,
                hasSummary: summaryPoints.length > 0,
                content: item.content,
                language: item.language || 'en', // API에서 언어 추가 가능
                apiSource: source.includes('API') ? 'API' : 'RSS',
                section
            };
        }));

        // 중복 제거 (URL 기반) 및 최신 순 정렬
        const uniqueArticles = processedArticles.filter((article, index, self) => 
            index === self.findIndex(a => a.url === article.url)
        ).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 50); // 최대 50개로 제한하여 로딩 최적화

        const result = {
            articles: uniqueArticles,
            total: uniqueArticles.length,
            timestamp: new Date().toISOString(),
            cached: false,
            sources: [...(sources.api?.map(s => s.type) || []), ...(sources.rss?.map(s => s.name) || [])]
        };

        if (useCache) {
            try {
                await redis.set(cacheKey, JSON.stringify(result), { EX: 600 }); // 10분 캐시
            } catch (error) {
                logger.warn('Cache write failed:', error.message);
            }
        }

        return {
            success: true,
            data: result
        };
    }
}

module.exports = new NewsService();