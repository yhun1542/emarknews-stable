const axios = require('axios');
const logger = require('../utils/logger');
const database = require('../config/database');

class CurrencyService {
  constructor() {
    this.apiKey = process.env.CURRENCY_API_KEY;
    this.cache = new Map();
    this.lastUpdate = null;
    this.updateInterval = 30 * 60 * 1000; // 30 minutes
  }

  async getCurrencyRates() {
    try {
      const cacheKey = 'currency:rates';
      
      // Check cache first
      const cached = await this.getCachedRates(cacheKey);
      if (cached && this.isCacheValid(cached.timestamp)) {
        logger.info('📈 Returning cached currency rates');
        return {
          success: true,
          data: cached,
          cached: true
        };
      }

      // Fetch fresh rates
      const rates = await this.fetchRates();
      
      // Cache the results
      await this.cacheRates(cacheKey, rates);

      logger.info('📈 Fetched fresh currency rates');

      return {
        success: true,
        data: rates,
        cached: false
      };

    } catch (error) {
      logger.error('Currency rates fetch failed:', error);
      
      // Try to return cached data on error
      try {
        const cached = await this.getCachedRates('currency:rates');
        if (cached) {
          return {
            success: true,
            data: cached,
            cached: true,
            fallback: true
          };
        }
      } catch (cacheError) {
        logger.error('Currency cache fallback failed:', cacheError);
      }

      return {
        success: false,
        error: 'Failed to fetch currency rates',
        data: this.getFallbackRates()
      };
    }
  }

  async fetchRates() {
    // Try multiple sources for better reliability
    const sources = [
      () => this.fetchFromExchangeRate(),
      () => this.fetchFromFixer(),
      () => this.fetchFromFreeAPI()
    ];

    for (const fetchMethod of sources) {
      try {
        const rates = await fetchMethod();
        if (rates && rates.USD && rates.JPY && rates.EUR) {
          return this.processRates(rates);
        }
      } catch (error) {
        logger.warn('Currency source failed:', error.message);
        continue;
      }
    }

    throw new Error('All currency sources failed');
  }

  async fetchFromExchangeRate() {
    // Using free exchangerate-api.com
    const response = await axios.get('https://api.exchangerate-api.com/v4/latest/KRW', {
      timeout: 10000,
      headers: {
        'User-Agent': 'EmarkNews/7.0'
      }
    });

    const data = response.data;
    return {
      USD: 1 / data.rates.USD,
      JPY: 1 / data.rates.JPY,
      EUR: 1 / data.rates.EUR,
      CNY: 1 / data.rates.CNY,
      timestamp: data.date
    };
  }

  async fetchFromFixer() {
    if (!this.apiKey) {
      throw new Error('No currency API key available');
    }

    const response = await axios.get(`https://api.fixer.io/latest?access_key=${this.apiKey}&base=EUR&symbols=USD,KRW,JPY,CNY`, {
      timeout: 10000
    });

    const data = response.data;
    if (!data.success) {
      throw new Error('Fixer API error');
    }

    // Convert EUR base to KRW base
    const eurToKrw = data.rates.KRW;
    return {
      USD: eurToKrw / data.rates.USD,
      JPY: eurToKrw / data.rates.JPY,
      EUR: eurToKrw,
      CNY: eurToKrw / data.rates.CNY,
      timestamp: data.date
    };
  }

  async fetchFromFreeAPI() {
    // Using free currencylayer (limited requests)
    const response = await axios.get('https://api.currencylayer.com/live?access_key=free&currencies=KRW,USD,JPY,EUR,CNY&source=USD', {
      timeout: 10000
    });

    const data = response.data;
    if (!data.success) {
      throw new Error('Currencylayer API error');
    }

    // Convert USD base to KRW base
    const usdToKrw = data.quotes.USDKRW;
    return {
      USD: usdToKrw,
      JPY: usdToKrw / (data.quotes.USDJPY || 110),
      EUR: usdToKrw / (data.quotes.USDEUR || 0.85),
      CNY: usdToKrw / (data.quotes.USDCNY || 7),
      timestamp: new Date(data.timestamp * 1000).toISOString()
    };
  }

