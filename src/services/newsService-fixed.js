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

    // AI 요약 생성 (Mock)
    generateAISummary(title, description) {
        const summaries = [
            "이 기사는 최근 국제 정세의 중요한 변화를 다루고 있으며, 향후 전개 상황에 대한 전문가들의 분석을 포함하고 있습니다.",
            "주요 인물들의 발언과 정책 변화가 미치는 영향을 종합적으로 분석한 내용입니다.",
            "현재 상황의 배경과 앞으로의 전망에 대해 다각도로 접근한 심층 분석 기사입니다.",
            "관련 분야 전문가들의 의견과 데이터를 바탕으로 한 객관적인 분석을 제공합니다.",
            "이번 사건이 가져올 파급효과와 관련 당사자들의 대응 방안을 상세히 다루고 있습니다."
        ];
        return summaries[Math.floor(Math.random() * summaries.length)];
    }

    // 한국어 번역 생성 (Mock)
    generateKoreanTranslation(title, description) {
        // 실제로는 번역 API를 사용해야 하지만, 여기서는 Mock 데이터 사용
        if (title.includes('Trump')) {
            return `트럼프 관련: ${description}`;
        } else if (title.includes('Ukraine')) {
            return `우크라이나 관련: ${description}`;
        } else if (title.includes('China')) {
            return `중국 관련: ${description}`;
        }
        return `번역된 내용: ${description}`;
    }

    // 요약 포인트 생성
    generateSummaryPoints(title, description) {
        const points = [
            "주요 사건의 배경과 현재 상황 분석",
            "관련 당사자들의 입장과 대응 방안",
            "전문가들의 향후 전망과 예측",
            "국제사회의 반응과 파급효과",
            "관련 정책 변화와 그 의미"
        ];
        
        // 랜덤하게 3-4개 포인트 선택
        const selectedPoints = [];
        const numPoints = Math.floor(Math.random() * 2) + 3; // 3-4개
        const shuffled = [...points].sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < numPoints && i < shuffled.length; i++) {
            selectedPoints.push(shuffled[i]);
        }
        
        return selectedPoints;
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
                const items = feed.items.slice(0, 15).map(item => {
                    const title = item.title;
                    const description = item.contentSnippet || item.content || '';
                    const publishedAt = item.pubDate || new Date().toISOString();
                    
                    return {
                        title,
                        titleKo: title, // 실제로는 번역 API 사용
                        description,
                        descriptionKo: description, // 실제로는 번역 API 사용
                        url: item.link,
                        urlToImage: item.enclosure?.url || null,
                        source: source.name,
                        publishedAt,
                        timeAgo: this.formatTimeAgo(publishedAt),
                        rating: this.calculateRating(title, description, source.name),
                        tags: this.generateTags(title, description, source.name),
                        id: Buffer.from(item.link).toString('base64').slice(0, 12),
                        // AI 기능 추가
                        aiDetailedSummary: this.generateAISummary(title, description),
                        originalTextKo: this.generateKoreanTranslation(title, description),
                        summaryPoints: this.generateSummaryPoints(title, description),
                        content: description,
                        language: 'en',
                        apiSource: 'RSS'
                    };
                });
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

