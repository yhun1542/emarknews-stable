const axios = require('axios');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
    this.requestCount = 0;
    this.maxRequestsPerMinute = 50;
    this.lastResetTime = Date.now();
  }

  async translateToKorean(text, retries = 2) {
    if (!text || text.trim().length === 0) return '';
    
    // Simple Korean detection
    if (this.isKorean(text)) return text;
    
    const cacheKey = `translate:${text.substring(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // Rate limiting
      if (!this.canMakeRequest()) {
        logger.warn('AI translation rate limit exceeded');
        return text; // Return original text if rate limited
      }

      let translated;
      
      if (this.openaiApiKey) {
        translated = await this.translateWithOpenAI(text);
      } else {
        // Fallback: Simple text processing for common English patterns
        translated = await this.basicTranslation(text);
      }

      // Cache the result
      this.cache.set(cacheKey, translated);
      
      // Limit cache size
      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return translated;

    } catch (error) {
      logger.warn('Translation failed:', error.message);
      
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.translateToKorean(text, retries - 1);
      }
      
      return text; // Return original text on failure
    }
  }

  async translateWithOpenAI(text) {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '당신은 뉴스 번역 전문가입니다. 영어 뉴스 제목과 요약문을 자연스럽고 정확한 한국어로 번역하세요. 뉴스의 톤과 중요성을 유지하면서 한국 독자가 이해하기 쉽게 번역해주세요.'
          },
          {
            role: 'user',
            content: `다음 텍스트를 한국어로 번역해주세요:\n\n${text}`
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      this.requestCount++;
      return response.data.choices[0].message.content.trim();

    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('OpenAI rate limit exceeded');
        throw new Error('Rate limit exceeded');
      }
      throw error;
    }
  }

  async basicTranslation(text) {
    // Very basic translation for common news terms
    const translations = {
      'Breaking News': '속보',
      'BREAKING': '속보',
      'UPDATE': '업데이트',
      'URGENT': '긴급',
      'President': '대통령',
      'Government': '정부',
      'Election': '선거',
      'Economy': '경제',
      'Technology': '기술',
      'Health': '건강',
      'Climate': '기후',
      'Ukraine': '우크라이나',
      'Russia': '러시아',
      'China': '중국',
      'Japan': '일본',
      'North Korea': '북한',
      'South Korea': '한국',
      'United States': '미국',
      'Europe': '유럽'
    };

    let translated = text;
    for (const [en, ko] of Object.entries(translations)) {
      translated = translated.replace(new RegExp(en, 'gi'), ko);
    }

    return translated;
  }

  async generateSummaryPoints(text, maxPoints = 3) {
    if (!text || text.trim().length === 0) return ['내용 없음'];

    try {
      if (this.openaiApiKey && this.canMakeRequest()) {
        const points = await this.generateSummaryWithOpenAI(text, maxPoints);
        if (points && points.length > 0) {
          return points;
        }
      }

      // Fallback: Extract key sentences
      return this.extractKeySentences(text, maxPoints);

    } catch (error) {
      logger.warn('Summary generation failed:', error.message);
      return this.extractKeySentences(text, maxPoints);
    }
  }

  async generateSummaryWithOpenAI(text, maxPoints) {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `당신은 뉴스 요약 전문가입니다. 주어진 뉴스 내용을 ${maxPoints}개의 핵심 포인트로 요약해주세요. 각 포인트는 한 줄로, 중요한 사실과 숫자를 포함해야 합니다.`
          },
          {
            role: 'user',
            content: `다음 뉴스를 ${maxPoints}개의 핵심 포인트로 요약해주세요:\n\n${text}`
          }
        ],
        max_tokens: 300,
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      this.requestCount++;
      const content = response.data.choices[0].message.content.trim();
      
      // Parse the response into an array
      const points = content
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim())
        .filter(point => point.length > 10)
        .slice(0, maxPoints);

      return points.length > 0 ? points : [content];

    } catch (error) {
      throw error;
    }
  }

  extractKeySentences(text, maxPoints) {
    if (!text) return ['내용 없음'];

    // Split into sentences
    const sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20);

    if (sentences.length === 0) {
      return [text.substring(0, 100) + '...'];
    }

    // Return first few sentences, up to maxPoints
    return sentences.slice(0, maxPoints).map(s => {
      if (s.length > 150) {
        return s.substring(0, 150) + '...';
      }
      return s;
    });
  }

  async generateDetailedSummary(article) {
    if (!article || !article.content) return '';

    try {
      if (this.openaiApiKey && this.canMakeRequest()) {
        return await this.generateDetailedSummaryWithOpenAI(article);
      }

      // Fallback: Return processed content
      return this.processContent(article.content);

    } catch (error) {
      logger.warn('Detailed summary generation failed:', error.message);
      return this.processContent(article.content || article.description || '');
    }
  }

  async generateDetailedSummaryWithOpenAI(article) {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '당신은 뉴스 분석 전문가입니다. 주어진 뉴스 기사를 바탕으로 상세하고 객관적인 요약을 작성해주세요. 주요 사실, 배경 정보, 영향을 포함해야 합니다.'
          },
          {
            role: 'user',
            content: `다음 뉴스 기사를 상세히 요약해주세요:\n\n제목: ${article.title}\n\n내용: ${article.content || article.description}`
          }
        ],
        max_tokens: 500,
        temperature: 0.4
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      this.requestCount++;
      return response.data.choices[0].message.content.trim();

    } catch (error) {
      throw error;
    }
  }

  processContent(content) {
    if (!content) return '';
    
    // Remove HTML and clean up
    const cleaned = content
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-zA-Z0-9#]+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Return first 300 characters
    if (cleaned.length > 300) {
      return cleaned.substring(0, 300) + '...';
    }
    
    return cleaned;
  }

  isKorean(text) {
    // Check if text contains Korean characters
    const koreanRegex = /[\u3131-\u314e\u314f-\u3163\uac00-\ud7a3]/;
    return koreanRegex.test(text);
  }

  canMakeRequest() {
    const now = Date.now();
    
    // Reset counter every minute
    if (now - this.lastResetTime > 60000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    
    return this.requestCount < this.maxRequestsPerMinute;
  }

  // Health check method
  getStatus() {
    return {
      hasOpenAI: !!this.openaiApiKey,
      requestCount: this.requestCount,
      cacheSize: this.cache.size,
      canMakeRequest: this.canMakeRequest()
    };
  }

  // Clear cache method
  clearCache() {
    this.cache.clear();
    logger.info('AI service cache cleared');
  }
}

module.exports = new AIService();
