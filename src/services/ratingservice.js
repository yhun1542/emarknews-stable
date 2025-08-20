const logger = require('../utils/logger');

class RatingService {
  constructor() {
    this.urgentKeywords = [
      'breaking', 'urgent', 'alert', 'emergency', 'crisis', 'disaster',
      '긴급', '속보', '재난', '위기', '사고', '응급'
    ];
    
    this.importantKeywords = [
      'president', 'government', 'election', 'economy', 'market', 'policy',
      'war', 'peace', 'treaty', 'agreement', 'summit', 'conference',
      '대통령', '정부', '선거', '경제', '시장', '정책', '전쟁', '평화', '협정', '정상회담'
    ];
    
    this.techKeywords = [
      'ai', 'artificial intelligence', 'technology', 'innovation', 'startup',
      'cryptocurrency', 'blockchain', 'quantum', 'robotics', 'automation',
      '인공지능', '기술', '혁신', '스타트업', '암호화폐', '블록체인', '로봇', '자동화'
    ];
    
    this.businessKeywords = [
      'stock', 'market', 'investment', 'finance', 'economy', 'trade', 'company',
      'earnings', 'profit', 'revenue', 'merger', 'acquisition',
      '주식', '시장', '투자', '금융', '경제', '무역', '기업', '수익', '인수합병'
    ];
    
    this.buzzKeywords = [
      'viral', 'trending', 'celebrity', 'entertainment', 'social media',
      'meme', 'influencer', 'youtube', 'tiktok', 'instagram',
      '바이럴', '트렌드', '연예인', '엔터테인먼트', '소셜미디어', '인플루언서'
    ];
  }

  async calculateRating(article) {
    try {
      if (!article || !article.title) {
        return 3; // Default rating
      }

      let score = 3; // Base score
      const titleLower = article.title.toLowerCase();
      const descriptionLower = (article.description || '').toLowerCase();
      const combinedText = titleLower + ' ' + descriptionLower;

      // Urgency factor (+2)
      if (this.containsKeywords(combinedText, this.urgentKeywords)) {
        score += 2;
      }

      // Importance factor (+1)
      if (this.containsKeywords(combinedText, this.importantKeywords)) {
        score += 1;
      }

      // Recency bonus (newer articles get higher scores)
      const publishedDate = new Date(article.publishedAt);
      const now = new Date();
      const hoursAgo = (now - publishedDate) / (1000 * 60 * 60);
      
      if (hoursAgo < 1) {
        score += 1; // Very recent
      } else if (hoursAgo < 6) {
        score += 0.5; // Recent
      }

      // Source reliability factor
      const reliableSources = ['BBC', 'Reuters', 'AP News', 'CNN', '연합뉴스', 'KBS', 'MBC'];
      if (reliableSources.some(source => 
        (article.source || '').toLowerCase().includes(source.toLowerCase())
      )) {
        score += 0.5;
      }

      // Content quality factor
      const descriptionLength = (article.description || '').length;
      if (descriptionLength > 200) {
        score += 0.3; // Detailed description
      }

      // Ensure score is within 1-5 range
      score = Math.min(5, Math.max(1, Math.round(score * 2) / 2));
      
      return score;

    } catch (error) {
      logger.warn('Rating calculation failed:', error.message);
      return 3;
    }
  }

