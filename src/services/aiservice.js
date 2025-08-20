const axios = require('axios');
const logger = require('../utils/logger');
const crypto = require('crypto'); // For hashing cache keys

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
    this.requestCount = 0;
    this.maxRequestsPerMinute = 50;
    this.lastResetTime = Date.now();
    this.remainingRequests = 50; // Initial estimate
    this.remainingTokens = 4000; // Initial estimate
    this.deadLetterQueue = []; // For failed tasks, process later
    this.translateQueue = []; // Queue for translation tasks
    this.summarizeQueue = []; // Queue for summary tasks
    this.concurrency = 5; // Dynamic, adjusted based on remaining
    this.processQueues(); // Start queue processing interval
  }

  // Queue processor (every 1s tick)
  processQueues() {
    setInterval(async () => {
      // Adjust concurrency based on remaining
      this.concurrency = Math.max(1, Math.min(5, Math.floor(this.remainingRequests / 2)));

      // Process translate queue
      for (let i = 0; i < this.concurrency && this.translateQueue.length > 0; i++) {
        const task = this.translateQueue.shift();
        this.processTask(task, 'translate');
      }

      // Process summarize queue
      for (let i = 0; i < this.concurrency && this.summarizeQueue.length > 0; i++) {
        const task = this.summarizeQueue.shift();
        this.processTask(task, 'summarize');
      }
    }, 1000);
  }

  async processTask(task, type) {
    try {
      let result;
      if (type === 'translate') {
        result = await this.translateWithOpenAI(task.text);
      } else if (type === 'summarize') {
        result = await this.generateSummaryWithOpenAI(task.text, task.maxPoints);
      }
      task.resolve(result);
    } catch (error) {
      if (task.retries < 5) {
        task.retries++;
        const delay = Math.pow(2, task.retries) * 1000; // Exponential backoff
        setTimeout(() => {
          type === 'translate' ? this.translateQueue.push(task) : this.summarizeQueue.push(task);
        }, delay);
      } else {
        this.deadLetterQueue.push(task); // Move to dead letter
        task.reject(new Error('Max retries exceeded'));
      }
    }
  }

  // Nightly batch for dead letter (call externally, e.g., via cron)
  async processDeadLetterBatch() {
    while (this.deadLetterQueue.length > 0) {
      const task = this.deadLetterQueue.shift();
      await this.processTask(task, task.type); // Retry in batch
    }
    logger.info('Dead letter queue processed');
  }

  async translateToKorean(text, retries = 0) {
    if (!text || text.trim().length === 0) return '';
    if (this.isKorean(text)) return text; // Use isKorean for detection

    // Hash for dedup cache
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const cacheKey = `translate:${hash}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    // Slice text to save tokens
    text = text.substring(0, 2000);

    return new Promise((resolve, reject) => {
      this.translateQueue.push({
        text,
        retries,
        resolve,
        reject,
        type: 'translate'
      });
    }).then(translated => {
      // Validate translation result
      if (!translated || translated === text || !this.isKorean(translated)) {
        throw new Error('Translation result invalid or not Korean.');
      }
      this.cache.set(cacheKey, translated);
      if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
      return translated;
    }).catch(error => {
      logger.warn(`Translation failed: ${error.message}`);
      return text; // Fallback to original on failure (no basicTranslation)
    });
  }

  async translateWithOpenAI(text) {
    if (!this.canMakeRequest()) throw new Error('Rate limit exceeded');

    // Universal prompt for auto-detection (from provided code)
    const systemMessage = `당신은 전문적인 다국어 뉴스 번역가입니다. 주어진 텍스트의 언어(주로 영어 또는 일본어)를 자동으로 감지하고, 이를 자연스럽고 정확한 한국어로 번역하세요.
IT, 기술(Tech), 비즈니스(Biz), 버즈(Buzz) 분야의 뉴스를 다룹니다. 전문 용어와 고유명사(인명, 지명, 회사명)는 한국어 표준 표기법에 맞게 정확히 번역해야 합니다.
원문의 톤과 뉘앙스를 최대한 보존해주세요.`;

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: `Translate the following news text into Korean:\n\n${text}` }
        ],
        max_tokens: 800, // Upward from provided code
        temperature: 0.3
      }, {
        headers: { 'Authorization': `Bearer ${this.openaiApiKey}` },
        timeout: 20000 // Upward
      });

      this.updateRateLimits(response.headers);
      this.requestCount++;

      // Check finish_reason
      if (response.data.choices[0].finish_reason === 'length') {
        logger.warn('Translation potentially truncated due to max_tokens limit.');
      }
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      this.logOpenAIError(error, 'Translation'); // Added from provided code
      if (error.response) {
        this.updateRateLimits(error.response.headers);
        if (error.response.status === 429 || error.response.status >= 500 || error.code === 'ETIMEDOUT') {
          throw error; // For backoff retry
        }
      }
      throw error;
    }
  }

  // Added isKorean from provided code
  isKorean(text) {
    if (!text) return false;
    const koreanRegex = /[\uac00-\ud7a3]/g;
    const textLength = text.replace(/\s+/g, '').length;
    if (textLength === 0) return false;
    const koreanMatches = (text.match(koreanRegex) || []).length;
    return (koreanMatches / textLength) > 0.4;
  }

  async generateSummaryPoints(text, maxPoints = 3) {
    if (!text || text.trim().length === 0) return ['내용 없음'];

    // Check if input is Korean, else fallback (from provided code)
    if (!this.isKorean(text)) {
      logger.warn('AI Summary generation skipped: Input text is not Korean. Using fallback.');
      return this.extractKeySentences(text, maxPoints);
    }

    // Slice text
    text = text.substring(0, 2000);

    return new Promise((resolve, reject) => {
      this.summarizeQueue.push({
        text,
        maxPoints,
        retries: 0,
        resolve,
        reject,
        type: 'summarize'
      });
    }).catch(() => this.extractKeySentences(text, maxPoints));
  }

  async generateSummaryWithOpenAI(text, maxPoints) {
    if (!this.canMakeRequest()) throw new Error('Rate limit exceeded');

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `당신은 뉴스 요약 전문가입니다. 주어진 뉴스 내용을 ${maxPoints}개의 핵심 포인트로 요약해주세요. 각 포인트는 한 줄로, 중요한 사실과 숫자를 포함해야 합니다. 결과는 반드시 한국어로 작성하세요.`
          },
          { role: 'user', content: `다음 뉴스를 ${maxPoints}개의 핵심 포인트로 요약해주세요:\n\n${text}` }
        ],
        max_tokens: 600, // Upward
        temperature: 0.3
      }, {
        headers: { 'Authorization': `Bearer ${this.openaiApiKey}` },
        timeout: 20000 // Upward
      });

      this.updateRateLimits(response.headers);
      this.requestCount++;

      const content = response.data.choices[0].message.content.trim();
      const points = content
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
        .filter(point => point.length > 10)
        .slice(0, maxPoints);
      return points.length > 0 ? points : [content];
    } catch (error) {
      this.logOpenAIError(error, 'Summary Points');
      throw error;
    }
  }

  extractKeySentences(text, maxPoints) {
    if (!text) return ['내용 없음'];
    // Added Japanese punctuation (from provided code)
    const sentences = text
      .split(/[.!?。]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20);
    if (sentences.length === 0) {
      return [text.substring(0, 100) + '...'];
    }
    return sentences.slice(0, maxPoints).map(s => {
      if (s.length > 150) {
        return s.substring(0, 150) + '...';
      }
      return s;
    });
  }

  // Similar updates for generateDetailedSummary (add isKorean check if needed, upward resources)
  async generateDetailedSummary(article) {
    if (!article || !article.content) return '';

    let content = article.content || article.description || '';
    if (!this.isKorean(content)) {
      logger.warn('AI Detailed Summary skipped: Input not Korean. Using fallback.');
      return this.processContent(content);
    }

    try {
      if (this.openaiApiKey && this.canMakeRequest()) {
        return await this.generateDetailedSummaryWithOpenAI(article);
      }
      return this.processContent(content);
    } catch (error) {
      logger.warn('Detailed summary generation failed:', error.message);
      return this.processContent(content);
    }
  }

  async generateDetailedSummaryWithOpenAI(article) {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '당신은 뉴스 분석 전문가입니다. 주어진 뉴스 기사를 바탕으로 상세하고 객관적인 요약을 작성해주세요. 주요 사실, 배경 정보, 영향을 포함해야 합니다. 결과는 반드시 한국어로 작성하세요.'
          },
          {
            role: 'user',
            content: `다음 뉴스 기사를 상세히 요약해주세요:\n\n제목: ${article.title}\n\n내용: ${article.content || article.description}`
          }
        ],
        max_tokens: 1000, // Upward
        temperature: 0.4
      }, {
        headers: { 'Authorization': `Bearer ${this.openaiApiKey}` },
        timeout: 25000 // Upward
      });

      this.updateRateLimits(response.headers);
      this.requestCount++;
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      this.logOpenAIError(error, 'Detailed Summary');
      throw error;
    }
  }

  processContent(content) {
    if (!content) return '';
    const cleaned = content
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-zA-Z0-9#]+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 300) {
      return cleaned.substring(0, 300) + '...';
    }
    return cleaned;
  }

  // Update remaining from headers
  updateRateLimits(headers) {
    if (headers) {
      this.remainingRequests = parseInt(headers['x-ratelimit-remaining-requests'] || this.remainingRequests);
      this.remainingTokens = parseInt(headers['x-ratelimit-remaining-tokens'] || this.remainingTokens);
    }
  }

  canMakeRequest() {
    const now = Date.now();
    if (now - this.lastResetTime > 60000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    return this.requestCount < this.maxRequestsPerMinute && this.remainingRequests > 0 && this.remainingTokens > 500;
  }

  // Added logOpenAIError from provided code
  logOpenAIError(error, context) {
    if (error.response) {
      logger.error(`[OpenAI API Error - ${context}] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      if (error.response.status === 429) {
        logger.warn('OpenAI rate limit exceeded');
      }
    } else if (error.request) {
      logger.error(`[OpenAI API No Response - ${context}] Timeout or Network error: ${error.message}`);
    } else {
      logger.error(`[OpenAI API Request Setup Error - ${context}]: ${error.message}`);
    }
  }

  // Health check and clear cache remain the same
  getStatus() {
    return {
      hasOpenAI: !!this.openaiApiKey,
      requestCount: this.requestCount,
      cacheSize: this.cache.size,
      canMakeRequest: this.canMakeRequest()
    };
  }

  clearCache() {
    this.cache.clear();
    logger.info('AI service cache cleared');
  }
}

module.exports = new AIService();

