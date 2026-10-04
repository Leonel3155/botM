interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
  };
  attachments?: {
    media_keys: string[];
  };
  author?: {
    id: string;
    name: string;
    username: string;
    profile_image_url: string;
  };
}

interface TwitterResponse {
  data: Tweet[];
  includes?: {
    users: Array<{
      id: string;
      name: string;
      username: string;
      profile_image_url: string;
    }>;
  };
}

export class TwitterService {
  private bearerToken: string;
  private baseUrl = 'https://api.twitter.com/2';

  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || process.env.X_BEARER_TOKEN || '';
    
    if (!this.bearerToken) {
      console.warn('Twitter Bearer Token not provided. Twitter functionality will be limited.');
    }
  }

  async getUserTweets(username: string, count: number = 10): Promise<Tweet[]> {
    if (!this.bearerToken) return [];

    try {
      // First, get user ID from username
      const userResponse = await fetch(
        `${this.baseUrl}/users/by/username/${username}`,
        {
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'User-Agent': 'UltraBot-Pro/2.0'
          }
        }
      );

      if (!userResponse.ok) {
        throw new Error(`Twitter API error: ${userResponse.status}`);
      }

      const userData = await userResponse.json();
      const userId = userData.data.id;

      // Get user's tweets
      const tweetsResponse = await fetch(
        `${this.baseUrl}/users/${userId}/tweets?max_results=${Math.min(count, 100)}&tweet.fields=created_at,public_metrics,attachments&expansions=author_id&user.fields=name,username,profile_image_url`,
        {
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'User-Agent': 'UltraBot-Pro/2.0'
          }
        }
      );

      if (!tweetsResponse.ok) {
        throw new Error(`Twitter API error: ${tweetsResponse.status}`);
      }

      const tweetsData: TwitterResponse = await tweetsResponse.json();
      
      // Attach author information to tweets
      if (tweetsData.includes?.users) {
        tweetsData.data.forEach(tweet => {
          tweet.author = tweetsData.includes?.users.find(user => user.id === tweet.author_id);
        });
      }

      return tweetsData.data || [];
    } catch (error) {
      console.error('Error fetching Twitter posts:', error);
      return [];
    }
  }

  async getTrendingTweets(topic: string, count: number = 10): Promise<Tweet[]> {
    if (!this.bearerToken) return [];

    try {
      const response = await fetch(
        `${this.baseUrl}/tweets/search/recent?query=${encodeURIComponent(topic + ' -is:retweet')}&max_results=${Math.min(count, 100)}&tweet.fields=created_at,public_metrics,attachments&expansions=author_id&user.fields=name,username,profile_image_url`,
        {
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'User-Agent': 'UltraBot-Pro/2.0'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Twitter API error: ${response.status}`);
      }

      const data: TwitterResponse = await response.json();
      
      // Attach author information to tweets
      if (data.includes?.users) {
        data.data.forEach(tweet => {
          tweet.author = data.includes?.users.find(user => user.id === tweet.author_id);
        });
      }

      return data.data || [];
    } catch (error) {
      console.error('Error fetching trending tweets:', error);
      return [];
    }
  }

  formatTweetForDiscord(tweet: Tweet): any {
    const author = tweet.author;
    const metrics = tweet.public_metrics;

    return {
      embeds: [{
        color: 0x1DA1F2, // Twitter blue
        author: author ? {
          name: `${author.name} (@${author.username})`,
          icon_url: author.profile_image_url,
          url: `https://twitter.com/${author.username}`
        } : undefined,
        description: tweet.text.length > 2048 ? tweet.text.substring(0, 2045) + '...' : tweet.text,
        url: `https://twitter.com/${author?.username}/status/${tweet.id}`,
        footer: {
          text: metrics ? 
            `❤️ ${metrics.like_count} • 🔄 ${metrics.retweet_count} • 💬 ${metrics.reply_count}` : 
            'Twitter',
          icon_url: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        },
        timestamp: tweet.created_at
      }]
    };
  }

  // Mock implementation for when API is not available
  getMockTweet(): any {
    const mockTweets = [
      {
        text: "Just discovered this amazing new programming technique! 🚀 #coding #programming",
        author: { name: "Dev Guru", username: "devguru2024" },
        metrics: { like_count: 42, retweet_count: 15, reply_count: 8 }
      },
      {
        text: "Working on an epic Discord bot project. The future is now! 🤖✨ #discord #bot",
        author: { name: "Bot Builder", username: "botbuilder" },
        metrics: { like_count: 128, retweet_count: 45, reply_count: 23 }
      }
    ];

    const randomTweet = mockTweets[Math.floor(Math.random() * mockTweets.length)];
    
    return {
      embeds: [{
        color: 0x1DA1F2,
        author: {
          name: `${randomTweet.author.name} (@${randomTweet.author.username})`,
          icon_url: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        },
        description: randomTweet.text,
        footer: {
          text: `❤️ ${randomTweet.metrics.like_count} • 🔄 ${randomTweet.metrics.retweet_count} • 💬 ${randomTweet.metrics.reply_count}`,
          icon_url: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        },
        timestamp: new Date().toISOString()
      }]
    };
  }
}

export const twitterService = new TwitterService();
