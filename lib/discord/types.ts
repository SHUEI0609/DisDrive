export type DiscordInteraction = {
  id: string;
  application_id?: string;
  token: string;
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: Array<{
      name: string;
      type: number;
      value?: string | number | boolean;
    }>;
  };
  member?: {
    user?: {
      id: string;
      username?: string;
      avatar?: string | null;
    };
  };
  user?: {
    id: string;
    username?: string;
    avatar?: string | null;
  };
  guild_id?: string;
  channel_id?: string;
  message?: {
    content?: string;
  };
};

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  UpdateMessage: 7,
} as const;

export const MessageFlags = {
  Ephemeral: 64,
} as const;
