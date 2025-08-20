const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');
const aiService = require('./aiservice');

class NewsService {
    constructor() {
        this.parser = new Parser({ timeout: 5000 });
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
                { url: 'https://feeds.ign.com/ign/all', name: 'IGN' }
            ],
            japan: [
                { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', name: 'NHK' }
            ],
            business: [
                { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business' }
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

    // 카테고리별 태그 생성
    generateTags(title, description, source) {
        const tags = [];
        const content = (title + ' ' + description).toLowerCase();
        
        // 키워드 기반 태그 생성
        if (content.includes('ukraine') || content.includes('russia')) tags.push('국제정치');
        if (content.includes('china') || content.includes('india')) tags.push('아시아');
        if (content.includes('trump') || content.includes('biden')) tags.push('미국정치');
        if (content.includes('climate') || content.includes('environment')) tags.push('환경');
        if (content.includes('tech') || content.includes('ai') || content.includes('technology')) tags.push('기술');
        if (content.includes('economy') || content.includes('market')) tags.push('경제');
        if (content.includes('health') || content.includes('covid')) tags.push('건강');
        
        // 소스별 기본 태그
        if (source === 'BBC') tags.push('BBC');
        if (source === 'CNN') tags.push('CNN');
        if (source === 'JTBC') tags.push('국내');
        if (source === 'TechCrunch') tags.push('테크');
        
        return tags.length > 0 ? tags : ['일반'];
    }

    // 기사 중요도 평점 계산
    calculateRating(title, description, source) {
        let rating = 3; // 기본 평점
        const content = (title + ' ' + description).toLowerCase();
        
        // 중요 키워드가 있으면 평점 상승
        if (content.includes('breaking') || content.includes('urgent')) rating += 1;
        if (content.includes('exclusive') || content.includes('special')) rating += 0.5;
        if (content.includes('crisis') || content.includes('emergency')) rating += 0.5;
        
        // 소스별 가중치
        if (source === 'BBC' || source === 'CNN') rating += 0.3;
        
        return Math.min(5, Math.max(1, Math.round(rating * 10) / 10));
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
                const feed = await this.parser.parseURL(source.url);
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
                        // AI 번역 및 요약 (병렬 처리)
                        const [translatedTitle, translatedDesc, summaryPts, detailedSummary] = await Promise.all([
                            aiService.translateToKorean(title),
                            aiService.translateToKorean(description),
                            aiService.generateSummaryPoints(description),
                            aiService.generateDetailedSummary({ title, content: description })
                        ]);
                        
                        titleKo = translatedTitle || title;
                        descriptionKo = translatedDesc || description;
                        summaryPoints = summaryPts || ['요약 정보를 생성할 수 없습니다.'];
                        aiDetailedSummary = detailedSummary || '상세 요약을 생성할 수 없습니다.';
                        originalTextKo = translatedDesc || description;
                        
                    } catch (aiError) {
                        logger.warn(`AI processing failed for article: ${title.substring(0, 50)}...`, aiError.message);
                        // AI 실패 시 fallback
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
                        rating: this.calculateRating(title, description, source.name),
                        tags: this.generateTags(title, description, source.name),
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

