const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.cache = new Map();
    this.translateQueue = [];
    this.summarizeQueue = [];
    this.deadLetterQueue = [];
    this.running = 0;
    this.concurrency = 8;
    this.batchSize = 6;
    this.tickMs = 500;
    this.maxRetries = 5;
    this.backoff = [400, 800, 1600, 3200, 6400];
    this.remainingRequests = Infinity;
    this.remainingTokens = Infinity;
    this.start();
  }

  start() {
    setInterval(() => this._drain(), this.tickMs);
  }

  _drain() {
    if (this.running >= this.concurrency) return;
    const slots = Math.min(
      this.concurrency - this.running,
      Math.max(1, this.remainingRequests || this.batchSize)
    );
    for (let i = 0; i < slots; i++) {
      const task = this.translateQueue.shift() || this.summarizeQueue.shift();
      if (task) this._runTask(task);
    }
  }

  async _runTask(task) {
    this.running++;
    try {
      const { type, text, maxPoints } = task;
      let result;
      if (type === 'translate') {
        result = await this._translateWithOpenAI(text);
      } else if (type === 'summarize') {
        result = await this._summarizeWithOpenAI(text, maxPoints);
      }
      task.resolve(result);
    } catch (err) {
      if (task.retries < this.maxRetries) {
        const wait = this.backoff[task.retries] || 8000;
        task.retries++;
        setTimeout(() => {
          (task.type === 'translate' ? this.translateQueue : this.summarizeQueue).push(task);
        }, wait);
      } else {
        this.deadLetterQueue.push(task);
        task.reject(err);
      }
    } finally {
      this.running--;
    }
  }

  async processDeadLetterBatch() {
    logger.info(`Processing ${this.deadLetterQueue.length} dead letters`);
    while (this.deadLetterQueue.length > 0) {
      const task = this.deadLetterQueue.shift();
      await this._runTask(task);
    }
  }

  async translateToKorean(text) {
    if (!text?.trim()) return '';
    if (this.isKorean(text)) return text;

    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const key = `tr:${hash}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const sliced = text.slice(0, 1600);
    return new Promise((resolve, reject) => {
      this.translateQueue.push({ type: 'translate', text: sliced, retries: 0, resolve, reject });
    }).then(res => {
      if (this.isKorean(res)) {
        this.cache.set(key, res);
        if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
        return res;
      }
      return text;
    });
  }

  async generateSummaryPoints(text, maxPoints = 5) {
    if (!text?.trim()) return ['내용 없음'];
    return new Promise((resolve, reject) => {
      this.summarizeQueue.push({ type: 'summarize', text, maxPoints, retries: 0, resolve, reject });
    });
  }

  async generateDetailedSummary(article) {
    if (!article || !article.content) return '';
    const text = article.content.slice(0, 2000);
    return this._callOpenAI('gpt-4o-mini', [
      { role: 'system', content: '당신은 뉴스 분석 전문가입니다. 주어진 뉴스를 객관적이고 상세히 요약하세요.' },
      { role: 'user', content: `제목: ${article.title}\n내용: ${text}` }
    ], 500).catch(() => '상세 요약 생성 불가');
  }

  async _translateWithOpenAI(text) {
    const response = await this._callOpenAI('gpt-4o-mini', [
      { role: 'system', content: '당신은 전문 뉴스 번역가입니다. 영어/일본어를 한국어로 자연스럽게 번역하세요.' },
      { role: 'user', content: text }
    ], 220);
    return response;
  }

  async _summarizeWithOpenAI(text, maxPoints) {
    const response = await this._callOpenAI('gpt-4o-mini', [
      { role: 'system', content: `당신은 뉴스 요약 전문가입니다. 기사를 ${maxPoints}개의 핵심 bullet로 요약하세요.` },
      { role: 'user', content: text }
    ], 220);
    return response.split('\n').filter(Boolean).slice(0, maxPoints);
  }

  async _callOpenAI(model, messages, max_tokens) {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model, messages, max_tokens, temperature: 0.2
    }, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 20000
    });
    this._updateLimits(res.headers);
    return res.data.choices[0].message.content.trim();
  }

  _updateLimits(h) {
    const r = Number(h['x-ratelimit-remaining-requests']);
    const t = Number(h['x-ratelimit-remaining-tokens']);
    if (!isNaN(r)) this.remainingRequests = r;
    if (!isNaN(t)) this.remainingTokens = t;
    if (this.remainingRequests < this.concurrency / 2) {
      this.concurrency = Math.max(2, Math.floor(this.concurrency * 0.8));
    } else {
      this.concurrency = Math.min(this.concurrency + 1, 24);
    }
  }

  isKorean(txt) {
    const ko = txt.match(/[\\uac00-\\ud7a3]/g) || [];
    return (ko.length / (txt.replace(/\\s+/g, '').length || 1)) > 0.4;
  }

  getStatus() {
    return {
      cache: this.cache.size,
      running: this.running,
      deadLetters: this.deadLetterQueue.length,
      remainingRequests: this.remainingRequests,
      remainingTokens: this.remainingTokens,
      concurrency: this.concurrency
    };
  }

  clearCache() {
    this.cache.clear();
    logger.info('AI service cache cleared');
  }
}

module.exports = new AIService();

