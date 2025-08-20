const axios = require('axios');
const Parser = require('rss-parser');
const logger = require('../utils/logger');
const { redis } = require('../config/database');

class NewsService {
    constructor() {
        this.parser = new Parser({ timeout: 5000 });
        this.sources = {
            world: [
                { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC' },
                { url: 'https://rss.cnn.com/rss/edition_world.rss', name: 'CNN' }
            ],
            kr: [
                { url: 'https://fs.jtbc.co.kr/RSS/newsflash.xml', name: 'JTBC' }
            ],
            tech: [
                { url: 'https://feeds.feedburner.com/TechCrunch/', name: 'TechCrunch' }
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

    async getNews(section = 'world') {
        const cacheKey = `news:${section}`;
        
        // Try cache first
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            logger.warn('Cache read failed:', error.message);
        }

        // Fetch fresh data
        const sources = this.sources[section] || this.sources.world;
        const articles = [];

        for (const source of sources) {
            try {
                const feed = await this.parser.parseURL(source.url);
                const items = feed.items.slice(0, 10).map(item => {
                    const title = item.title;
                    const description = item.contentSnippet || item.content || '';
                    const publishedAt = item.pubDate || new Date().toISOString();
                    
                    return {
                        title,
                        titleKo: title, // 한국어 제목이 없으면 원제목 사용
                        description,
                        url: item.link,
                        source: source.name,
                        publishedAt,
                        timeAgo: this.formatTimeAgo(publishedAt),
                        rating: this.calculateRating(title, description, source.name),
                        tags: this.generateTags(title, description, source.name),
                        id: Buffer.from(item.link).toString('base64').slice(0, 12) // 고유 ID 생성
                    };
                });
                articles.push(...items);
            } catch (error) {
                logger.error(`Failed to fetch from ${source.name}:`, error.message);
            }
        }

        const result = {
            section,
            articles,
            total: articles.length,
            timestamp: new Date().toISOString()
        };

        // Cache result
        try {
            await redis.set(cacheKey, JSON.stringify(result), { EX: 600 });
        } catch (error) {
            logger.warn('Cache write failed:', error.message);
        }

        return result;
    }
}

module.exports = new NewsService();
