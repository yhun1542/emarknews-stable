const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
  }

  async translateToKorean(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    
    // 언어 감지
    const language = this.detectLanguage(text);
    
    // 이미 한국어인 경우 그대로 반환
    if (language === 'ko') return text;
    
    // AI 번역 비활성화 - 원본 텍스트 반환
    return text;
  }

  async summarizeArticle(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    
    // AI 요약 비활성화 - 원본 텍스트의 첫 100자 반환
    return text.substring(0, 100) + (text.length > 100 ? '...' : '');
  }

  async generateSummaryPoints(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return [];
    
    // AI 요약 포인트 비활성화 - 빈 배열 반환
    return [];
  }

  async generateDetailedSummary(text, retries = 2) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return '';
    
    // AI 상세 요약 비활성화 - 원본 텍스트의 첫 150자 반환
    return text.substring(0, 150) + (text.length > 150 ? '...' : '');
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
      status: 'simplified_mode'
    };
  }

  // Clear cache method
  clearCache() {
    this.cache.clear();
    logger.info('AI service cache cleared');
  }
}

module.exports = new AIService();

