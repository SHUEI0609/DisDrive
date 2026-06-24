export type DiscordInteraction = {
  id: string;
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
};

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  UpdateMessage: 7,
} as const;

export const MessageFlags = {
  Ephemeral: 64,
} as const;
