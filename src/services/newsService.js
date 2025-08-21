const axios = require('axios');
const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');
const ratingService = require('./ratingservice');

// 환경 변수 로드
const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your-newsapi-key-here';
const GNEWS_API_KEY = process.env.GNEWS_API_KEY || 'your-gnews-api-key-here';
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
        this.gnewsApi = axios.create({
            baseURL: 'https://gnews.io/api/v4/',
            timeout: API_TIMEOUT
        });
        // 소스 정의 (Grok 장점: 섹션별 API/RSS 구조 + 다양한 RSS)
        this.sources = {
            world: {
                api: [
                    // NewsAPI 제거 - RSS만 사용하여 안정성 확보
                ],
                rss: [
                    // 순수 국제 뉴스 소스만 사용 (한국 뉴스 제외)
                    { url: 'https://feeds.bbci.co.uk/news/rss.xml', name: 'BBC News', lang: 'en' },
                    { url: 'https://rss.cnn.com/rss/edition.rss', name: 'CNN', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/reuters/topNews', name: 'Reuters', lang: 'en' },
                    { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', lang: 'en' }
                ]
            },
            korea: {
                api: [
                    { type: 'naver', params: { query: '속보 OR 긴급 OR 최신뉴스', display: 30 } }
                ],
                rss: [
                    // 확인된 작동 피드
                    { url: 'https://www.yna.co.kr/rss/news.xml', name: 'Yonhap News', lang: 'ko' },
                    { url: 'https://rss.cnn.com/rss/edition.rss', name: 'CNN International', lang: 'en' },
                    { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', name: 'BBC Asia', lang: 'en' },
                    { url: 'https://www.reuters.com/rssFeed/worldNews', name: 'Reuters World', lang: 'en' },
                    { url: 'https://rss.dw.com/rss/LK/asia', name: 'Deutsche Welle Asia', lang: 'en' },
                    // 대안 한국 관련 피드
                    { url: 'https://en.yna.co.kr/rss/topnews.xml', name: 'Yonhap English', lang: 'en' },
                    { url: 'https://www.koreaherald.com/common/rss_xml.php?ct=010000000000', name: 'Korea Herald', lang: 'en' },
                    { url: 'https://rss.joins.com/news.xml', name: 'JoongAng Daily', lang: 'ko' },
                    { url: 'https://rss.hankyung.com/news/economy.xml', name: 'Hankyung Economy', lang: 'ko' },
                    { url: 'https://rss.mk.co.kr/news.xml', name: 'Maeil Business', lang: 'ko' }
                ]
            },
            kr: { // korea와 동일
                api: [
                    { type: 'naver', params: { query: '속보 OR 긴급 OR 최신뉴스', display: 30 } }
                ],
                rss: [
                    // 확인된 작동 피드
                    { url: 'https://www.yna.co.kr/rss/news.xml', name: 'Yonhap News', lang: 'ko' },
                    { url: 'https://rss.cnn.com/rss/edition.rss', name: 'CNN International', lang: 'en' },
                    { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', name: 'BBC Asia', lang: 'en' },
                    { url: 'https://www.reuters.com/rssFeed/worldNews', name: 'Reuters World', lang: 'en' },
                    { url: 'https://rss.dw.com/rss/LK/asia', name: 'Deutsche Welle Asia', lang: 'en' },
                    // 대안 한국 관련 피드
                    { url: 'https://en.yna.co.kr/rss/topnews.xml', name: 'Yonhap English', lang: 'en' },
                    { url: 'https://www.koreaherald.com/common/rss_xml.php?ct=010000000000', name: 'Korea Herald', lang: 'en' },
                    { url: 'https://rss.joins.com/news.xml', name: 'JoongAng Daily', lang: 'ko' },
                    { url: 'https://rss.hankyung.com/news/economy.xml', name: 'Hankyung Economy', lang: 'ko' },
                    { url: 'https://rss.mk.co.kr/news.xml', name: 'Maeil Business', lang: 'ko' }
                ]
            },
            tech: {
                api: [
                    { type: 'newsapi', params: { category: 'technology' } },
                    { type: 'gnews', params: { category: 'technology', lang: 'en' } },
                    { type: 'gnews', params: { category: 'technology', lang: 'ja' } }
                ],
                rss: [
                    // 글로벌 테크 언론사
                    { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch', lang: 'en' },
                    { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', lang: 'en' },
                    { url: 'https://www.wired.com/feed/rss', name: 'Wired', lang: 'en' },
                    { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', lang: 'en' },
                    { url: 'https://www.androidauthority.com/feed/', name: 'Android Authority', lang: 'en' },
                    { url: 'https://9to5mac.com/feed/', name: '9to5Mac', lang: 'en' },
                    { url: 'https://9to5google.com/feed/', name: '9to5Google', lang: 'en' },
                    // 비즈니스 테크 언론사
                    { url: 'https://www.reuters.com/rssFeed/technologyNews', name: 'Reuters Tech', lang: 'en' },
                    { url: 'https://feeds.bloomberg.com/technology/news.rss', name: 'Bloomberg Tech', lang: 'en' },
                    { url: 'https://www.ft.com/rss/companies/technology', name: 'FT Technology', lang: 'en' },
                    // 아시아 테크
                    { url: 'https://www.nikkei.com/rss/technology.xml', name: 'Nikkei Tech', lang: 'ja' }
                ],
                // 테크 섹션 특화 설정
                keywords: [
                    "AI OR artificial intelligence OR genAI OR LLM",
                    "semiconductor OR chip OR foundry OR TSMC OR Samsung",
                    "data center OR cloud OR hyperscaler OR GPU OR accelerator",
                    "NVIDIA OR AMD OR Intel OR Apple silicon",
                    "cybersecurity OR data breach OR ransomware OR zero-day",
                    "quantum computing OR photonics",
                    "regulation tech OR antitrust tech OR export controls"
                ],
                sourceWeights: {
                    "reuters.com": 5, "bloomberg.com": 5, "ft.com": 5, "wsj.com": 5,
                    "theverge.com": 4, "techcrunch.com": 4, "wired.com": 4, "arstechnica.com": 4,
                    "androidauthority.com": 3, "9to5mac.com": 3, "9to5google.com": 3,
                    "nikkei.com": 4, "scmp.com": 3, "yna.co.kr": 3
                }
            },
            japan: {
                api: [
                    // API 제거 - 순수 일본 언론사 RSS만 사용
                ],
                rss: [
                    // 일본 주요 언론사만 (순수 일본 국내 뉴스)
                    { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK', lang: 'ja' },
                    { url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf', name: 'Asahi Shimbun', lang: 'ja' },
                    { url: 'https://www.yomiuri.co.jp/rss/news.xml', name: 'Yomiuri Shimbun', lang: 'ja' },
                    { url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss', name: 'Mainichi Shimbun', lang: 'ja' },
                    { url: 'https://www.nikkei.com/news/latest/feed/', name: 'Nikkei', lang: 'ja' },
                    { url: 'https://www.sankei.com/rss/news/main.xml', name: 'Sankei Shimbun', lang: 'ja' },
                    { url: 'https://www.japantimes.co.jp/feed/', name: 'Japan Times', lang: 'en' },
                    // 일본 전문 영문 뉴스만
                    { url: 'https://english.kyodonews.net/rss/news.xml', name: 'Kyodo News English', lang: 'en' }
                ],
                // 일본 국내 이슈 특화 키워드 (RSS 전용)
                keywords: [
                    "日本 OR Japan domestic OR 国内",
                    "岸田 OR 自民党 OR 立憲民主党 OR 政治",
                    "日銀 OR BOJ OR 円安 OR インフレ",
                    "トヨタ OR ホンダ OR ソニー OR 任天堂",
                    "地震 OR 台風 OR 災害 OR 福島",
                    "選挙 OR 国会 OR 内閣 OR 政権",
                    "経済 OR GDP OR 株価 OR 日経平均",
                    "コロナ OR ワクチン OR 医療 OR 厚労省"
                ],
                sourceWeights: {
                    "nhk.or.jp": 5, "nikkei.com": 5, "asahi.com": 4, "yomiuri.co.jp": 4, 
                    "mainichi.jp": 4, "sankei.com": 3, "japantimes.co.jp": 4,
                    "kyodonews.net": 4
                }
            },
            business: {
                api: [
                    { type: 'newsapi', params: { category: 'business' } },
                    { type: 'gnews', params: { category: 'business', lang: 'en' } },
                    { type: 'gnews', params: { category: 'business', lang: 'ko' } }
                ],
                rss: [
                    // 글로벌 금융 언론사
                    { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/wsj/xml/rss/3_7085.xml', name: 'WSJ Business', lang: 'en' },
                    { url: 'https://www.ft.com/rss/companies', name: 'Financial Times', lang: 'en' },
                    { url: 'https://www.economist.com/rss/business_rss.xml', name: 'The Economist', lang: 'en' },
                    { url: 'https://www.reuters.com/rssFeed/businessNews', name: 'Reuters Business', lang: 'en' },
                    { url: 'https://feeds.cnbc.com/cnbc/business', name: 'CNBC Business', lang: 'en' },
                    // 한국 비즈니스 언론사
                    { url: 'https://rss.hankyung.com/news/economy.xml', name: 'Hankyung Economy', lang: 'ko' },
                    { url: 'https://rss.mk.co.kr/news.xml', name: 'Maeil Business', lang: 'ko' },
                    { url: 'https://www.yna.co.kr/rss/economy.xml', name: 'Yonhap Economy', lang: 'ko' }
                ],
                // 비즈니스 섹션 특화 설정
                keywords: [
                    "earnings OR guidance OR outlook OR revenue OR profit",
                    "merger OR acquisition OR M&A OR takeover",
                    "Federal Reserve OR ECB OR BOE OR interest rates OR inflation",
                    "oil prices OR OPEC OR demand",
                    "stock market OR selloff OR rally OR S&P OR Nasdaq",
                    "FX OR currency crisis OR devaluation",
                    "antitrust OR lawsuit OR settlement OR fine",
                    "IPO OR listing OR delisting OR downgrade OR upgrade"
                ],
                sourceWeights: {
                    "reuters.com": 5, "bloomberg.com": 5, "ft.com": 5, "wsj.com": 5, "economist.com": 5,
                    "cnbc.com": 4, "marketwatch.com": 3, "nytimes.com": 4, "theguardian.com": 3,
                    "nikkei.com": 4, "yna.co.kr": 3, "hankyung.com": 4, "mk.co.kr": 3
                }
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
                fetchPromises.push(this.fetchFromNewsAPI(apiSource.params, 'en', sources.keywords, sources.sourceWeights));
            } else if (apiSource.type === 'gnews') {
                fetchPromises.push(this.fetchFromGNewsAPI(apiSource.params, sources.keywords, sources.sourceWeights));
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
        const processedArticles = await this.processArticlesWithAI(uniqueArticles.slice(0, 100), section);
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
    async fetchFromNewsAPI(params, language = 'en', sectionKeywords = null, sectionWeights = null) {
        if (!NEWS_API_KEY) return [];
        
        // 고급 세계뉴스 수집 시스템 (첨부 파일 기반)
        const TARGET_RESULTS = 80;      // 목표 확보 개수 (60→80으로 증가)
        const HOURS_WINDOW = 24;        // 최근 24시간 (12→24시간으로 완화)
        const PAGE_SIZE = 100;          // everything 최대 100
        
        const DOMAIN_WHITELIST = [
            // 국제·글로벌 메이저
            "reuters.com","apnews.com","afp.com","bloomberg.com","wsj.com","ft.com","economist.com",
            "bbc.com","cnn.com","nytimes.com","washingtonpost.com","theguardian.com",
            "aljazeera.com","dw.com","spiegel.de","lemonde.fr","elpais.com","scmp.com",
            // 한국 메이저(영문 포함)
            "yna.co.kr","koreaherald.com","koreatimes.co.kr","chosun.com","joins.com","hankyung.com",
            // 일본 메이저(영문 포함)
            "japantimes.co.jp","asahi.com","yomiuri.co.jp","nikkei.com","kyodonews.net",
            // 테크 메이저
            "techcrunch.com","theverge.com","wired.com","arstechnica.com","engadget.com",
            "zdnet.com","venturebeat.com","thenextweb.com","androidauthority.com","9to5mac.com",
            // 비즈니스 메이저
            "cnbc.com","marketwatch.com","businessinsider.com","fortune.com","forbes.com"
        ];
        
        try {
            // 1. 최신 뉴스 검색 (everything API)
            const fromDate = new Date();
            fromDate.setHours(fromDate.getHours() - HOURS_WINDOW);
            const fromDateStr = fromDate.toISOString().split('T')[0];
            
            // 2. 키워드 쿼리 구성 (섹션별 특화)
            let queryParts = [];
            
            // 섹션별 키워드 추가
            if (sectionKeywords && sectionKeywords.length > 0) {
                // 섹션 키워드 중 랜덤하게 2-3개 선택
                const selectedKeywords = sectionKeywords
                    .sort(() => 0.5 - Math.random())
                    .slice(0, Math.min(3, sectionKeywords.length));
                
                queryParts.push(`(${selectedKeywords.join(' OR ')})`);
            }
            
            // 3. 도메인 필터링
            const domains = DOMAIN_WHITELIST.join(',');
            
            // 4. API 호출 파라미터 구성
            const apiParams = {
                ...params,
                pageSize: PAGE_SIZE,
                page: 1,
                from: fromDateStr,
                domains: domains,
                language: language,
                sortBy: 'publishedAt'
            };
            
            // 키워드 쿼리가 있으면 추가
            if (queryParts.length > 0) {
                apiParams.q = queryParts.join(' AND ');
            }
            
            // 5. API 호출
            const response = await this.newsApi.get('everything', { params: apiParams });
            
            if (!response.data || !response.data.articles) {
                return [];
            }
            
            // 6. 응답 정규화
            return response.data.articles
                .map(article => this.normalizeArticle(article, 'NEWS_API', language))
                .filter(Boolean);
                
        } catch (error) {
            logger.warn(`NewsAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromGNewsAPI(params, sectionKeywords = null, sectionWeights = null) {
        if (!GNEWS_API_KEY) return [];
        
        try {
            // 1. 기본 파라미터 설정
            const apiParams = {
                ...params,
                apikey: GNEWS_API_KEY,
                max: 50
            };
            
            // 2. 키워드 쿼리 구성 (섹션별 특화)
            if (sectionKeywords && sectionKeywords.length > 0) {
                // 섹션 키워드 중 랜덤하게 1-2개 선택
                const selectedKeywords = sectionKeywords
                    .sort(() => 0.5 - Math.random())
                    .slice(0, Math.min(2, sectionKeywords.length));
                
                if (selectedKeywords.length > 0) {
                    apiParams.q = selectedKeywords.join(' OR ');
                }
            }
            
            // 3. API 호출
            const response = await this.gnewsApi.get('top-headlines', { params: apiParams });
            
            if (!response.data || !response.data.articles) {
                return [];
            }
            
            // 4. 응답 정규화
            return response.data.articles
                .map(article => this.normalizeArticle(article, 'GNEWS_API', params.lang || 'en'))
                .filter(Boolean);
                
        } catch (error) {
            logger.warn(`GNewsAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromNaverAPI(query, display = 30) {
        if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
        
        try {
            // 1. API 호출
            const response = await this.naverApi.get('news', { 
                params: { 
                    query, 
                    display, 
                    sort: 'date' 
                } 
            });
            
            if (!response.data || !response.data.items) {
                return [];
            }
            
            // 2. 응답 정규화
            return response.data.items
                .map(item => this.normalizeArticle(item, 'NAVER_API', 'ko'))
                .filter(Boolean);
                
        } catch (error) {
            logger.warn(`NaverAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromXAPI() {
        if (!X_BEARER_TOKEN) return [];
        
        try {
            // 1. 트렌드 API 호출 (미구현)
            // 현재 X API v2는 트렌드 엔드포인트를 제공하지 않음
            // 대신 최신 인기 트윗을 가져오는 방식으로 대체
            
            // 2. 빈 배열 반환 (실제 구현 시 제거)
            return [];
            
        } catch (error) {
            logger.warn(`X API fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromRSS(sources) {
        try {
            // 1. 모든 RSS 소스에 대해 병렬 요청
            const fetchPromises = sources.map(async source => {
                try {
                    const feed = await this.parser.parseURL(source.url);
                    
                    if (!feed || !feed.items) {
                        return [];
                    }
                    
                    // 2. 각 피드 항목 정규화
                    return feed.items
                        .slice(0, 30) // 최대 30개 항목만 사용
                        .map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name))
                        .filter(Boolean);
                        
                } catch (error) {
                    logger.warn(`RSS fetch failed for ${source.name}: ${error.message}`);
                    return [];
                }
            });
            
            // 3. 모든 결과 병합
            const results = await Promise.allSettled(fetchPromises);
            return results
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => result.value);
                
        } catch (error) {
            logger.warn(`RSS fetch failed: ${error.message}`);
            return [];
        }
    }

    // 정규화 함수 (Gemini 장점: 통합 정규화)
    normalizeArticle(item, apiSource, language = 'en', sourceName = null) {
        try {
            let title, description, url, urlToImage, publishedAt, source;
            
            switch (apiSource) {
                case 'NEWS_API':
                    title = item.title;
                    description = item.description || '';
                    url = item.url;
                    urlToImage = item.urlToImage;
                    publishedAt = item.publishedAt;
                    source = item.source?.name || 'News API';
                    break;
                case 'GNEWS_API':
                    title = item.title;
                    description = item.description || '';
                    url = item.url;
                    urlToImage = item.image;
                    publishedAt = item.publishedAt;
                    source = item.source?.name || 'GNews';
                    break;
                case 'NAVER_API':
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
                id: `${section}_${Buffer.from(article.url).toString('base64').slice(0, 12)}`,
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

    // 특정 ID의 기사 조회
    async getArticleById(section, id) {
        try {
            // 캐시에서 해당 섹션의 뉴스 데이터 가져오기
            const cacheKey = `news_v3:${section}`;
            const cached = await redis.get(cacheKey);
            
            if (cached) {
                const parsedCache = JSON.parse(cached);
                const articles = parsedCache.articles || [];
                
                // ID로 기사 찾기 (섹션 정보가 포함된 ID 또는 기존 ID 모두 처리)
                const article = articles.find(article => 
                    article.id === id || 
                    article.id === `${section}_${id.replace(`${section}_`, '')}` ||
                    `${section}_${article.id}` === id
                );
                
                if (article) {
                    return { success: true, data: article };
                }
            }
            
            // 캐시에 없으면 새로 데이터 가져오기
            const result = await this.getNews(section, false);
            
            if (result.success && result.data && result.data.articles) {
                // ID로 기사 찾기 (섹션 정보가 포함된 ID 또는 기존 ID 모두 처리)
                const article = result.data.articles.find(article => 
                    article.id === id || 
                    article.id === `${section}_${id.replace(`${section}_`, '')}` ||
                    `${section}_${article.id}` === id
                );
                
                if (article) {
                    return { success: true, data: article };
                }
            }
            
            // 기사를 찾지 못한 경우
            return { success: false, error: 'Article not found' };
        } catch (error) {
            logger.error(`Error fetching article by ID: ${error.message}`);
            return { success: false, error: 'Failed to fetch article' };
        }
    }
}

module.exports = NewsService;

