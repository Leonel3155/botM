interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  author: string;
  score: number;
  thumbnail: string;
  subreddit: string;
  created_utc: number;
  over_18?: boolean;
}

interface RedditResponse {
  data: {
    children: Array<{
      data: RedditPost;
    }>;
  };
}

export class RedditService {
  private baseUrl = 'https://www.reddit.com';

  async getHotPosts(subreddit: string, limit: number = 25): Promise<RedditPost[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/r/${subreddit}/hot.json?limit=${limit}`,
        {
          headers: {
            'User-Agent': 'UltraBot-Pro/1.0 (Discord Bot)'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status}`);
      }

      const data: RedditResponse = await response.json();
      return data.data.children.map(child => child.data);
    } catch (error) {
      console.error('Error fetching Reddit posts:', error);
      return [];
    }
  }

  async getTopPosts(subreddit: string, timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' = 'day', limit: number = 25): Promise<RedditPost[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/r/${subreddit}/top.json?t=${timeframe}&limit=${limit}`,
        {
          headers: {
            'User-Agent': 'UltraBot-Pro/1.0 (Discord Bot)'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status}`);
      }

      const data: RedditResponse = await response.json();
      return data.data.children.map(child => child.data);
    } catch (error) {
      console.error('Error fetching Reddit posts:', error);
      return [];
    }
  }

  async getRandomMeme(subreddits: string[] = ['memes', 'dankmemes', 'ProgrammerHumor', 'gaming']): Promise<RedditPost | null> {
    const randomSubreddit = subreddits[Math.floor(Math.random() * subreddits.length)];
    const posts = await this.getHotPosts(randomSubreddit, 50);
    
    // Filter for image posts (never NSFW: these go to regular server channels)
    const imagePosts = posts.filter(post =>
      !post.over_18 && (
        post.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
        post.url.includes('i.redd.it') ||
        post.url.includes('imgur.com')
      )
    );

    if (imagePosts.length === 0) return null;
    
    return imagePosts[Math.floor(Math.random() * imagePosts.length)];
  }

  formatPostForDiscord(post: RedditPost): any {
    return {
      embeds: [{
        color: 0xFF4500, // Reddit orange
        title: post.title.length > 256 ? post.title.substring(0, 253) + '...' : post.title,
        url: `https://reddit.com${post.permalink}`,
        image: {
          url: post.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? post.url : undefined
        },
        footer: {
          text: `r/${post.subreddit} • ${post.score} upvotes • by u/${post.author}`,
          icon_url: 'https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png'
        },
        timestamp: new Date(post.created_utc * 1000).toISOString()
      }]
    };
  }
}

export const redditService = new RedditService();
