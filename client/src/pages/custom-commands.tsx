import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Layout from "@/components/layout";
import GuildSelector from "@/components/guild-selector";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Edit, Trash2, Command, Hash } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CustomCommand {
  id: string;
  name: string;
  description?: string;
  response: string;
  enabled: boolean;
  uses: number;
  createdAt: string;
}

const commandSchema = z.object({
  name: z.string()
    .min(1, "Command name is required")
    .max(32, "Command name must be 32 characters or less")
    .regex(/^[a-z0-9_-]+$/, "Only lowercase letters, numbers, hyphens, and underscores allowed"),
  description: z.string().max(100, "Description must be 100 characters or less").optional(),
  response: z.string()
    .min(1, "Response is required")
    .max(2000, "Response must be 2000 characters or less")
});

export default function CustomCommands() {
  const [selectedGuildId, setSelectedGuildId] = useState("123456789012345678");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<CustomCommand | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof commandSchema>>({
    resolver: zodResolver(commandSchema),
    defaultValues: {
      name: "",
      description: "",
      response: ""
    }
  });

  const { data: commands, isLoading } = useQuery<CustomCommand[]>({
    queryKey: ['/api/custom-commands', selectedGuildId],
    enabled: !!selectedGuildId,
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data: z.infer<typeof commandSchema>) => 
      fetch(`/api/custom-commands/${selectedGuildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-commands', selectedGuildId] });
      setIsCreateOpen(false);
      form.reset();
      toast({
        title: "Command created",
        description: "Your custom command has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create command. Please try again.",
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: z.infer<typeof commandSchema> }) => 
      fetch(`/api/custom-commands/${selectedGuildId}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-commands', selectedGuildId] });
      setEditingCommand(null);
      form.reset();
      toast({
        title: "Command updated",
        description: "Your custom command has been updated successfully.",
      });
    }
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => 
      fetch(`/api/custom-commands/${selectedGuildId}/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-commands', selectedGuildId] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => 
      fetch(`/api/custom-commands/${selectedGuildId}/${id}`, {
        method: 'DELETE'
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/custom-commands', selectedGuildId] });
      toast({
        title: "Command deleted",
        description: "The custom command has been deleted successfully.",
      });
    }
  });

  const handleSubmit = (data: z.infer<typeof commandSchema>) => {
    if (editingCommand) {
      updateMutation.mutate({ id: editingCommand.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (command: CustomCommand) => {
    setEditingCommand(command);
    form.reset({
      name: command.name,
      description: command.description || "",
      response: command.response
    });
    setIsCreateOpen(true);
  };

  const handleCloseDialog = () => {
    setIsCreateOpen(false);
    setEditingCommand(null);
    form.reset();
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white" data-testid="text-page-title">
              Custom Commands
            </h1>
            <p className="text-discord-muted mt-1">
              Create and manage custom commands for your server
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={handleCloseDialog}>
            <DialogTrigger asChild>
              <Button className="discord-button" data-testid="button-create-command">
                <Plus className="w-4 h-4 mr-2" />
                Create Command
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-discord-darker border-discord-grey">
              <DialogHeader>
                <DialogTitle className="text-white">
                  {editingCommand ? "Edit Command" : "Create New Command"}
                </DialogTitle>
                <DialogDescription className="text-discord-muted">
                  {editingCommand ? "Update your custom command." : "Create a new custom command for your server."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Command Name</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-discord-muted" />
                            <Input 
                              {...field} 
                              className="bg-discord-dark border-discord-grey text-white pl-10"
                              placeholder="mycommand"
                              data-testid="input-command-name"
                            />
                          </div>
                        </FormControl>
                        <FormDescription className="text-discord-muted text-sm">
                          Lowercase letters, numbers, hyphens, and underscores only
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Description (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            className="bg-discord-dark border-discord-grey text-white"
                            placeholder="What does this command do?"
                            data-testid="input-command-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="response"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Response</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            className="bg-discord-dark border-discord-grey text-white resize-none"
                            rows={4}
                            placeholder="The message the bot will send when this command is used"
                            data-testid="textarea-command-response"
                          />
                        </FormControl>
                        <FormDescription className="text-discord-muted text-sm">
                          You can use {"{user}"} to mention the command user
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end space-x-3 pt-4">
                    <Button 
                      type="button" 
                      variant="secondary" 
                      onClick={handleCloseDialog}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      className="discord-button"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-submit"
                    >
                      {editingCommand ? "Update Command" : "Create Command"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <GuildSelector 
          currentGuildId={selectedGuildId}
          onGuildChange={setSelectedGuildId}
        />

        <Card className="discord-card">
          <CardHeader>
            <CardTitle className="text-white flex items-center">
              <Command className="w-5 h-5 mr-2" />
              Server Commands
            </CardTitle>
            <CardDescription className="text-discord-muted">
              Manage custom commands for your server. Users can trigger these with the prefix !
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="text-discord-muted">Loading commands...</div>
              </div>
            ) : !commands || commands.length === 0 ? (
              <div className="text-center py-12">
                <Command className="w-12 h-12 text-discord-muted mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">No custom commands</h3>
                <p className="text-discord-muted mb-4">
                  Create your first custom command to get started
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-discord-grey hover:bg-discord-darker">
                      <TableHead className="text-discord-light-grey">Command</TableHead>
                      <TableHead className="text-discord-light-grey">Description</TableHead>
                      <TableHead className="text-discord-light-grey">Uses</TableHead>
                      <TableHead className="text-discord-light-grey">Status</TableHead>
                      <TableHead className="text-discord-light-grey">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commands.map((command) => (
                      <TableRow key={command.id} className="border-discord-grey hover:bg-discord-darker/50">
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <span className="text-discord-muted font-mono">!</span>
                            <span className="text-white font-medium" data-testid={`text-command-${command.id}`}>
                              {command.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-discord-light-grey text-sm" data-testid={`text-description-${command.id}`}>
                            {command.description || "No description"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-discord-grey text-discord-light-grey">
                            {command.uses}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={command.enabled}
                              onCheckedChange={(checked) => 
                                toggleMutation.mutate({ id: command.id, enabled: checked })
                              }
                              data-testid={`switch-enabled-${command.id}`}
                            />
                            <span className={`text-sm ${command.enabled ? 'text-discord-success' : 'text-discord-muted'}`}>
                              {command.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(command)}
                              className="text-discord-light-grey hover:text-white hover:bg-discord-grey"
                              data-testid={`button-edit-${command.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteMutation.mutate(command.id)}
                              className="text-discord-error hover:text-white hover:bg-discord-error/20"
                              data-testid={`button-delete-${command.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}