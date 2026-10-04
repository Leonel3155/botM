import { AlertCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AuthRequiredProps {
  message?: string;
  onAuth?: () => void;
}

export function AuthRequired({ message = "Authentication required to view real Discord data", onAuth }: AuthRequiredProps) {
  const handleAuth = () => {
    window.location.href = '/auth/manual';
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="w-16 h-16 bg-discord-primary/10 rounded-full flex items-center justify-center mb-6">
        <LogIn className="w-8 h-8 text-discord-primary" />
      </div>
      
      <h2 className="text-2xl font-bold text-white mb-4">
        Discord Authentication Required
      </h2>
      
      <p className="text-discord-light-grey mb-6 max-w-md">
        {message}
      </p>
      
      <Alert className="mb-6 max-w-md bg-yellow-500/10 border-yellow-500/20">
        <AlertCircle className="h-4 w-4 text-yellow-500" />
        <AlertDescription className="text-yellow-100">
          This ensures you see your real Discord servers and data instead of placeholder information.
        </AlertDescription>
      </Alert>
      
      <div className="space-y-3">
        <Button 
          onClick={onAuth || handleAuth}
          className="bg-discord-primary hover:bg-discord-primary/90 text-white px-8 py-2"
          data-testid="button-authenticate"
        >
          <LogIn className="w-4 h-4 mr-2" />
          Authenticate with Discord
        </Button>
        
        <p className="text-sm text-discord-muted">
          You'll be redirected to Discord to authorize access to your servers
        </p>
      </div>
    </div>
  );
}