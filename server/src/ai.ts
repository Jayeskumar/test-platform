/**
 * Optional AI code review of a candidate's attempt, powered by Claude.
 * Enabled only when ANTHROPIC_API_KEY is set; nothing is sent otherwise.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { config } from './config.js';

const Rating = z.enum(['strong', 'solid', 'mixed', 'weak']);

export const AiReviewSchema = z.object({
  summary: z.string().describe('Two or three sentences for the hiring manager.'),
  recommendation: z.enum(['strong_yes', 'yes', 'lean_no', 'no']),
  questions: z.array(
    z.object({
      questionId: z.number(),
      correctness: Rating,
      efficiency: Rating,
      codeQuality: Rating,
      notes: z.string().describe('Specific observations grounded in the code.'),
    }),
  ),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  followUpQuestions: z.array(z.string()).describe('Questions to ask in the next interview round.'),
});

export type AiReview = z.infer<typeof AiReviewSchema>;

export interface ReviewInput {
  assessmentTitle: string;
  questions: {
    id: number;
    title: string;
    type: string;
    statement: string;
    points: number;
    score: number;
    language?: string | null;
    code?: string | null;
    verdict?: string | null;
    passed?: number;
    total?: number;
    complexity?: { estimate: string; expected: string; meetsTarget: boolean } | null;
  }[];
}

const SYSTEM = `You review technical assessment submissions for a hiring team.
Judge each solution on correctness (does the approach solve the problem, judging by the code and the test results),
efficiency (time and space complexity relative to the constraints), and code quality (readability, structure, edge cases).
Ground every claim in the code you are shown. Be fair, specific and concise; do not speculate about the candidate as a person.
Test results come from an automated judge and are reliable. A question with no code means the candidate did not attempt it.`;

let client: Anthropic | null = null;

export function aiEnabled() {
  return !!config.anthropicKey;
}

export async function reviewAttempt(input: ReviewInput): Promise<AiReview> {
  if (!aiEnabled()) throw new Error('AI review is not configured (set ANTHROPIC_API_KEY).');
  client ??= new Anthropic({ apiKey: config.anthropicKey });

  const body = input.questions
    .filter((q) => q.type !== 'mcq')
    .map((q) => {
      const results = q.verdict
        ? `Judge result: ${q.verdict}, ${q.passed}/${q.total} tests passed, score ${q.score}/${q.points}.`
        : 'Not judged.';
      const cx = q.complexity ? `Measured complexity: ${q.complexity.estimate} (target ${q.complexity.expected}).` : '';
      return `<question id="${q.id}" title="${q.title}" type="${q.type}">
<statement>
${q.statement.slice(0, 6000)}
</statement>
${results} ${cx}
<submission language="${q.language ?? 'none'}">
${q.code?.slice(0, 20000) || '(no code submitted)'}
</submission>
</question>`;
    })
    .join('\n\n');

  const response = await client.beta.messages.parse({
    model: config.aiModel,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(AiReviewSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Assessment: ${input.assessmentTitle}\n\n${body}\n\nReview every question listed above (use its id as questionId).`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI reviewer declined to review this attempt.');
  }
  if (!response.parsed_output) throw new Error('The AI reviewer returned an unexpected response.');
  return response.parsed_output;
}
