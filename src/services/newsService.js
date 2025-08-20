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
                    { type: 'newsapi', params: { category: 'general', country: 'us' } },
                    { type: 'gnews', params: { category: 'world', lang: 'en' } }
                ],
                rss: [
                    // 영미권 메이저
                    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC', lang: 'en' },
                    { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN', lang: 'en' },
                    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', name: 'New York Times', lang: 'en' },
                    { url: 'https://www.reuters.com/pf/feeds/world.xml', name: 'Reuters World', lang: 'en' },
                    { url: 'https://abcnews.go.com/abcnews/internationalheadlines/rss', name: 'ABC News', lang: 'en' },
                    { url: 'https://www.theguardian.com/world/rss', name: 'The Guardian', lang: 'en' },
                    { url: 'https://feeds.washingtonpost.com/rss/world', name: 'Washington Post', lang: 'en' },
                    { url: 'https://feeds.npr.org/1004/rss.xml', name: 'NPR World', lang: 'en' },
                    
                    // 통신사 및 글로벌
                    { url: 'https://feeds.apnews.com/rss/apf-intlnews', name: 'Associated Press', lang: 'en' },
                    { url: 'https://www.bloomberg.com/politics/feeds/site.xml', name: 'Bloomberg Politics', lang: 'en' },
                    { url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews', name: 'Wall Street Journal', lang: 'en' },
                    { url: 'https://www.ft.com/world?format=rss', name: 'Financial Times', lang: 'en' },
                    { url: 'https://www.economist.com/international/rss.xml', name: 'The Economist', lang: 'en' },
                    
                    // 국제 다언어
                    { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', lang: 'en' },
                    { url: 'https://rss.dw.com/rdf/rss-en-world', name: 'Deutsche Welle', lang: 'en' },
                    { url: 'https://www.france24.com/en/rss', name: 'France 24', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/euronews/en/world', name: 'Euronews', lang: 'en' },
                    
                    // 아시아-태평양
                    { url: 'https://www.scmp.com/rss/4/feed', name: 'South China Morning Post', lang: 'en' },
                    { url: 'https://www.japantimes.co.jp/feed/', name: 'Japan Times', lang: 'en' },
                    { url: 'https://en.yna.co.kr/RSS/news.xml', name: 'Yonhap News', lang: 'en' },
                    
                    // 추가 신뢰할 수 있는 소스들
                    { url: 'https://feeds.skynews.com/feeds/rss/world.xml', name: 'Sky News', lang: 'en' },
                    { url: 'https://feeds.reuters.com/reuters/topNews', name: 'Reuters Top News', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/time/world', name: 'TIME World', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/newsweek/world', name: 'Newsweek World', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/usnews/world', name: 'US News World', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/cbsnews/world', name: 'CBS News World', lang: 'en' },
                    { url: 'https://feeds.nbcnews.com/nbcnews/public/world', name: 'NBC News World', lang: 'en' },
                    { url: 'https://feeds.foxnews.com/foxnews/world', name: 'Fox News World', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/independent/world', name: 'The Independent', lang: 'en' },
                    { url: 'https://feeds.feedburner.com/thetimes/world', name: 'The Times', lang: 'en' }
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
            } else if (apiSource.type === 'gnews') {
                fetchPromises.push(this.fetchFromGNewsAPI(apiSource.params));
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
    async fetchFromNewsAPI(params, language = 'en') {
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
            "yna.co.kr","koreaherald.com","koreatimes.co.kr"
        ];
        
        const DOMAIN_BLACKLIST = ["news.google.com","news.yahoo.com","flipboard.com"];
        
        const HOT_QUERIES = [
            // 지정학/분쟁/선거
            "war OR conflict","Ukraine OR Gaza OR Middle East","election OR parliament",
            "sanctions OR ceasefire","NATO OR UN Security Council",
            // 거시/시장
            "Federal Reserve OR interest rates OR inflation","oil prices OR OPEC","stock market OR selloff",
            "GDP OR recession","FX OR currency crisis",
            // 테크/산업
            "AI OR artificial intelligence OR semiconductor","data center OR cloud","electric vehicle OR battery",
            "chip export controls OR sanctions tech",
            // 보건/재난
            "outbreak OR pandemic OR WHO","earthquake OR typhoon OR wildfire OR heatwave",
            // 기업 이슈
            "recall OR antitrust OR lawsuit OR settlement","earnings OR guidance",
            // 동아시아(영문권 보도)
            "Korea OR Japan OR China summit","North Korea OR missile"
        ];

        const SOURCE_WEIGHTS = {
            "reuters.com":5,"apnews.com":5,"afp.com":4,"bloomberg.com":5,"wsj.com":5,"ft.com":5,"economist.com":5,
            "bbc.com":4,"cnn.com":3,"nytimes.com":5,"washingtonpost.com":4,"theguardian.com":4,
            "aljazeera.com":4,"dw.com":3,"spiegel.de":3,"lemonde.fr":4,"elpais.com":3,"scmp.com":4,
            "yna.co.kr":4,"koreaherald.com":3,"koreatimes.co.kr":3
        };

        try {
            const allArticles = [];
            const fromTime = new Date(Date.now() - HOURS_WINDOW * 60 * 60 * 1000).toISOString();
            const toTime = new Date().toISOString();
            
            // 다단계 수집 전략 (확장)
            const phases = [
                { queries: HOT_QUERIES.slice(0, 8), sortBy: "publishedAt", pages: 2 },  // 최신순으로 핫한 키워드 (페이지 2개)
                { queries: HOT_QUERIES.slice(8, 16), sortBy: "relevancy", pages: 2 },  // 관련성순으로 다른 키워드 (페이지 2개)
                { queries: HOT_QUERIES.slice(0, 8), sortBy: "popularity", pages: 1 },  // 인기순으로 핫한 키워드 재수집
                { queries: ["breaking news", "latest news", "world news"], sortBy: "publishedAt", pages: 3 } // 일반 뉴스 키워드
            ];

            for (const phase of phases) {
                if (allArticles.length >= TARGET_RESULTS) break;

                const promises = [];
                
                for (const query of phase.queries) {
                    for (let page = 1; page <= (phase.pages || 1); page++) {
                        promises.push((async () => {
                            try {
                                // /v2/everything 엔드포인트 사용 (더 많은 기사 확보)
                                const response = await this.newsApi.get('everything', {
                                    params: {
                                        q: query,
                                        language: language,
                                        from: fromTime,
                                        to: toTime,
                                        sortBy: phase.sortBy,
                                        pageSize: PAGE_SIZE,
                                        page: page,
                                        searchIn: "title,description,content",
                                        domains: DOMAIN_WHITELIST.join(","),
                                        excludeDomains: DOMAIN_BLACKLIST.join(",")
                                    }
                                });

                                return response.data.articles.map(item => ({
                                    ...this.normalizeArticle(item, 'NewsAPI', language),
                                    _query: query,
                                    _sortBy: phase.sortBy,
                                    _page: page,
                                    _sourceScore: this.calculateNewsAPIScore(item, SOURCE_WEIGHTS)
                                }));
                            } catch (error) {
                                logger.warn(`NewsAPI failed for query "${query}" page ${page}: ${error.message}`);
                                return [];
                            }
                        })());
                    }
                }

                const results = await Promise.allSettled(promises);
                results.forEach(result => {
                    if (result.status === 'fulfilled') {
                        allArticles.push(...result.value);
                    }
                });

                // 단계별로 잠시 대기 (API 제한 고려)
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // 중복 제거 (URL + 제목 기반)
            const uniqueArticles = this.deduplicateNewsAPIArticles(allArticles);
            
            // 최신성 필터 (24시간 이내로 완화)
            const recentArticles = this.filterRecentArticles(uniqueArticles, 24);
            
            // 클러스터링 (유사한 제목 군집화)
            const clusteredArticles = this.clusterSimilarArticles(recentArticles);
            
            // 스코어 기반 정렬 및 상위 60개 선택
            const topArticles = clusteredArticles
                .sort((a, b) => (b._sourceScore || 0) - (a._sourceScore || 0))
                .slice(0, TARGET_RESULTS);

            logger.info(`NewsAPI World: collected ${allArticles.length}, unique ${uniqueArticles.length}, recent ${recentArticles.length}, clustered ${clusteredArticles.length}, top ${topArticles.length}`);
            return topArticles;

        } catch (error) {
            logger.error(`NewsAPI fetch failed: ${error.message}`);
            return [];
        }
    }

    async fetchFromGNewsAPI(params) {
        if (!GNEWS_API_KEY) return [];
        
        try {
            const TARGET_RESULTS = 50;
            const HOURS_WINDOW = 12;
            const allArticles = [];
            
            // 고품질 핫토픽 키워드 (첨부 파일 기반)
            const HOT_QUERIES = [
                "war OR conflict","Ukraine OR Gaza OR Middle East","election OR parliament",
                "sanctions OR ceasefire","NATO OR UN Security Council",
                "Federal Reserve OR interest rates OR inflation","oil prices OR OPEC","stock market OR selloff",
                "GDP OR recession","FX OR currency crisis",
                "AI OR artificial intelligence OR semiconductor","data center OR cloud","electric vehicle OR battery",
                "outbreak OR pandemic OR WHO","earthquake OR typhoon OR wildfire OR heatwave",
                "recall OR antitrust OR lawsuit OR settlement","earnings OR guidance",
                "Korea OR Japan OR China summit","North Korea OR missile"
            ];
            
            const fromTime = new Date(Date.now() - HOURS_WINDOW * 60 * 60 * 1000).toISOString();
            const toTime = new Date().toISOString();
            
            // Phase 1: GNews Top Headlines (World)
            try {
                const response = await this.gnewsApi.get('top-headlines', {
                    params: {
                        category: params.category || 'world',
                        lang: params.lang || 'en',
                        max: 50,
                        apikey: GNEWS_API_KEY
                    }
                });
                
                if (response.data.articles) {
                    allArticles.push(...response.data.articles.map(item => ({
                        ...this.normalizeGNewsArticle(item),
                        _meta: { src: 'gnews-top', category: params.category }
                    })));
                }
            } catch (error) {
                logger.warn(`GNews top-headlines failed: ${error.message}`);
            }
            
            // Phase 2: GNews Search with hot queries (if not enough articles)
            if (allArticles.length < TARGET_RESULTS) {
                for (const query of HOT_QUERIES.slice(0, 8)) {
                    try {
                        const response = await this.gnewsApi.get('search', {
                            params: {
                                q: query,
                                lang: params.lang || 'en',
                                from: fromTime,
                                to: toTime,
                                sortby: 'publishedAt',
                                in: 'title,description',
                                max: 25,
                                apikey: GNEWS_API_KEY
                            }
                        });
                        
                        if (response.data.articles) {
                            allArticles.push(...response.data.articles.map(item => ({
                                ...this.normalizeGNewsArticle(item),
                                _meta: { src: 'gnews-search', query: query }
                            })));
                        }
                        
                        // Rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        if (allArticles.length >= TARGET_RESULTS) break;
                        
                    } catch (error) {
                        logger.warn(`GNews search failed for query "${query}": ${error.message}`);
                        // Rate limit 에러 시 더 긴 대기
                        if (error.response?.status === 429) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                }
            }
            
            // 중복 제거 및 스코어링
            const uniqueArticles = this.deduplicateGNewsArticles(allArticles);
            const scoredArticles = uniqueArticles.map(article => ({
                ...article,
                _sourceScore: this.calculateGNewsScore(article)
            }));
            
            // 고급 클러스터링 (첨부 파일 로직)
            const clusteredArticles = this.clusterSimilarGNewsArticles(scoredArticles);
            
            // 상위 결과 반환
            return clusteredArticles
                .sort((a, b) => (b._sourceScore || 0) - (a._sourceScore || 0))
                .slice(0, TARGET_RESULTS);
                
        } catch (error) {
            logger.error(`GNews API fetch failed: ${error.message}`);
            return [];
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

    calculateGNewsScore(article) {
        const title = (article.title || '');
        const description = (article.description || '');
        const content = `${title} ${description}`.toLowerCase();
        
        // 소스 가중치 (첨부 파일 기반)
        const SOURCE_WEIGHTS = {
            "reuters.com":5,"apnews.com":5,"afp.com":4,"bloomberg.com":5,"wsj.com":5,"ft.com":5,"economist.com":5,
            "bbc.com":4,"cnn.com":3,"nytimes.com":5,"washingtonpost.com":4,"theguardian.com":4,
            "aljazeera.com":4,"dw.com":3,"spiegel.de":3,"lemonde.fr":4,"elpais.com":3,"scmp.com":4,
            "yna.co.kr":4,"koreaherald.com":3,"koreatimes.co.kr":3
        };
        
        let score = 0;
        
        // 소스 가중치
        const host = this.getHost(article.url || '');
        for (const [domain, weight] of Object.entries(SOURCE_WEIGHTS)) {
            if (host.includes(domain)) {
                score += weight;
                break;
            }
        }
        
        // 영향도 키워드 (첨부 파일 기반)
        const IMPACT_KEYWORDS = [
            "war","conflict","sanction","missile","nuclear",
            "inflation","rate hike","rate cut","gdp","recession","default","bankruptcy",
            "ai","semiconductor","chip","export control","data center","battery","ev",
            "earthquake","typhoon","wildfire","outbreak","pandemic","recall","antitrust","lawsuit","settlement",
            "election","parliament","ceasefire","opec"
        ];
        
        for (const keyword of IMPACT_KEYWORDS) {
            if (content.includes(keyword)) {
                score += 2;
            }
        }
        
        // 제목 길이 보너스
        const titleLength = title.replace(/\s+/g, '').length;
        if (titleLength >= 28 && titleLength <= 110) {
            score += 1;
        }
        
        // 최신성 보너스
        if (article.publishedAt) {
            const hoursAgo = Math.abs(new Date() - new Date(article.publishedAt)) / (1000 * 60 * 60);
            if (hoursAgo <= 2) score += 2;
            else if (hoursAgo <= 6) score += 1;
        }
        
        return score;
    }

    deduplicateGNewsArticles(articles) {
        const seen = new Set();
        const unique = [];
        
        for (const article of articles) {
            const key = (article.url || '') + '||' + (article.title || '');
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(article);
            }
        }
        
        return unique;
    }

    clusterSimilarGNewsArticles(articles) {
        // Jaccard 유사도 기반 클러스터링 (첨부 파일 로직)
        const clusters = [];
        const SIMILARITY_THRESHOLD = 0.76;
        
        for (const article of articles) {
            let placed = false;
            
            for (const cluster of clusters) {
                if (this.calculateJaccardSimilarity(cluster.representative.title, article.title) >= SIMILARITY_THRESHOLD) {
                    cluster.items.push(article);
                    // 더 높은 스코어의 기사를 대표로 선택
                    if ((article._sourceScore || 0) > (cluster.representative._sourceScore || 0)) {
                        cluster.representative = article;
                    }
                    placed = true;
                    break;
                }
            }
            
            if (!placed) {
                clusters.push({
                    representative: article,
                    items: [article]
                });
            }
        }
        
        // 각 클러스터의 대표 기사만 반환
        return clusters.map(cluster => ({
            ...cluster.representative,
            _clusterSize: cluster.items.length
        }));
    }

    calculateJaccardSimilarity(title1, title2) {
        const tokenize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
        const tokens1 = new Set(tokenize(title1));
        const tokens2 = new Set(tokenize(title2));
        
        const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
        const union = new Set([...tokens1, ...tokens2]);
        
        return union.size ? intersection.size / union.size : 0;
    }

    calculateNewsAPIScore(item, sourceWeights) {
        const title = (item.title || "");
        const description = (item.description || "");
        const url = item.url || "";
        let score = 0;

        // 출처별 가중치 적용
        const host = this.getHost(url);
        for (const [source, weight] of Object.entries(sourceWeights)) {
            if (host.endsWith(source)) {
                score += weight;
                break;
            }
        }

        // 영향력 키워드 보너스
        const IMPACT_KEYWORDS = [
            "war","conflict","sanction","missile","nuclear",
            "inflation","rate hike","rate cut","gdp","recession","default","bankruptcy",
            "ai","semiconductor","chip","export control","data center","battery","ev",
            "earthquake","typhoon","wildfire","outbreak","pandemic","recall","antitrust","lawsuit","settlement",
            "election","parliament"
        ];

        const content = (title + " " + description).toLowerCase();
        for (const keyword of IMPACT_KEYWORDS) {
            if (content.includes(keyword)) {
                score += 2;
            }
        }

        // 제목 길이 보너스 (적절한 길이)
        const titleLength = title.replace(/\s+/g, "").length;
        if (titleLength >= 30 && titleLength <= 110) {
            score += 1;
        }

        // 최신성 보너스
        if (item.publishedAt) {
            const hoursAgo = Math.abs(new Date() - new Date(item.publishedAt)) / (1000 * 60 * 60);
            if (hoursAgo <= 2) score += 2;
            else if (hoursAgo <= 6) score += 1;
        }

        return score;
    }

    getHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    deduplicateNewsAPIArticles(articles) {
        const seen = new Set();
        const unique = [];
        
        for (const article of articles) {
            const key = (article.url || "") + "||" + (article.title || "");
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(article);
            }
        }
        
        return unique;
    }

    clusterSimilarArticles(articles) {
        // 간단한 클러스터링: 제목 유사도 기반 (임계값 완화)
        const clusters = [];
        const SIMILARITY_THRESHOLD = 0.85; // 0.76 → 0.85로 완화 (더 적은 제거)
        
        for (const article of articles) {
            let placed = false;
            
            for (const cluster of clusters) {
                if (this.calculateTitleSimilarity(cluster.representative.title, article.title) >= SIMILARITY_THRESHOLD) {
                    cluster.items.push(article);
                    // 더 높은 스코어의 기사를 대표로 선택
                    if ((article._sourceScore || 0) > (cluster.representative._sourceScore || 0)) {
                        cluster.representative = article;
                    }
                    placed = true;
                    break;
                }
            }
            
            if (!placed) {
                clusters.push({
                    representative: article,
                    items: [article]
                });
            }
        }
        
        // 각 클러스터의 대표 기사만 반환
        return clusters.map(cluster => ({
            ...cluster.representative,
            _clusterSize: cluster.items.length
        }));
    }

    calculateTitleSimilarity(title1, title2) {
        const tokenize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9가-힣\s]/g, " ").split(/\s+/).filter(w => w.length >= 2);
        const tokens1 = new Set(tokenize(title1));
        const tokens2 = new Set(tokenize(title2));
        
        const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
        const union = new Set([...tokens1, ...tokens2]);
        
        return union.size ? intersection.size / union.size : 0;
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
            
            // 최신성 필터 (RSS는 24시간, 네이버 API는 7일)
            const recentArticles = this.filterRecentArticles(uniqueArticles, 24);
            
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
                
                // 모든 아이템을 정규화한 후 최신성 필터 적용
                const allItems = feed.items.map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
                
                // 최신 24시간 이내 기사만 필터링
                const recentItems = this.filterRecentArticles(allItems, 24);
                
                // 최신 기사가 없으면 최근 3일 이내로 완화
                if (recentItems.length === 0) {
                    const relaxedItems = this.filterRecentArticles(allItems, 72);
                    return relaxedItems.slice(0, 15);
                }
                
                return recentItems.slice(0, 15);
                
            } catch (error) {
                logger.warn(`RSS fetch failed from ${source.name}: ${error.message}. Trying fallback if available.`);
                // Fallback: 대안 URL 시도 (e.g., Reuters 경우)
                if (source.name === 'Reuters World') {
                    try {
                        const fallbackUrl = 'https://www.reuters.com/rssFeed/worldNews'; // 또 다른 대안
                        const feed = await this.parser.parseURL(fallbackUrl);
                        const allItems = feed.items.map(item => this.normalizeArticle(item, 'RSS', source.lang, source.name));
                        const recentItems = this.filterRecentArticles(allItems, 24);
                        return recentItems.length > 0 ? recentItems.slice(0, 15) : this.filterRecentArticles(allItems, 72).slice(0, 15);
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