import type {
  AssistantMessage,
  Conversation,
  ConversationMetadata,
  Env,
  Stage1Result,
  Stage2Result,
  Stage3Result
} from "./types";

const LIST_DO_NAME = "conversation_list";

export class ConversationDO {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const storage = this.state.storage;

    if (request.method === "POST" && url.pathname === "/init") {
      const body = (await request.json()) as { id: string; createdAt?: string; title?: string };
      const existing = await storage.get<Conversation>("conversation");
      if (existing) return json(existing);

      const conversation: Conversation = {
        id: body.id,
        createdAt: body.createdAt ?? new Date().toISOString(),
        title: body.title ?? "New Conversation",
        messages: []
      };

      await storage.put("conversation", conversation);
      return json(conversation);
    }

    if (request.method === "GET" && url.pathname === "/") {
      const conversation = await storage.get<Conversation>("conversation");
      if (!conversation) return new Response("Not found", { status: 404 });
      return json(conversation);
    }

    if (request.method === "POST" && url.pathname === "/save") {
      const conversation = (await request.json()) as Conversation;
      await storage.put("conversation", conversation);
      return new Response(null, { status: 204 });
    }

    if (request.method === "DELETE" && url.pathname === "/delete") {
      await storage.delete("conversation");
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

export class ConversationListDO {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const storage = this.state.storage;

    if (request.method === "GET" && url.pathname === "/list") {
      const list = (await storage.get<ConversationMetadata[]>("list")) ?? [];
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(list);
    }

    if (request.method === "PUT" && url.pathname === "/list") {
      const nextList = (await request.json()) as ConversationMetadata[];
      await storage.put("list", nextList);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/upsert") {
      const meta = (await request.json()) as ConversationMetadata;
      const list = (await storage.get<ConversationMetadata[]>("list")) ?? [];
      const existingIndex = list.findIndex((item) => item.id === meta.id);
      if (existingIndex >= 0) {
        list[existingIndex] = meta;
      } else {
        list.push(meta);
      }
      await storage.put("list", list);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/remove") {
      const { id } = (await request.json()) as { id: string };
      const list = (await storage.get<ConversationMetadata[]>("list")) ?? [];
      const updated = list.filter((item) => item.id !== id);
      await storage.put("list", updated);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

export async function createConversation(env: Env): Promise<Conversation> {
  const id = crypto.randomUUID();
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(id));
  const response = await stub.fetch("https://conversation/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  if (!response.ok) throw new Error("Failed to create conversation");
  const conversation = (await response.json()) as Conversation;
  await upsertMetadata(env, {
    id,
    createdAt: conversation.createdAt,
    title: conversation.title,
    messageCount: 0
  });
  return conversation;
}

export async function getConversation(env: Env, id: string): Promise<Conversation | null> {
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(id));
  const response = await stub.fetch("https://conversation/");
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to read conversation");
  return (await response.json()) as Conversation;
}

export async function saveConversation(env: Env, conversation: Conversation) {
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversation.id));
  const response = await stub.fetch("https://conversation/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conversation)
  });
  if (!response.ok) throw new Error("Failed to save conversation");

  await upsertMetadata(env, {
    id: conversation.id,
    createdAt: conversation.createdAt,
    title: conversation.title,
    messageCount: conversation.messages.length
  });
}

export async function listConversations(env: Env): Promise<ConversationMetadata[]> {
  const stub = env.CONVERSATION_LIST.get(env.CONVERSATION_LIST.idFromName(LIST_DO_NAME));
  const response = await stub.fetch("https://list/list");
  if (!response.ok) throw new Error("Failed to list conversations");
  return (await response.json()) as ConversationMetadata[];
}

export async function addUserMessage(env: Env, id: string, content: string) {
  const conversation = await getConversation(env, id);
  if (!conversation) return null;
  conversation.messages.push({ role: "user", content });
  await saveConversation(env, conversation);
  return conversation;
}

export async function addAssistantMessage(
  env: Env,
  id: string,
  stage1: Stage1Result[],
  stage2: Stage2Result[],
  stage3: Stage3Result
) {
  const conversation = await getConversation(env, id);
  if (!conversation) return null;

  const assistant: AssistantMessage = { role: "assistant", stage1, stage2, stage3 };
  conversation.messages.push(assistant);
  await saveConversation(env, conversation);
  return conversation;
}

export async function deleteConversation(env: Env, id: string) {
  const convStub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(id));
  await convStub.fetch("https://conversation/delete", { method: "DELETE" });

  const listStub = env.CONVERSATION_LIST.get(env.CONVERSATION_LIST.idFromName(LIST_DO_NAME));
  const listResp = await listStub.fetch("https://list/list");
  if (listResp.ok) {
    const list = (await listResp.json()) as ConversationMetadata[];
    const nextList = list.filter((item) => item.id !== id);
    await listStub.fetch("https://list/list", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextList)
    });
  }
}

export async function updateTitle(env: Env, id: string, title: string) {
  const conversation = await getConversation(env, id);
  if (!conversation) return null;
  conversation.title = title;
  await saveConversation(env, conversation);
  return conversation;
}

async function upsertMetadata(env: Env, meta: ConversationMetadata) {
  const stub = env.CONVERSATION_LIST.get(env.CONVERSATION_LIST.idFromName(LIST_DO_NAME));
  const response = await stub.fetch("https://list/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta)
  });
  if (!response.ok) throw new Error("Failed to upsert metadata");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
