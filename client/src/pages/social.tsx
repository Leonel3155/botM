import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/layout";
import FeaturePanel from "@/components/feature-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Share2, 
  Plus, 
  Calendar, 
  ExternalLink,
  Vote,
  Twitter,
  Clock,
  TrendingUp,
  Eye,
  Hash
} from "lucide-react";

export default function Social() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: contentFeeds, isLoading } = useQuery({
    queryKey: ['/api/social/123456789012345678/feeds'],
    staleTime: 60000,
  });

  const createFeedMutation = useMutation({
    mutationFn: async (feedData: any) => {
      const response = await apiRequest('POST', '/api/social/123456789012345678/feeds', feedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/social/123456789012345678/feeds'] });
      toast({
        title: "Feed Created",
        description: "Content feed has been created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create content feed",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-discord-muted">Loading social content system...</div>
        </div>
      </Layout>
    );
  }

  const handleCreateFeed = () => {
    const feedData = {
      channelId: "123456789012345678",
      source: "reddit",
      sourceConfig: {
        subreddit: "memes",
        filterNSFW: true
      },
      postInterval: 30
    };
    createFeedMutation.mutate(feedData);
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Content Feeds Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Active Feeds</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-active-feeds">
                  {contentFeeds?.filter((feed: any) => feed.enabled).length || 0}
                </p>
              </div>
              <Share2 className="w-8 h-8 text-discord-primary" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Posts Today</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-posts-today">
                  24
                </p>
              </div>
              <Calendar className="w-8 h-8 text-discord-success" />
            </div>
          </Card>

          <Card className="discord-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-discord-muted text-sm font-medium">Avg Engagement</p>
                <p className="text-2xl font-bold text-white mt-1" data-testid="text-avg-engagement">
                  87%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-discord-warning" />
            </div>
          </Card>
        </div>

        {/* Create New Feed */}
        <FeaturePanel
          title="Create Content Feed"
          description="Set up automated content posting from social media"
          data-testid="panel-create-feed"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-white font-medium">Source Platform</label>
                <Select data-testid="select-source-platform">
                  <SelectTrigger className="discord-input">
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent className="bg-discord-grey border-discord-grey">
                    <SelectItem value="reddit" className="text-white">
                      <div className="flex items-center space-x-2">
                        <Vote className="w-4 h-4" />
                        <span>Vote</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="twitter" className="text-white">
                      <div className="flex items-center space-x-2">
                        <Twitter className="w-4 h-4" />
                        <span>Twitter/X</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Target Channel</label>
                <Select data-testid="select-target-channel">
                  <SelectTrigger className="discord-input">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent className="bg-discord-grey border-discord-grey">
                    <SelectItem value="memes" className="text-white">#memes</SelectItem>
                    <SelectItem value="funny" className="text-white">#funny</SelectItem>
                    <SelectItem value="general" className="text-white">#general</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Subreddit/Username</label>
                <Input 
                  placeholder="e.g., memes, dankmemes, @username" 
                  className="discord-input"
                  data-testid="input-source-config"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-white font-medium">Post Interval (minutes)</label>
                <Input 
                  type="number"
                  defaultValue="30" 
                  min="5"
                  max="1440"
                  className="discord-input"
                  data-testid="input-post-interval"
                />
              </div>

              <div className="space-y-2">
                <label className="text-white font-medium">Content Filter</label>
                <Select data-testid="select-content-filter">
                  <SelectTrigger className="discord-input">
                    <SelectValue placeholder="Select filter" />
                  </SelectTrigger>
                  <SelectContent className="bg-discord-grey border-discord-grey">
                    <SelectItem value="hot" className="text-white">Hot Posts</SelectItem>
                    <SelectItem value="top" className="text-white">Top Posts</SelectItem>
                    <SelectItem value="new" className="text-white">New Posts</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Filter NSFW</label>
                  <p className="text-discord-muted text-sm">Block NSFW content</p>
                </div>
                <Switch defaultChecked data-testid="switch-filter-nsfw" />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-medium">Enable Feed</label>
                  <p className="text-discord-muted text-sm">Start posting immediately</p>
                </div>
                <Switch defaultChecked data-testid="switch-enable-feed" />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-discord-grey">
            <div className="flex space-x-4">
              <Button 
                className="discord-button" 
                onClick={handleCreateFeed}
                disabled={createFeedMutation.isPending}
                data-testid="button-create-feed"
              >
                <Plus className="w-4 h-4 mr-2" />
                {createFeedMutation.isPending ? "Creating..." : "Create Feed"}
              </Button>
              <Button variant="outline" data-testid="button-test-feed">
                Test Feed
              </Button>
            </div>
          </div>
        </FeaturePanel>

        {/* Active Content Feeds */}
        <Card className="discord-card">
          <div className="p-6 border-b border-discord-grey">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Eye className="w-6 h-6 text-discord-primary" />
                <h3 className="text-lg font-semibold text-white">Active Content Feeds</h3>
              </div>
              <Button variant="outline" size="sm" data-testid="button-refresh-feeds">
                Refresh
              </Button>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {contentFeeds?.map((feed: any, index: number) => (
                <div 
                  key={feed.id} 
                  className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                  data-testid={`row-feed-${index}`}
                >
                  <div className="flex items-center space-x-4">
                    {feed.source === 'reddit' ? 
                      <Vote className="w-6 h-6 text-orange-500" /> : 
                      <Twitter className="w-6 h-6 text-blue-500" />
                    }
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-white font-medium" data-testid={`text-feed-title-${index}`}>
                          {feed.source === 'reddit' ? `r/${feed.sourceConfig?.subreddit || 'unknown'}` : '@username'}
                        </h4>
                        <Badge variant={feed.enabled ? "default" : "secondary"}>
                          {feed.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </div>
                      <p className="text-discord-muted text-sm" data-testid={`text-feed-details-${index}`}>
                        #{feed.channelId.slice(-4)} • Every {feed.postInterval} minutes
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" data-testid={`button-edit-feed-${index}`}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" data-testid={`button-delete-feed-${index}`}>
                      Delete
                    </Button>
                  </div>
                </div>
              )) || (
                <div className="text-center py-8">
                  <Share2 className="w-12 h-12 text-discord-muted mx-auto mb-4" />
                  <p className="text-discord-muted">No content feeds configured</p>
                  <p className="text-discord-muted text-sm">Create your first feed to start posting content</p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Recent Posts */}
        <Card className="discord-card">
          <div className="p-6 border-b border-discord-grey">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Clock className="w-6 h-6 text-discord-success" />
                <h3 className="text-lg font-semibold text-white">Recent Posts</h3>
              </div>
              <Button variant="outline" size="sm" data-testid="button-view-all-posts">
                View All
              </Button>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {[
                { title: "Funny Programming Meme", source: "reddit", subreddit: "ProgrammerHumor", time: "5m ago", engagement: "12 reactions" },
                { title: "Gaming Achievement", source: "reddit", subreddit: "gaming", time: "15m ago", engagement: "8 reactions" },
                { title: "Tech News Update", source: "twitter", user: "@technews", time: "30m ago", engagement: "15 reactions" },
                { title: "Motivational Quote", source: "reddit", subreddit: "GetMotivated", time: "45m ago", engagement: "6 reactions" }
              ].map((post, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-4 bg-discord-grey rounded-lg"
                  data-testid={`row-recent-post-${index}`}
                >
                  <div className="flex items-center space-x-4">
                    {post.source === 'reddit' ? 
                      <Vote className="w-5 h-5 text-orange-500" /> : 
                      <Twitter className="w-5 h-5 text-blue-500" />
                    }
                    <div>
                      <h4 className="text-white font-medium" data-testid={`text-post-title-${index}`}>
                        {post.title}
                      </h4>
                      <p className="text-discord-muted text-sm" data-testid={`text-post-source-${index}`}>
                        {post.source === 'reddit' ? `r/${post.subreddit}` : post.user} • {post.time}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-discord-light-grey text-sm" data-testid={`text-post-engagement-${index}`}>
                      {post.engagement}
                    </p>
                    <Button variant="ghost" size="sm" data-testid={`button-view-post-${index}`}>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Content Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card className="discord-card">
            <div className="p-6 border-b border-discord-grey">
              <h3 className="text-lg font-semibold text-white">Top Performing Content</h3>
              <p className="text-discord-muted text-sm mt-1">Most engaged posts this week</p>
            </div>
            <div className="p-6 space-y-4">
              {[
                { title: "Epic Gaming Moment", reactions: 45, source: "reddit" },
                { title: "Programming Joke", reactions: 38, source: "reddit" },
                { title: "Tech Announcement", reactions: 32, source: "twitter" }
              ].map((content, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {content.source === 'reddit' ? 
                      <Vote className="w-4 h-4 text-orange-500" /> : 
                      <Twitter className="w-4 h-4 text-blue-500" />
                    }
                    <span className="text-white text-sm" data-testid={`text-top-content-${index}`}>
                      {content.title}
                    </span>
                  </div>
                  <span className="text-discord-primary font-medium" data-testid={`text-top-reactions-${index}`}>
                    {content.reactions} reactions
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="discord-card">
            <div className="p-6 border-b border-discord-grey">
              <h3 className="text-lg font-semibold text-white">Source Statistics</h3>
              <p className="text-discord-muted text-sm mt-1">Content sources breakdown</p>
            </div>
            <div className="p-6 space-y-4">
              {[
                { source: "Vote", posts: 18, percentage: 75 },
                { source: "Twitter", posts: 6, percentage: 25 }
              ].map((stat, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-white" data-testid={`text-source-name-${index}`}>
                      {stat.source}
                    </span>
                    <span className="text-discord-muted" data-testid={`text-source-posts-${index}`}>
                      {stat.posts} posts
                    </span>
                  </div>
                  <div className="w-full bg-discord-dark rounded-full h-2">
                    <div 
                      className="bg-discord-primary h-2 rounded-full" 
                      style={{ width: `${stat.percentage}%` }}
                      data-testid={`progress-source-${index}`}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
