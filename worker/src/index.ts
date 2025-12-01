import { Hono } from "hono";
import { cors } from "hono/cors";
import { DEFAULT_ORIGINS } from "./config";
import {
  calculateAggregateRankings,
  generateConversationTitle,
  runFullCouncil,
  stage1CollectResponses,
  stage2CollectRankings,
  stage3SynthesizeFinal
} from "./council";
import {
  addAssistantMessage,
  addUserMessage,
  ConversationDO,
  ConversationListDO,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateTitle
} from "./storage";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (DEFAULT_ORIGINS.includes(origin)) return origin;
      return origin;
    },
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"]
  })
);

app.get("/", (c) => c.json({ status: "ok", service: "LLM Council API" }));

app.get("/api/conversations", async (c) => {
  const conversations = await listConversations(c.env);
  return c.json(conversations);
});

app.post("/api/conversations", async (c) => {
  const conversation = await createConversation(c.env);
  return c.json(conversation);
});

app.get("/api/conversations/:id", async (c) => {
  const conversation = await getConversation(c.env, c.req.param("id"));
  if (!conversation) return c.json({ error: "Conversation not found" }, 404);
  return c.json(conversation);
});

app.delete("/api/conversations/:id", async (c) => {
  const id = c.req.param("id");
  await deleteConversation(c.env, id);
  return c.json({ ok: true });
});

app.post("/api/conversations/:id/message", async (c) => {
  const { content } = await safeJson(c);
  if (!content || typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }

  const conversationId = c.req.param("id");
  const conversation = await getConversation(c.env, conversationId);
  if (!conversation) return c.json({ error: "Conversation not found" }, 404);

  const isFirstMessage = conversation.messages.length === 0;
  await addUserMessage(c.env, conversationId, content);

  let title: string | null = null;
  if (isFirstMessage) {
    title = await generateConversationTitle(c.env, content);
    await updateTitle(c.env, conversationId, title);
  }

  const { stage1, stage2, stage3, metadata } = await runFullCouncil(c.env, content);
  await addAssistantMessage(c.env, conversationId, stage1, stage2, stage3);

  if (title) {
    metadata.title = title;
  }

  return c.json({ stage1, stage2, stage3, metadata });
});

app.post("/api/conversations/:id/message/stream", async (c) => {
  const { content } = await safeJson(c);
  if (!content || typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }

  const conversationId = c.req.param("id");
  const conversation = await getConversation(c.env, conversationId);
  if (!conversation) return c.json({ error: "Conversation not found" }, 404);

  const isFirstMessage = conversation.messages.length === 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        await addUserMessage(c.env, conversationId, content);
        const titlePromise = isFirstMessage ? generateConversationTitle(c.env, content) : null;

        send({ type: "stage1_start" });
        const stage1 = await stage1CollectResponses(c.env, content);
        send({ type: "stage1_complete", data: stage1 });

        send({ type: "stage2_start" });
        const { stage2, labelMap } = await stage2CollectRankings(c.env, content, stage1);
        const aggregateRankings = calculateAggregateRankings(stage2, labelMap);
        send({
          type: "stage2_complete",
          data: stage2,
          metadata: { label_to_model: labelMap, aggregate_rankings: aggregateRankings }
        });

        send({ type: "stage3_start" });
        const stage3 = await stage3SynthesizeFinal(c.env, content, stage1, stage2);
        send({ type: "stage3_complete", data: stage3 });

        if (titlePromise) {
          const title = await titlePromise;
          await updateTitle(c.env, conversationId, title);
          send({ type: "title_complete", data: { title } });
        }

        await addAssistantMessage(c.env, conversationId, stage1, stage2, stage3);
        send({ type: "complete" });
      } catch (err) {
        console.error("Stream error", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
});

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

async function safeJson(c: any) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export default app;
export { ConversationDO, ConversationListDO };
