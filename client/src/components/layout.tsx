import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import Sidebar from "./sidebar";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { websocket } from "@/lib/websocket";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentGuild, setCurrentGuild] = useState("123456789012345678"); // Mock guild ID
  const [currentUser] = useState("987654321098765432"); // Mock user ID
  const [location] = useLocation();

  useEffect(() => {
    // Connect to WebSocket when component mounts
    websocket.connect(currentGuild, currentUser);
    
    return () => {
      websocket.disconnect();
    };
  }, [currentGuild, currentUser]);

  const getPageTitle = () => {
    switch (location) {
      case "/": return "Dashboard Overview";
      case "/levels": return "Level System";
      case "/economy": return "Economy System";
      case "/moderation": return "Moderation Tools";
      case "/protection": return "Server Protection";
      case "/social": return "Social Content";
      default: return "Dashboard";
    }
  };

  const getPageDescription = () => {
    switch (location) {
      case "/": return "Managing Awesome Gaming Server";
      case "/levels": return "XP and leveling system configuration";
      case "/economy": return "Virtual currency and rewards management";
      case "/moderation": return "Server moderation and anti-spam controls";
      case "/protection": return "Security, roles, and server protection settings";
      case "/social": return "Social media content feeds and automation";
      default: return "";
    }
  };

  return (
    <div className="min-h-screen bg-discord-darker text-white">
      {/* Mobile Header */}
      <div className="lg:hidden bg-discord-dark border-b border-discord-grey p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img 
            src="https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?ixlib=rb-4.0.3&auto=format&fit=crop&w=64&h=64" 
            alt="Bot Avatar" 
            className="w-8 h-8 rounded-full"
          />
          <h1 className="text-lg font-semibold">Bot Dashboard</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-discord-light-grey hover:text-white"
          data-testid="button-mobile-menu"
        >
          {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      <div className="flex h-screen lg:h-auto">
        {/* Sidebar */}
        <Sidebar 
          isOpen={sidebarOpen} 
          onClose={() => setSidebarOpen(false)}
          currentGuild={currentGuild}
          onGuildChange={setCurrentGuild}
        />

        {/* Sidebar Overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Desktop Header */}
          <header className="bg-discord-dark border-b border-discord-grey p-6 hidden lg:block">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white" data-testid="text-page-title">
                  {getPageTitle()}
                </h1>
                <p className="text-discord-muted mt-1" data-testid="text-page-description">
                  {getPageDescription()}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-discord-grey px-3 py-2 rounded-lg">
                  <div className="w-3 h-3 bg-discord-success rounded-full"></div>
                  <span className="text-sm text-discord-light-grey">Bot Online</span>
                </div>
                <Button 
                  className="discord-button"
                  data-testid="button-refresh-data"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Data
                </Button>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-6 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
