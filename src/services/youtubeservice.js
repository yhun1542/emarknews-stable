const axios = require('axios');
const logger = require('../utils/logger');
const database = require('../config/database');

class YouTubeService {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
    this.channels = this.initializeChannels();
    this.cache = new Map();
  }

  initializeChannels() {
    return {
      world: [
        { id: 'UCYfdidRxbB8Qhf0Nx7ioOYw', name: 'CNN', country: 'US' },
        { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News', country: 'UK' },
        { id: 'UCaXkIU1QidjPwiAYu6GcHjg', name: 'FRANCE 24 English', country: 'FR' },
        { id: 'UCZaT_X_mc0BI-djXOlfhqWQ', name: 'Al Jazeera English', country: 'QA' },
        { id: 'UC4SUWizzKc1tptprBkWjX2Q', name: 'Sky News', country: 'UK' }
      ],
      kr: [
        { id: 'UC-i2ywiuvjvpTy2zW-tXfkw', name: 'KBS News', country: 'KR' },
        { id: 'UCXMqAKSrSlX_EMBuiUECsXw', name: 'SBS 뉴스', country: 'KR' },
        { id: 'UCcQTRi69dsVYHN3exePtZ1A', name: 'MBC 뉴스', country: 'KR' },
        { id: 'UChlgI3UHCOnwUGzWzbJ3H5w', name: 'YTN', country: 'KR' },
        { id: 'UCYTRi1yt25YxUygpKv9QOVA', name: 'JTBC 뉴스', country: 'KR' }
      ],
      japan: [
        { id: 'UCuTAXTexrhetbOe3zgskJBQ', name: 'ANNnewsCH', country: 'JP' },
        { id: 'UCGCZAYq5Xxojl_tSXcVJhiQ', name: 'TBS NEWS', country: 'JP' },
        { id: 'UCwtnCld6KVFvhsJ5FH8yZHA', name: 'FNNプライムオンライン', country: 'JP' },
        { id: 'UCJTBCWaUK3MS4jRJpbz3L-A', name: 'ABEMAニュース', country: 'JP' },
        { id: 'UCOzfNN3bJOKAoT7ES_PYydw', name: 'TBSニュース', country: 'JP' }
      ],
      tech: [
        { id: 'UCBJycsmduvYEL83R_U4JriQ', name: 'Marques Brownlee', country: 'US' },
        { id: 'UCeeFfhMcJa1kjtfZAGskOCA', name: 'TechCrunch', country: 'US' },
        { id: 'UCXIJgqnII2ZOINSWNOGFThA', name: 'The Verge', country: 'US' },
        { id: 'UCnhkJUPUQl46F4XaGlRTJGg', name: 'TechLinked', country: 'US' },
        { id: 'UC6kRhSAGAQoyYQKrhNNnhfg', name: 'Tom Scott', country: 'UK' }
      ],
      business: [
        { id: 'UCrp_UI8XtuYfpiqluWLD7Lw', name: 'Bloomberg Markets and Finance', country: 'US' },
        { id: 'UCd2BQPEO4zE0ofYL0-yVNzg', name: 'CNBC', country: 'US' },
        { id: 'UCV7daBIt7WYDRiPyBBxMpRw', name: 'Financial Times', country: 'UK' },
        { id: 'UCAuUUnT6oDeKwE6v1NGQxug', name: 'Forbes', country: 'US' },
        { id: 'UCZl_8ATWlECyLrLXGqy1Flg', name: 'Wall Street Journal', country: 'US' }
      ],
      buzz: [
        { id: 'UCpko_-a4wgz2u_DgDgd9fqA', name: 'BuzzFeed Video', country: 'US' },
        { id: 'UClgRkhTL3_hImCAmdLfDE4g', name: 'Mashable', country: 'US' },
        { id: 'UCRija3stNXqb-6Zj4c8r1Cg', name: 'UNILAD', country: 'UK' },
        { id: 'UCaO6VoaYJv4kS-TQO_M-N_g', name: 'LADbible', country: 'UK' },
        { id: 'UCvFApMFo_AafXbeMDwuTiMw', name: 'Vox', country: 'US' }
      ]
    };
  }

  async getVideos(section = 'world') {
    try {
      const cacheKey = `youtube:${section}`;
      
      // Check cache first
      const cached = await this.getCachedVideos(cacheKey);
      if (cached && cached.length > 0) {
        logger.info(`📺 Returning cached YouTube videos for ${section} (${cached.length} videos)`);
        return {
          success: true,
          data: {
            section,
            videos: cached.slice(0, 10),
            total: cached.length,
            timestamp: new Date().toISOString(),
            cached: true
          }
        };
      }

      // Fetch fresh videos if API key is available
      if (!this.apiKey) {
        return {
          success: true,
          data: {
            section,
            videos: this.getMockVideos(section),
            total: 10,
            timestamp: new Date().toISOString(),
            mock: true
          }
        };
      }

      const videos = await this.fetchVideosForSection(section);
      
      // Cache the results
      await this.cacheVideos(cacheKey, videos);

      logger.info(`📺 Fetched ${videos.length} YouTube videos for ${section}`);

      return {
        success: true,
        data: {
          section,
          videos: videos.slice(0, 10),
          total: videos.length,
          timestamp: new Date().toISOString(),
          cached: false
        }
      };

    } catch (error) {
      logger.error(`YouTube videos fetch failed for ${section}:`, error);
      
      // Return mock data on error
      return {
        success: true,
        data: {
          section,
          videos: this.getMockVideos(section),
          total: 10,
          timestamp: new Date().toISOString(),
          fallback: true
        }
      };
    }
  }

  async fetchVideosForSection(section) {
    const channels = this.channels[section] || this.channels.world;
    const allVideos = [];

    for (const channel of channels.slice(0, 3)) { // Limit to 3 channels to avoid quota issues
      try {
        const videos = await this.fetchChannelVideos(channel);
        allVideos.push(...videos);
      } catch (error) {
        logger.warn(`Failed to fetch videos from ${channel.name}:`, error.message);
      }
    }

    // Sort by publish date and remove duplicates
    const sortedVideos = allVideos
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 20);

    return this.removeDuplicates(sortedVideos);
  }

  async fetchChannelVideos(channel) {
    try {
      // Get recent uploads from channel
      const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key: this.apiKey,
          channelId: channel.id,
          part: 'snippet',
          order: 'date',
          type: 'video',
          maxResults: 5,
          publishedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // Last 7 days
        },
        timeout: 10000
      });

      const videos = searchResponse.data.items.map(item => ({
        id: item.id.videoId,
        title: this.cleanTitle(item.snippet.title),
        description: this.cleanDescription(item.snippet.description),
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        channelName: channel.name,
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        duration: null, // Will be fetched if needed
        viewCount: null, // Will be fetched if needed
        country: channel.country
      }));

      return videos;

    } catch (error) {
      if (error.response?.status === 403) {
        logger.warn('YouTube API quota exceeded');
      }
      throw error;
    }
  }

  getMockVideos(section) {
    const mockData = {
      world: [
        {
          id: 'mock1',
          title: 'Global Climate Summit Reaches Historic Agreement',
          description: 'World leaders announce breakthrough climate policies...',
          thumbnail: 'https://via.placeholder.com/320x180/0066cc/ffffff?text=Climate+Summit',
          channelName: 'CNN',
          publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock1',
          country: 'US',
          mock: true
        },
        {
          id: 'mock2',
          title: 'International Trade Relations Update',
          description: 'Latest developments in global trade negotiations...',
          thumbnail: 'https://via.placeholder.com/320x180/cc6600/ffffff?text=Trade+News',
          channelName: 'BBC News',
          publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock2',
          country: 'UK',
          mock: true
        }
      ],
      kr: [
        {
          id: 'mock3',
          title: '한국 경제 성장률 발표, 전망 밝아',
          description: '올해 3분기 경제성장률이 예상치를 상회...',
          thumbnail: 'https://via.placeholder.com/320x180/009933/ffffff?text=경제+뉴스',
          channelName: 'KBS News',
          publishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock3',
          country: 'KR',
          mock: true
        }
      ],
      tech: [
        {
          id: 'mock4',
          title: 'New AI Breakthrough: ChatGPT-5 Announced',
          description: 'OpenAI reveals next-generation language model...',
          thumbnail: 'https://via.placeholder.com/320x180/6600cc/ffffff?text=AI+News',
          channelName: 'TechCrunch',
          publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock4',
          country: 'US',
          mock: true
        }
      ],
      business: [
        {
          id: 'mock5',
          title: 'Stock Market Reaches New All-Time High',
          description: 'Major indices continue their upward trajectory...',
          thumbnail: 'https://via.placeholder.com/320x180/cc0066/ffffff?text=Stock+Market',
          channelName: 'Bloomberg',
          publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock5',
          country: 'US',
          mock: true
        }
      ],
      buzz: [
        {
          id: 'mock6',
          title: 'Viral TikTok Trend Takes Over Social Media',
          description: 'New challenge spreads across platforms...',
          thumbnail: 'https://via.placeholder.com/320x180/ff6600/ffffff?text=Viral+Trend',
          channelName: 'BuzzFeed',
          publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          url: 'https://youtube.com/watch?v=mock6',
          country: 'US',
          mock: true
        }
      ]
    };

    return mockData[section] || mockData.world;
  }

  cleanTitle(title) {
    if (!title) return '';
    return title.replace(/\s+/g, ' ').trim().substring(0, 100);
  }

  cleanDescription(description) {
    if (!description) return '';
    return description
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }

  removeDuplicates(videos) {
    const seen = new Set();
    return videos.filter(video => {
      const key = video.title.toLowerCase().substring(0, 30);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async getCachedVideos(cacheKey) {
    try {
      const client = database.getClient();
      if (!client || !client.isOpen) return null;
      
      const cached = await client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn('YouTube cache read failed:', error.message);
    }
    return null;
  }

  async cacheVideos(cacheKey, videos) {
    try {
      const client = database.getClient();
      if (!client || !client.isOpen) return;
      
      await client.setEx(cacheKey, 1800, JSON.stringify(videos)); // 30 minutes TTL
      logger.info(`📺 Cached ${videos.length} YouTube videos for ${cacheKey}`);
    } catch (error) {
      logger.warn('YouTube cache write failed:', error.message);
    }
  }

  startBackgroundUpdates() {
    // Update every 30 minutes
    const UPDATE_INTERVAL = 30 * 60 * 1000;
    
    // Initial update after 2 minutes
    setTimeout(() => {
      this.updateAllSections();
    }, 120000);
    
    // Regular updates
    setInterval(() => {
      this.updateAllSections();
    }, UPDATE_INTERVAL);
    
    logger.info('📺 YouTube background updates started (30-minute interval)');
  }

  async updateAllSections() {
    const sections = ['world', 'kr', 'japan', 'tech', 'business', 'buzz'];
    
    for (const section of sections) {
      try {
        await this.getVideos(section);
        // Small delay between sections
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.warn(`Failed to update YouTube section ${section}:`, error.message);
      }
    }
  }

  getStatus() {
    return {
      hasApiKey: !!this.apiKey,
      channelCount: Object.values(this.channels).reduce((total, channels) => total + channels.length, 0),
      cacheSize: this.cache.size
    };
  }
}

module.exports = new YouTubeService();