  processRates(rates) {
    const now = new Date();
    
    // Calculate changes (mock data for demo)
    const changes = {
      USD: (Math.random() - 0.5) * 20, // -10 to +10
      JPY: (Math.random() - 0.5) * 2,  // -1 to +1
      EUR: (Math.random() - 0.5) * 30, // -15 to +15
      CNY: (Math.random() - 0.5) * 10  // -5 to +5
    };

    return {
      timestamp: now.toISOString(),
      lastUpdate: now.toISOString(),
      rates: {
        USD: {
          rate: Math.round(rates.USD * 100) / 100,
          change: Math.round(changes.USD * 100) / 100,
          symbol: '$',
          name: '미국 달러',
          flag: '🇺🇸'
        },
        JPY: {
          rate: Math.round(rates.JPY * 100) / 100,
          change: Math.round(changes.JPY * 100) / 100,
          symbol: '¥',
          name: '일본 엔',
          flag: '🇯🇵'
        },
        EUR: {
          rate: Math.round(rates.EUR * 100) / 100,
          change: Math.round(changes.EUR * 100) / 100,
          symbol: '€',
          name: '유로',
          flag: '🇪🇺'
        },
        CNY: {
          rate: Math.round(rates.CNY * 100) / 100,
          change: Math.round(changes.CNY * 100) / 100,
          symbol: '¥',
          name: '중국 위안',
          flag: '🇨🇳'
        }
      },
      source: 'Multiple APIs',
      disclaimer: '환율은 실시간이 아닐 수 있으며, 투자 결정시 참고용으로만 사용하세요.'
    };
  }

  getFallbackRates() {
    // Static fallback rates (approximate values)
    return {
      timestamp: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      rates: {
        USD: {
          rate: 1340.50,
          change: 0,
          symbol: '$',
          name: '미국 달러',
          flag: '🇺🇸'
        },
        JPY: {
          rate: 8.95,
          change: 0,
          symbol: '¥',
          name: '일본 엔',
          flag: '🇯🇵'
        },
        EUR: {
          rate: 1456.30,
          change: 0,
          symbol: '€',
          name: '유로',
          flag: '🇪🇺'
        },
        CNY: {
          rate: 186.45,
          change: 0,
          symbol: '¥',
          name: '중국 위안',
          flag: '🇨🇳'
        }
      },
      source: 'Fallback Data',
      disclaimer: '네트워크 오류로 인해 기본값을 표시합니다. 실제 환율과 다를 수 있습니다.',
      fallback: true
    };
  }

  async getCachedRates(cacheKey) {
    try {
      const client = database.getClient();
      if (!client || !client.isOpen) return null;
      
      const cached = await client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn('Currency cache read failed:', error.message);
    }
    return null;
  }

  async cacheRates(cacheKey, rates) {
    try {
      const client = database.getClient();
      if (!client || !client.isOpen) return;
      
      await client.setEx(cacheKey, 1800, JSON.stringify(rates)); // 30 minutes TTL
      logger.info('💰 Currency rates cached');
    } catch (error) {
      logger.warn('Currency cache write failed:', error.message);
    }
  }

  isCacheValid(timestamp) {
    if (!timestamp) return false;
    
    const cacheAge = Date.now() - new Date(timestamp).getTime();
    return cacheAge < this.updateInterval;
  }

  startBackgroundUpdates() {
    // Update every 30 minutes
    const UPDATE_INTERVAL = 30 * 60 * 1000;
    
    // Initial update after 1 minute
    setTimeout(() => {
      this.getCurrencyRates();
    }, 60000);
    
    // Regular updates
    setInterval(() => {
      this.getCurrencyRates();
    }, UPDATE_INTERVAL);
    
    logger.info('💱 Currency background updates started (30-minute interval)');
  }

  getStatus() {
    return {
      hasApiKey: !!this.apiKey,
      lastUpdate: this.lastUpdate,
      cacheSize: this.cache.size,
      updateInterval: this.updateInterval
    };
  }
}

module.exports = new CurrencyService();
