import { queryClient } from './queryClient';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 1000;
  private currentGuildId: string | null = null;
  private currentUserId: string | null = null;

  connect(guildId: string, userId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }

    this.currentGuildId = guildId;
    this.currentUserId = userId;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Send join message
      this.send({
        type: 'join',
        guildId: this.currentGuildId,
        userId: this.currentUserId
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleMessage(message: WebSocketMessage) {
    switch (message.type) {
      case 'settingsUpdated':
        // Invalidate settings cache
        queryClient.invalidateQueries({ queryKey: ['/api/guilds', this.currentGuildId] });
        break;

      case 'feedCreated':
        // Invalidate feeds cache
        queryClient.invalidateQueries({ queryKey: ['/api/social', this.currentGuildId, 'feeds'] });
        break;

      case 'userLevelUp':
        // Invalidate levels cache
        queryClient.invalidateQueries({ queryKey: ['/api/levels', this.currentGuildId] });
        break;

      case 'moderationAction':
        // Invalidate moderation cache
        queryClient.invalidateQueries({ queryKey: ['/api/moderation', this.currentGuildId] });
        break;

      case 'raidAlert':
        // Show toast notification for raid alerts
        // This would integrate with the toast system
        console.warn('Raid alert:', message);
        break;

      default:
        console.log('Unknown WebSocket message type:', message.type);
    }
  }

  private attemptReconnect() {
    // Disable automatic reconnection to prevent spam
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      
      // Only attempt reconnect after a longer delay
      setTimeout(() => {
        if (this.currentGuildId && this.currentUserId) {
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          this.connect(this.currentGuildId, this.currentUserId);
        }
      }, 5000); // 5 second delay instead of exponential backoff
    }
  }

  send(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.currentGuildId = null;
    this.currentUserId = null;
  }
}

export const websocket = new WebSocketManager();