  async generateTags(article) {
    try {
      if (!article || !article.title) {
        return ['일반'];
      }

      const tags = [];
      const titleLower = article.title.toLowerCase();
      const descriptionLower = (article.description || '').toLowerCase();
      const combinedText = titleLower + ' ' + descriptionLower;

      // Urgency tags
      if (this.containsKeywords(combinedText, this.urgentKeywords)) {
        tags.push('긴급');
      }

      // Importance tags
      if (this.containsKeywords(combinedText, this.importantKeywords)) {
        tags.push('중요');
      }

      // Category tags
      if (this.containsKeywords(combinedText, this.techKeywords)) {
        tags.push('테크');
      }

      if (this.containsKeywords(combinedText, this.businessKeywords)) {
        tags.push('경제');
      }

      if (this.containsKeywords(combinedText, this.buzzKeywords)) {
        tags.push('바이럴');
      }

      // Recency tags
      const publishedDate = new Date(article.publishedAt);
      const now = new Date();
      const hoursAgo = (now - publishedDate) / (1000 * 60 * 60);
      
      if (hoursAgo < 2) {
        tags.push('Hot');
      }

      // Geographic tags
      if (this.containsKeywords(combinedText, ['korea', 'korean', '한국', '서울', 'seoul'])) {
        tags.push('한국');
      }

      if (this.containsKeywords(combinedText, ['japan', 'japanese', '일본', '도쿄', 'tokyo'])) {
        tags.push('일본');
      }

      if (this.containsKeywords(combinedText, ['china', 'chinese', '중국', '베이징', 'beijing'])) {
        tags.push('중국');
      }

      if (this.containsKeywords(combinedText, ['usa', 'america', 'american', '미국', '워싱턴', 'washington'])) {
        tags.push('미국');
      }

      if (this.containsKeywords(combinedText, ['europe', 'european', '유럽', 'eu'])) {
        tags.push('유럽');
      }

      // Special event tags
      if (this.containsKeywords(combinedText, ['election', 'vote', '선거', '투표'])) {
        tags.push('선거');
      }

      if (this.containsKeywords(combinedText, ['climate', 'environment', '기후', '환경'])) {
        tags.push('환경');
      }

      if (this.containsKeywords(combinedText, ['covid', 'pandemic', 'virus', '코로나', '바이러스'])) {
        tags.push('보건');
      }

      if (this.containsKeywords(combinedText, ['sports', 'olympic', '스포츠', '올림픽'])) {
        tags.push('스포츠');
      }

      // Rating-based tags
      const rating = await this.calculateRating(article);
      if (rating >= 4.5) {
        tags.push('주목');
      }

      // Default tag if no specific tags found
      if (tags.length === 0) {
        tags.push('일반');
      }

      // Remove duplicates and limit to 4 tags
      return [...new Set(tags)].slice(0, 4);

    } catch (error) {
      logger.warn('Tag generation failed:', error.message);
      return ['일반'];
    }
  }

  containsKeywords(text, keywords) {
    return keywords.some(keyword => 
      text.includes(keyword.toLowerCase())
    );
  }

  // Advanced rating calculation based on multiple factors
  async calculateAdvancedRating(article) {
    try {
      let totalScore = 0;
      let factorCount = 0;

      // 1. Content Quality Score (0-1)
      const contentScore = this.calculateContentQuality(article);
      totalScore += contentScore;
      factorCount++;

      // 2. Urgency Score (0-1)
      const urgencyScore = this.calculateUrgency(article);
      totalScore += urgencyScore;
      factorCount++;

      // 3. Source Reliability Score (0-1)
      const sourceScore = this.calculateSourceReliability(article);
      totalScore += sourceScore;
      factorCount++;

      // 4. Recency Score (0-1)
      const recencyScore = this.calculateRecency(article);
      totalScore += recencyScore;
      factorCount++;

      // 5. Engagement Potential Score (0-1)
      const engagementScore = this.calculateEngagementPotential(article);
      totalScore += engagementScore;
      factorCount++;

      // Calculate average and convert to 1-5 scale
      const averageScore = totalScore / factorCount;
      const rating = 1 + (averageScore * 4); // Convert 0-1 to 1-5

      return Math.round(rating * 2) / 2; // Round to nearest 0.5

    } catch (error) {
      logger.warn('Advanced rating calculation failed:', error.message);
      return 3;
    }
  }

  calculateContentQuality(article) {
    let score = 0.5; // Base score

    const title = article.title || '';
    const description = article.description || '';

    // Title quality
    if (title.length > 20 && title.length < 100) {
      score += 0.1;
    }

    // Description quality
    if (description.length > 50) {
      score += 0.1;
    }
    if (description.length > 150) {
      score += 0.1;
    }

    // Has image
    if (article.urlToImage) {
      score += 0.1;
    }

    // Language specificity
    if (article.language === 'ko') {
      score += 0.1; // Bonus for Korean content
    }

    return Math.min(1, score);
  }

  calculateUrgency(article) {
    const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
    
    let score = 0.3; // Base score

    // High urgency keywords
    const highUrgencyWords = ['breaking', 'urgent', 'alert', '긴급', '속보'];
    if (this.containsKeywords(text, highUrgencyWords)) {
      score += 0.5;
    }

    // Medium urgency keywords
    const mediumUrgencyWords = ['update', 'develops', 'latest', '최신', '업데이트'];
    if (this.containsKeywords(text, mediumUrgencyWords)) {
      score += 0.3;
    }

    return Math.min(1, score);
  }

