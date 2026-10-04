// Session Manager for automatic session renewal and persistence

class SessionManager {
  private renewalInterval: number | null = null;
  private lastActivity: number = Date.now();
  private readonly RENEWAL_INTERVAL = 5 * 60 * 1000; // Renew every 5 minutes
  private readonly ACTIVITY_TIMEOUT = 25 * 60 * 1000; // 25 minutes (5 min before server timeout)
  
  constructor() {
    this.setupActivityTracking();
    this.startRenewalTimer();
  }

  private setupActivityTracking() {
    // Track user activity to keep session alive
    const activities = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const updateActivity = () => {
      this.lastActivity = Date.now();
    };

    activities.forEach(activity => {
      document.addEventListener(activity, updateActivity, { passive: true });
    });

    // Track page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.updateActivity();
      }
    });

    // Track navigation (page changes)
    window.addEventListener('popstate', this.updateActivity.bind(this));
  }

  private updateActivity() {
    this.lastActivity = Date.now();
    // Renew session immediately on activity if it's been a while
    const timeSinceActivity = Date.now() - this.lastActivity;
    if (timeSinceActivity > this.RENEWAL_INTERVAL) {
      this.renewSession();
    }
  }

  private startRenewalTimer() {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
    }

    this.renewalInterval = window.setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivity;
      
      // Only renew if user has been active recently
      if (timeSinceActivity < this.ACTIVITY_TIMEOUT) {
        this.renewSession();
      }
    }, this.RENEWAL_INTERVAL);
  }

  private async renewSession(): Promise<boolean> {
    try {
      console.log('[SESSION-RENEWAL] Renewing session...');
      
      // Make a simple request to renew the session
      const response = await fetch('/api/auth/status', {
        method: 'GET',
        credentials: 'include', // Important: include cookies
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.authenticated && data.sessionExtended) {
          console.log('[SESSION-RENEWAL] Session renewed successfully, expires in:', data.expiresIn, 'seconds');
          return true;
        } else if (!data.authenticated) {
          console.log('[SESSION-RENEWAL] User not authenticated, session ended');
          return false;
        }
      } else {
        console.warn('[SESSION-RENEWAL] Session renewal failed with status:', response.status);
        return false;
      }
    } catch (error) {
      console.error('[SESSION-RENEWAL] Error renewing session:', error);
      return false;
    }
    
    return false;
  }

  public async checkAuthStatus(): Promise<{ authenticated: boolean; user?: any }> {
    try {
      const response = await fetch('/api/auth/status', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      
      if (response.ok) {
        return await response.json();
      }
      
      return { authenticated: false };
    } catch (error) {
      console.error('[SESSION-CHECK] Error checking auth status:', error);
      return { authenticated: false };
    }
  }

  public forceRenewal(): Promise<boolean> {
    this.updateActivity();
    return this.renewSession();
  }

  public destroy() {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
      this.renewalInterval = null;
    }
  }
}

// Create singleton instance
const sessionManager = new SessionManager();

export default sessionManager;