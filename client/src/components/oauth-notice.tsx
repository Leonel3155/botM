import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink, Shield } from "lucide-react";

export default function OAuthNotice() {
  const handleOAuthLogin = () => {
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=1407507947634032791&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}&response_type=code&scope=identify%20guilds`;
    window.location.href = oauthUrl;
  };

  return (
    <Alert className="mb-6 border-discord-warning/20 bg-discord-warning/10">
      <Shield className="h-4 w-4 text-discord-warning" />
      <AlertDescription className="flex items-center justify-between">
        <div className="text-discord-warning">
          <strong>Demo Mode:</strong> Connect your Discord account to see real server data
          <br />
          <small className="opacity-75">Try manual authentication if automatic OAuth fails</small>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleOAuthLogin}
            className="border-discord-warning text-discord-warning hover:bg-discord-warning/20"
            data-testid="button-discord-oauth"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Auto Connect
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => window.open('/auth/manual', '_blank')}
            className="border-discord-success text-discord-success hover:bg-discord-success/20"
            data-testid="button-discord-manual"
          >
            Manual Auth
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}