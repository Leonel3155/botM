import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { SiDiscord } from "react-icons/si";

export default function Login() {
  const handleDiscordLogin = () => {
    // In production, this would redirect to Discord OAuth
    // For now, we'll just redirect to the dashboard
    window.location.href = "/api/auth/discord";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary">
              <Activity className="h-10 w-10 text-primary-foreground" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl">Discord Bot Dashboard</CardTitle>
            <CardDescription className="mt-2">
              Sign in with Discord to manage your bot
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleDiscordLogin}
            className="w-full gap-2 h-12 text-base"
            size="lg"
            data-testid="button-discord-login"
          >
            <SiDiscord className="h-5 w-5" />
            Login with Discord
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-6">
            By logging in, you agree to allow this dashboard to access your Discord account information
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
