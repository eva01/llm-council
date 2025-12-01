export type Role = "user" | "assistant";

export type Stage1Result = {
  model: string;
  response: string;
};

export type Stage2Result = {
  model: string;
  ranking: string;
  parsedRanking: string[];
};

export type Stage3Result = {
  model: string;
  response: string;
};

export type AggregateRanking = {
  model: string;
  average_rank: number;
  rankings_count: number;
};

export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  stage1: Stage1Result[];
  stage2: Stage2Result[];
  stage3: Stage3Result;
};

export type Message = UserMessage | AssistantMessage;

export type Conversation = {
  id: string;
  createdAt: string;
  title: string;
  messages: Message[];
};

export type ConversationMetadata = {
  id: string;
  createdAt: string;
  title: string;
  messageCount: number;
};

export type LabelMap = Record<string, string>;

export type CouncilMetadata = {
  label_to_model?: LabelMap;
  aggregate_rankings?: AggregateRanking[];
  title?: string;
};

export type Env = {
  OPENROUTER_API_KEY: string;
  CONVERSATIONS: DurableObjectNamespace;
  CONVERSATION_LIST: DurableObjectNamespace;
};