  calculateSourceReliability(article) {
    const source = (article.source || '').toLowerCase();
    
    // Tier 1 sources (most reliable)
    const tier1Sources = ['bbc', 'reuters', 'ap news', 'associated press', '연합뉴스'];
    if (tier1Sources.some(s => source.includes(s))) {
      return 1.0;
    }

    // Tier 2 sources (highly reliable)
    const tier2Sources = ['cnn', 'kbs', 'mbc', 'sbs', 'bloomberg', 'financial times'];
    if (tier2Sources.some(s => source.includes(s))) {
      return 0.8;
    }

    // Tier 3 sources (reliable)
    const tier3Sources = ['techcrunch', 'wired', 'forbes', 'wall street journal'];
    if (tier3Sources.some(s => source.includes(s))) {
      return 0.6;
    }

    return 0.4; // Default for unknown sources
  }

  calculateRecency(article) {
    try {
      const publishedDate = new Date(article.publishedAt);
      const now = new Date();
      const hoursAgo = (now - publishedDate) / (1000 * 60 * 60);

      if (hoursAgo < 1) return 1.0;      // Very fresh
      if (hoursAgo < 6) return 0.8;      // Fresh
      if (hoursAgo < 24) return 0.6;     // Recent
      if (hoursAgo < 72) return 0.4;     // Somewhat old
      return 0.2;                        // Old

    } catch (error) {
      return 0.3;
    }
  }

  calculateEngagementPotential(article) {
    const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
    
    let score = 0.3; // Base score

    // High engagement topics
    const highEngagementWords = [
      'scandal', 'controversy', 'viral', 'shocking', 'amazing',
      '논란', '충격', '놀라운', '화제', '스캔들'
    ];
    if (this.containsKeywords(text, highEngagementWords)) {
      score += 0.4;
    }

    // Popular topics
    const popularWords = [
      'celebrity', 'sports', 'technology', 'election', 'economy',
      '연예인', '스포츠', '기술', '선거', '경제'
    ];
    if (this.containsKeywords(text, popularWords)) {
      score += 0.3;
    }

    return Math.min(1, score);
  }

  // Get trending topics based on recent articles
  getTrendingTopics(articles) {
    const topicCount = new Map();
    
    articles.forEach(article => {
      const tags = this.generateTags(article);
      tags.forEach(tag => {
        topicCount.set(tag, (topicCount.get(tag) || 0) + 1);
      });
    });

    // Return top 10 trending topics
    return Array.from(topicCount.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));
  }

  // Get importance score for article prioritization
  getImportanceScore(article) {
    const rating = this.calculateRating(article);
    const tags = this.generateTags(article);
    const recency = this.calculateRecency(article);
    
    let importance = rating * 0.4; // Rating weight: 40%
    
    // Tag-based importance
    if (tags.includes('긴급')) importance += 2;
    if (tags.includes('중요')) importance += 1.5;
    if (tags.includes('Hot')) importance += 1;
    
    // Recency weight: 30%
    importance += recency * 1.5;
    
    return Math.min(10, importance);
  }

  // Batch process articles for performance
  async batchProcessArticles(articles) {
    const processed = [];
    
    for (let i = 0; i < articles.length; i += 10) {
      const batch = articles.slice(i, i + 10);
      
      const batchPromises = batch.map(async (article) => ({
        ...article,
        rating: await this.calculateRating(article),
        tags: await this.generateTags(article),
        importance: this.getImportanceScore(article)
      }));
      
      const batchResults = await Promise.all(batchPromises);
      processed.push(...batchResults);
      
      // Small delay between batches to avoid overwhelming the system
      if (i + 10 < articles.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return processed;
  }

  getStatus() {
    return {
      urgentKeywordsCount: this.urgentKeywords.length,
      importantKeywordsCount: this.importantKeywords.length,
      totalKeywords: this.urgentKeywords.length + 
                     this.importantKeywords.length + 
                     this.techKeywords.length + 
                     this.businessKeywords.length + 
                     this.buzzKeywords.length
    };
  }
}

module.exports = new RatingService();
