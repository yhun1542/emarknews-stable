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
                    { type: 'newsapi', params: { category: 'general', country: 'us' } }
                ],
                rss: [
                    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC', lang: 'en' },
                    { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN', lang: 'en' },
                    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'New York Times', lang: 'en' },
                    { url: 'https://www.reuters.com/pf/feeds/world.xml', name: 'Reuters World', lang: 'en' }, // 대안 공식 URL (검색 기반)
                    { url: 'https://abcnews.go.com/abcnews/internationalheadlines/rss', name: 'ABC News', lang: 'en' }
                ]
            },
            korea: {
                api: [
                    { type: 'naver', params: { query: '속보 OR 긴급 OR 최신뉴스', display: 30 } }
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
                    { type: 'naver', params: { query: '속보 OR 긴급 OR 최신뉴스', display: 30 } }
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
    async fetchFromNewsAPI(params, language = 'en') {
        if (!NEWS_API_KEY) return [];
        try {
            // pageSize를 50으로 증가하여 더 많은 기사 확보
            const enhancedParams = { ...params, pageSize: 50 };
            const response = await this.newsApi.get('top-headlines', { params: enhancedParams });
            return response.data.articles.map(item => this.normalizeArticle(item, 'NewsAPI', language));
        } catch (error) {
            logger.error(`NewsAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromNaverAPI(query, display = 30) {
        if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
        
        // 고급 키워드 세트 (첨부 파일 기반)
        const KEYWORDS = [
            // A. 속보·사건/사고
            "속보","긴급","특보","브레이킹","사건","사고","중대사고","참사","경보",
            // B. 보건·의학
            "건강","의학","감염병","전염병","메르스","코로나","수족구","독감","백신","치료제","신약","임상",
            // C. 정책·규제/국정
            "국회","정부","대통령","총리","장관","법안","개정안","시행령","입법예고","규제","완화","총선","대선",
            // D. 거시경제·시장
            "금리","기준금리","환율","물가","인플레이션","디스인플레이션","경기","성장률","GDP","증시","코스피","코스닥",
            // E. 금융리스크·기업
            "부도","워크아웃","유동성","채권단","리콜","적자","실적","어닝","컨센서스","M&A","상장","상폐","공모",
            // F. 산업·기술
            "반도체","AI","클라우드","데이터센터","배터리","전기차","로봇","바이오","원전","스마트팩토리","양자","사이버보안",
            // G. 외교·안보
            "한미","한중","한일","북한","핵","미사일","제재","군사훈련","정전","휴전","국방","NATO",
            // H. 사회·재난·기후
            "지진","태풍","호우","폭염","한파","산불","홍수","가뭄","붕괴","정전","재난",
            // I. 법원·사법
            "대법원","헌재","검찰","수사","영장","구속","무죄","유죄","판결","소송","과징금",
            // J. 교육·노동
            "대입","수능","의대정원","교원","파업","노사","임단협","최저임금","근로시간",
            // K. 부동산·인프라
            "부동산","주택","분양","전매","청약","용적률","재건축","재개발","교통","GTX","SOC","철도",
            // L. 에너지·환경
            "유가","가스","전력","탄소중립","RE100","배출권","수소","암모니아","원유","셰일"
        ];

        // 출처 가중치
        const SOURCE_WEIGHTS = {
            "yna.co.kr": 5, "yonhapnews": 5, "reuters": 5, "bloomberg": 5, "wsj": 5, 
            "apnews": 4, "afp": 4, "kbs": 4, "mbc": 4, "sbs": 4, "jtbc": 4, "ytn": 4,
            "hankyung": 4, "mk.co.kr": 4, "edaily": 3, "sedaily": 3, "chosun": 3, 
            "joongang": 3, "donga": 3
        };

        try {
            const allArticles = [];
            const MAX_KEYWORDS = 20; // 성능을 위해 상위 20개 키워드만 사용
            const selectedKeywords = KEYWORDS.slice(0, MAX_KEYWORDS);
            
            // 멀티 키워드로 병렬 수집
            const promises = selectedKeywords.map(async (keyword) => {
                try {
                    const response = await this.naverApi.get('news.json', { 
                        params: { 
                            query: keyword, 
                            display: Math.min(display, 100), // API 최대 100개
                            sort: 'date' 
                        } 
                    });
                    
                    return response.data.items.map(item => ({
                        ...this.normalizeArticle(item, 'NaverAPI', 'ko'),
                        _keyword: keyword,
                        _sourceScore: this.calculateSourceScore(item, SOURCE_WEIGHTS)
                    }));
                } catch (error) {
                    logger.warn(`Naver API failed for keyword "${keyword}": ${error.message}`);
                    return [];
                }
            });

            const results = await Promise.allSettled(promises);
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    allArticles.push(...result.value);
                }
            });

            // 중복 제거 (URL + 제목 기반)
            const uniqueArticles = this.deduplicateNaverArticles(allArticles);
            
            // 최신성 필터 (7일 이내로 완화)
            const recentArticles = this.filterRecentArticles(uniqueArticles, 24 * 7);
            
            // 스코어 기반 정렬 및 상위 30개 선택
            const topArticles = recentArticles
                .sort((a, b) => (b._sourceScore || 0) - (a._sourceScore || 0))
                .slice(0, 30);

            logger.info(`Naver API: collected ${allArticles.length}, unique ${uniqueArticles.length}, recent ${recentArticles.length}, top ${topArticles.length}`);
            return topArticles;

        } catch (error) {
            logger.error(`Naver API fetch failed: ${error.message}`);
            return [];
        }
    }

    calculateSourceScore(item, sourceWeights) {
        const title = (item.title || "").replace(/<[^>]+>/g, "");
        const link = item.originallink || item.link || "";
        let score = 0;

        // 출처별 가중치 적용
        for (const [source, weight] of Object.entries(sourceWeights)) {
            if (link.includes(source) || title.toLowerCase().includes(source)) {
                score += weight;
            }
        }

        // 제목 길이 보너스 (적절한 길이)
        const titleLength = title.replace(/\s+/g, "").length;
        if (titleLength >= 20 && titleLength <= 60) {
            score += 1;
        }

        // 물음표 과다 사용 패널티
        const questionMarks = (title.match(/\?/g) || []).length;
        if (questionMarks >= 2) {
            score -= 2;
        }

        return score;
    }

    deduplicateNaverArticles(articles) {
        const seen = new Set();
        const unique = [];
        
        for (const article of articles) {
            const key = (article.url || "") + "||" + (article.title || "").replace(/<[^>]+>/g, "");
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(article);
            }
        }
        
        return unique;
    }

    filterRecentArticles(articles, maxHours) {
        const cutoffTime = new Date(Date.now() - maxHours * 60 * 60 * 1000);
        
        return articles.filter(article => {
            if (!article.publishedAt) return false;
            
            let pubDate;
            if (typeof article.publishedAt === 'string') {
                // "2024.10.29" 형식 처리
                if (article.publishedAt.includes('.')) {
                    const parts = article.publishedAt.split('.');
                    pubDate = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    pubDate = new Date(article.publishedAt);
                }
            } else {
                pubDate = new Date(article.publishedAt);
            }
            
            return pubDate > cutoffTime;
        });
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
                // User-Agent 랜덤화로 블로킹 우회 시도
                this.parser.options.headers['User-Agent'] = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36`; // 브라우저 흉내
                const feed = await this.parser.parseURL(source.url);
                return feed.items.slice(0, 10).map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
            } catch (error) {
                logger.warn(`RSS fetch failed from ${source.name}: ${error.message}. Trying fallback if available.`);
                // Fallback: 대안 URL 시도 (e.g., Reuters 경우)
                if (source.name === 'Reuters World') {
                    try {
                        const fallbackUrl = 'https://www.reuters.com/rssFeed/worldNews'; // 또 다른 대안
                        const feed = await this.parser.parseURL(fallbackUrl);
                        return feed.items.slice(0, 10).map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
                    } catch (fallbackError) {
                        logger.error(`Fallback RSS failed for Reuters: ${fallbackError.message}`);
                        return [];
                    }
                }
                return [];
            }
        });
        const results = await Promise.allSettled(rssPromises); // Gemini 장점: 부분 실패 OK
        return results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value || []);
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