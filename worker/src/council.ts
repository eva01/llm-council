import { CHAIRMAN_FALLBACKS, CHAIRMAN_MODEL, COUNCIL_MODELS, TITLE_MODEL } from "./config";
import { queryModel, queryModelsParallel } from "./openrouter";
import type {
  AggregateRanking,
  CouncilMetadata,
  Env,
  LabelMap,
  Stage1Result,
  Stage2Result,
  Stage3Result
} from "./types";

export async function stage1CollectResponses(env: Env, userQuery: string): Promise<Stage1Result[]> {
  const messages = [{ role: "user", content: userQuery }];
  const responses = await queryModelsParallel(env, COUNCIL_MODELS, messages);

  const stage1: Stage1Result[] = [];
  for (const model of COUNCIL_MODELS) {
    const response = responses[model];
    if (response) {
      stage1.push({ model, response: response.content ?? "" });
    }
  }
  return stage1;
}

export async function stage2CollectRankings(
  env: Env,
  userQuery: string,
  stage1Results: Stage1Result[]
): Promise<{ stage2: Stage2Result[]; labelMap: LabelMap }> {
  const labels = stage1Results.map((_, i) => String.fromCharCode(65 + i)); // A, B, ...
  const labelMap: LabelMap = Object.fromEntries(
    labels.map((label, i) => [`Response ${label}`, stage1Results[i].model])
  );

  const responsesText = labels
    .map((label, i) => `Response ${label}:\n${stage1Results[i].response}`)
    .join("\n\n");

  const rankingPrompt = `You are evaluating different responses to the following question:

Question: ${userQuery}

Here are the responses from different models (anonymized):

${responsesText}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:`;

  const messages = [{ role: "user", content: rankingPrompt }];
  const responses = await queryModelsParallel(env, COUNCIL_MODELS, messages);

  const stage2: Stage2Result[] = [];
  for (const model of COUNCIL_MODELS) {
    const response = responses[model];
    if (response) {
      const fullText = response.content ?? "";
      stage2.push({
        model,
        ranking: fullText,
        parsedRanking: parseRankingFromText(fullText)
      });
    }
  }

  return { stage2, labelMap };
}

export async function stage3SynthesizeFinal(
  env: Env,
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[]
): Promise<Stage3Result> {
  const stage1Text = stage1Results
    .map((result) => `Model: ${result.model}\nResponse: ${result.response}`)
    .join("\n\n");

  const stage2Text = stage2Results
    .map((result) => `Model: ${result.model}\nRanking: ${result.ranking}`)
    .join("\n\n");

  const chairmanPrompt = `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;

  const messages = [{ role: "user", content: chairmanPrompt }];
  const candidates = [CHAIRMAN_MODEL, ...CHAIRMAN_FALLBACKS];

  for (const model of candidates) {
    const response = await queryModel(env, model, messages);
    if (response) {
      return { model, response: response.content ?? "" };
    }
  }

  return {
    model: CHAIRMAN_MODEL,
    response: "Error: Unable to generate final synthesis (all chairman models failed)."
  };
}

export async function generateConversationTitle(env: Env, userQuery: string) {
  const titlePrompt = `Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: ${userQuery}

Title:`;

  const messages = [{ role: "user", content: titlePrompt }];
  const response = await queryModel(env, TITLE_MODEL, messages, 30_000);

  if (!response) return "New Conversation";

  let title = (response.content ?? "New Conversation").trim().replace(/^["']|["']$/g, "");
  if (title.length > 50) title = `${title.slice(0, 47)}...`;
  return title;
}

export function parseRankingFromText(rankingText: string): string[] {
  const rankingSection = rankingText.split("FINAL RANKING:")[1];
  const target = rankingSection ?? rankingText;

  const numbered = [...target.matchAll(/\d+\.\s*(Response [A-Z])/g)].map((m) => m[1]);
  if (numbered.length) return numbered;

  const fallback = [...target.matchAll(/Response [A-Z]/g)].map((m) => m[0]);
  return fallback;
}

export function calculateAggregateRankings(
  stage2Results: Stage2Result[],
  labelMap: LabelMap
): AggregateRanking[] {
  const modelPositions: Record<string, number[]> = {};

  for (const ranking of stage2Results) {
    const parsed = ranking.parsedRanking;
    parsed.forEach((label, i) => {
      const model = labelMap[label];
      if (!model) return;
      if (!modelPositions[model]) modelPositions[model] = [];
      modelPositions[model].push(i + 1);
    });
  }

  const aggregate = Object.entries(modelPositions).map(([model, positions]) => {
    const avg = positions.reduce((sum, p) => sum + p, 0) / positions.length;
    return { model, average_rank: Number(avg.toFixed(2)), rankings_count: positions.length };
  });

  aggregate.sort((a, b) => a.average_rank - b.average_rank);
  return aggregate;
}

export async function runFullCouncil(env: Env, userQuery: string): Promise<{
  stage1: Stage1Result[];
  stage2: Stage2Result[];
  stage3: Stage3Result;
  metadata: CouncilMetadata;
}> {
  const stage1 = await stage1CollectResponses(env, userQuery);
  if (!stage1.length) {
    return {
      stage1: [],
      stage2: [],
      stage3: { model: "error", response: "All models failed to respond. Please try again." },
      metadata: {}
    };
  }

  const { stage2, labelMap } = await stage2CollectRankings(env, userQuery, stage1);
  const aggregateRankings = calculateAggregateRankings(stage2, labelMap);
  const stage3 = await stage3SynthesizeFinal(env, userQuery, stage1, stage2);

  return {
    stage1,
    stage2,
    stage3,
    metadata: { label_to_model: labelMap, aggregate_rankings: aggregateRankings }
  };
}
