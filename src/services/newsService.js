const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');
const ratingService = require('./ratingservice');

class NewsService {
    constructor() {
        this.parser = new Parser({ 
            timeout: 10000,  // 10초로 증가
            headers: {
                'User-Agent': 'EmarkNews/1.0 (News Aggregator)'
            }
        });
        this.sources = {
            world: [
                { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC' },
                { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN' }
            ],
            korea: [
                { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
            ],
            kr: [
                { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
            ],
            tech: [
                { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch' },
                { url: 'https://www.androidauthority.com/feed/', name: 'Android Authority' },
                { url: 'https://9to5mac.com/feed/', name: '9to5Mac' },
                { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' }
            ],
            japan: [
                { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK' }
            ],
            business: [
                { url: 'https://feeds.bloomberg.com/markets/news.rss', name: 'Bloomberg Markets' },
                { url: 'https://feeds.feedburner.com/wsj/xml/rss/3_7085.xml', name: 'WSJ Business' }
            ],
            buzz: [
                { url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', name: 'BBC Entertainment' }
            ]
        };
    }

    // 시간 차이 계산 함수
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

    // 카테고리별 태그 생성 (ratingService 사용)
    async generateTags(title, description, source, publishedAt) {
        const article = {
            title,
            description,
            source,
            publishedAt
        };
        return await ratingService.generateTags(article);
    }

    // 기사 중요도 평점 계산 (ratingService 사용)
    async calculateRating(title, description, source, publishedAt) {
        const article = {
            title,
            description,
            source,
            publishedAt
        };
        return await ratingService.calculateRating(article);
    }

    async getNews(section = 'world', useCache = true) {
        const cacheKey = `news:${section}`;
        
        // Try cache first
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

        // Fetch fresh data
        const sources = this.sources[section] || this.sources.world;
        const articles = [];

        for (const source of sources) {
            try {
                logger.info(`Fetching news from ${source.name}: ${source.url}`);
                const feed = await this.parser.parseURL(source.url);
                
                if (!feed || !feed.items || feed.items.length === 0) {
                    logger.warn(`No items found in feed from ${source.name}`);
                    continue;
                }
                
                logger.info(`Found ${feed.items.length} items from ${source.name}`);
                
                const items = await Promise.all(feed.items.slice(0, 15).map(async (item) => {
                    const title = item.title;
                    const description = item.contentSnippet || item.content || '';
                    const publishedAt = item.pubDate || new Date().toISOString();
                    
                    // 실제 AI 서비스 호출
                    let titleKo = title;
                    let descriptionKo = description;
                    let summaryPoints = ['요약 정보를 생성 중입니다...'];
                    let aiDetailedSummary = '';
                    let originalTextKo = description;
                    
                    try {
                        // AI 번역 및 요약 (개별 처리로 안정성 향상)
                        // 제목 번역
                        try {
                            titleKo = await aiService.translateToKorean(title) || title;
                        } catch (error) {
                            logger.warn(`Title translation failed: ${error.message}`);
                            titleKo = title;
                        }
                        
                        // 설명 번역
                        try {
                            descriptionKo = await aiService.translateToKorean(description) || description;
                            originalTextKo = descriptionKo;
                        } catch (error) {
                            logger.warn(`Description translation failed: ${error.message}`);
                            descriptionKo = description;
                            originalTextKo = description;
                        }
                        
                        // 요약 포인트 생성
                        try {
                            summaryPoints = await aiService.generateSummaryPoints(descriptionKo || description) || ['요약 정보를 생성할 수 없습니다.'];
                        } catch (error) {
                            logger.warn(`Summary points generation failed: ${error.message}`);
                            summaryPoints = ['AI 요약 서비스를 일시적으로 사용할 수 없습니다.'];
                        }
                        
                        // 상세 요약 생성
                        try {
                            aiDetailedSummary = await aiService.generateDetailedSummary({ 
                                title: titleKo || title, 
                                content: descriptionKo || description 
                            }) || '상세 요약을 생성할 수 없습니다.';
                        } catch (error) {
                            logger.warn(`Detailed summary generation failed: ${error.message}`);
                            aiDetailedSummary = '상세 요약을 생성할 수 없습니다.';
                        }
                        
                    } catch (aiError) {
                        logger.warn(`AI processing failed for article: ${title.substring(0, 50)}...`, aiError.message);
                        // AI 실패 시 fallback
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
                        url: item.link,
                        urlToImage: item.enclosure?.url || null,
                        source: source.name,
                        publishedAt,
                        timeAgo: this.formatTimeAgo(publishedAt),
                        rating: await this.calculateRating(title, description, source.name, publishedAt),
                        tags: await this.generateTags(title, description, source.name, publishedAt),
                        id: Buffer.from(item.link).toString('base64').slice(0, 12),
                        // 실제 AI 기능
                        aiDetailedSummary,
                        originalTextKo,
                        summaryPoints,
                        hasTranslation: titleKo !== title || descriptionKo !== description,
                        hasSummary: summaryPoints.length > 0,
                        content: description,
                        language: 'en',
                        apiSource: 'RSS',
                        section
                    };
                }));
                articles.push(...items);
            } catch (error) {
                logger.error(`Failed to fetch from ${source.name}:`, error.message);
            }
        }

        // 중복 제거 및 정렬
        const uniqueArticles = articles.filter((article, index, self) => 
            index === self.findIndex(a => a.url === article.url)
        ).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        const result = {
            articles: uniqueArticles,
            total: uniqueArticles.length,
            timestamp: new Date().toISOString(),
            cached: false,
            sources: sources.map(s => s.name)
        };

        // Cache result
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
}

module.exports = new NewsService();

