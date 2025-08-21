const axios = require('axios');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
    this.rateLimiter = {
      tokens: 10,
      maxTokens: 10,
      lastRefill: Date.now(),
      refillRate: 60000 // 1분에 한 번 토큰 리필
    };
  }

  // 레이트 리미터 체크
  _checkRateLimit() {
    const now = Date.now();
    const timePassed = now - this.rateLimiter.lastRefill;
    
    // 토큰 리필
    if (timePassed > this.rateLimiter.refillRate) {
      this.rateLimiter.tokens = this.rateLimiter.maxTokens;
      this.rateLimiter.lastRefill = now;
    }
    
    // 토큰 사용 가능 여부 확인
    if (this.rateLimiter.tokens > 0) {
      this.rateLimiter.tokens--;
      
      // 토큰이 적으면 경고 로그
      if (this.rateLimiter.tokens < 3) {
        logger.warn('Rate limit approaching', { 
          remainingTokens: this.rateLimiter.tokens,
          nextRefill: new Date(this.rateLimiter.lastRefill + this.rateLimiter.refillRate)
        });
      }
      
      return true;
    }
    
    logger.error('Rate limit exceeded', {
      nextRefill: new Date(this.rateLimiter.lastRefill + this.rateLimiter.refillRate)
    });
    return false;
  }

  // 지수 백오프 구현
  async _withBackoff(fn, retries = 3, initialDelay = 1000) {
    let delay = initialDelay;
    let attempt = 0;
    
    while (attempt < retries) {
      try {
        return await fn();
      } catch (error) {
        attempt++;
        if (attempt >= retries) throw error;
        
        // 지수 백오프 + 약간의 랜덤성
        delay = delay * 2 + Math.random() * 1000;
        logger.warn(`Retry attempt ${attempt} after ${delay}ms`, { error: error.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async translateToKorean(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    
    // 언어 감지
    const language = this.detectLanguage(text);
    
    // 이미 한국어인 경우 그대로 반환
    if (language === 'ko') return text;
    
    // 캐시 확인
    const cacheKey = `translate:${text.substring(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 레이트 리밋 체크
    if (!this._checkRateLimit()) {
      return text; // 레이트 리밋 초과 시 원본 반환
    }
    
    try {
      // 간단한 번역 구현 (실제로는 OpenAI API 등을 사용)
      const translated = await this._withBackoff(async () => {
        // 실제 API 호출 대신 간단한 번역 시뮬레이션
        // 영어 -> 한국어 기본 단어 매핑
        const dictionary = {
          'hello': '안녕하세요',
          'world': '세계',
          'news': '뉴스',
          'today': '오늘',
          'important': '중요한',
          'breaking': '속보',
          'update': '업데이트',
          'report': '보고서',
          'analysis': '분석',
          'economy': '경제',
          'politics': '정치',
          'technology': '기술',
          'science': '과학',
          'health': '건강',
          'sports': '스포츠',
          'entertainment': '엔터테인먼트'
        };
        
        // 간단한 단어 치환 (실제 번역이 아님)
        let result = text.toLowerCase();
        Object.keys(dictionary).forEach(word => {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          result = result.replace(regex, dictionary[word]);
        });
        
        return result;
      }, retries);
      
      // 캐시에 저장
      this.cache.set(cacheKey, translated);
      return translated;
      
    } catch (error) {
      logger.error('Translation failed', { error: error.message });
      return text; // 오류 시 원본 반환
    }
  }

  async summarizeArticle(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    
    // 캐시 확인
    const cacheKey = `summarize:${text.substring(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 레이트 리밋 체크
    if (!this._checkRateLimit()) {
      return text.substring(0, 100) + (text.length > 100 ? '...' : ''); // 레이트 리밋 초과 시 간단 요약
    }
    
    try {
      // 간단한 요약 구현
      const summary = await this._withBackoff(async () => {
        // 실제 API 호출 대신 간단한 요약 시뮬레이션
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        if (sentences.length <= 2) {
          return text; // 문장이 적으면 그대로 반환
        }
        
        // 첫 문장과 마지막 문장 조합
        return sentences[0] + '. ' + sentences[Math.floor(sentences.length / 2)] + '.';
      }, retries);
      
      // 캐시에 저장
      this.cache.set(cacheKey, summary);
      return summary;
      
    } catch (error) {
      logger.error('Summarization failed', { error: error.message });
      return text.substring(0, 100) + (text.length > 100 ? '...' : ''); // 오류 시 간단 요약
    }
  }

  async generateSummaryPoints(text, points = 3, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return [];
    
    // 캐시 확인
    const cacheKey = `summaryPoints:${text.substring(0, 50)}:${points}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 레이트 리밋 체크
    if (!this._checkRateLimit()) {
      return ['요약 포인트를 생성할 수 없습니다.']; // 레이트 리밋 초과 시 기본 메시지
    }
    
    try {
      // 간단한 요약 포인트 구현
      const summaryPoints = await this._withBackoff(async () => {
        // 실제 API 호출 대신 간단한 요약 포인트 시뮬레이션
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        if (sentences.length <= points) {
          return sentences.map(s => s.trim() + '.');
        }
        
        // 텍스트를 균등하게 나누어 포인트 추출
        const result = [];
        const step = Math.floor(sentences.length / points);
        
        for (let i = 0; i < points && i * step < sentences.length; i++) {
          result.push(sentences[i * step].trim() + '.');
        }
        
        return result;
      }, retries);
      
      // 캐시에 저장
      this.cache.set(cacheKey, summaryPoints);
      return summaryPoints;
      
    } catch (error) {
      logger.error('Summary points generation failed', { error: error.message });
      return ['요약 포인트를 생성할 수 없습니다.']; // 오류 시 기본 메시지
    }
  }

  async generateDetailedSummary(article, retries = 2) {
    const text = typeof article === 'string' ? article : (article.content || article.description || '');
    const title = typeof article === 'string' ? '' : (article.title || '');
    
    if ((!text || text.trim().length === 0) && (!title || title.trim().length === 0)) return '';
    
    // 캐시 확인
    const cacheKey = `detailedSummary:${(title + text).substring(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // 레이트 리밋 체크
    if (!this._checkRateLimit()) {
      return text.substring(0, 150) + (text.length > 150 ? '...' : ''); // 레이트 리밋 초과 시 간단 요약
    }
    
    try {
      // 간단한 상세 요약 구현
      const detailedSummary = await this._withBackoff(async () => {
        // 실제 API 호출 대신 간단한 상세 요약 시뮬레이션
        if (title) {
          return `${title}: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`;
        } else {
          return text.substring(0, 250) + (text.length > 250 ? '...' : '');
        }
      }, retries);
      
      // 캐시에 저장
      this.cache.set(cacheKey, detailedSummary);
      return detailedSummary;
      
    } catch (error) {
      logger.error('Detailed summary generation failed', { error: error.message });
      return text.substring(0, 150) + (text.length > 150 ? '...' : ''); // 오류 시 간단 요약
    }
  }

  detectLanguage(text) {
    if (!text) return 'unknown';
    
    // 한국어 감지
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    if (koreanRegex.test(text)) return 'ko';
    
    // 일본어 감지
    const japaneseRegex = /[ひらがなカタカナ漢字]/;
    if (japaneseRegex.test(text)) return 'ja';
    
    // 중국어 감지
    const chineseRegex = /[\u4e00-\u9fff]/;
    if (chineseRegex.test(text)) return 'zh';
    
    // 기본값은 영어
    return 'en';
  }

  // Health check method
  getStatus() {
    return {
      hasOpenAI: !!this.openaiApiKey,
      cacheSize: this.cache.size,
      rateLimit: {
        tokens: this.rateLimiter.tokens,
        maxTokens: this.rateLimiter.maxTokens,
        nextRefill: new Date(this.rateLimiter.lastRefill + this.rateLimiter.refillRate)
      },
      status: 'active'
    };
  }

  // Clear cache method
  clearCache() {
    this.cache.clear();
    logger.info('AI service cache cleared');
  }
}

module.exports = new AIService();

