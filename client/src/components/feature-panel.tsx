import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface FeaturePanelProps {
  title: string;
  description?: string;
  status?: "active" | "inactive" | "warning";
  statusText?: string;
  children: ReactNode;
  onConfigure?: () => void;
  className?: string;
  'data-testid'?: string;
}

const statusColors = {
  active: "bg-discord-success text-discord-darker",
  inactive: "bg-discord-muted text-white",
  warning: "bg-discord-warning text-discord-darker",
};

export default function FeaturePanel({ 
  title, 
  description, 
  status = "active", 
  statusText,
  children, 
  onConfigure,
  className,
  'data-testid': testId
}: FeaturePanelProps) {
  return (
    <div className={cn("feature-panel", className)} data-testid={testId}>
      <div className="feature-panel-header">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white" data-testid={`text-${testId}-title`}>
              {title}
            </h3>
            {description && (
              <p className="text-discord-muted text-sm mt-1" data-testid={`text-${testId}-description`}>
                {description}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {statusText && (
              <span 
                className={cn(
                  "text-xs px-2 py-1 rounded-full font-medium",
                  statusColors[status]
                )}
                data-testid={`text-${testId}-status`}
              >
                {statusText}
              </span>
            )}
            {onConfigure && (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={onConfigure}
                className="text-discord-muted hover:text-white"
                data-testid={`button-${testId}-configure`}
              >
                <Settings className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="feature-panel-content">
        {children}
      </div>
    </div>
  );
}
