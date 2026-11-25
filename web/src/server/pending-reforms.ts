import type { PendingReform, PendingReformText } from '../domain/subject-map';
import config from './pending-reforms.json' with { type: 'json' };

/**
 * Reforms that were bills when the material was written. The material keeps current law as its main
 * text and carries the "if enacted" (and, if needed, "if rejected") text beside it. Which one applies is
 * set in one place, `pending-reforms.json` → `outcome`, so the material follows the bill's result
 * without rewriting topics or questions by hand.
 */
export type ReformOutcome = 'pending' | 'enacted' | 'rejected';
export type ReformId = keyof typeof config.reforms;
type ReformConfig = { title: string; outcome: ReformOutcome; status: Record<ReformOutcome, string> };
export const REFORMS = config.reforms as Record<ReformId, ReformConfig>;
export type ReformOutcomes = Partial<Record<string, ReformOutcome>>;
const configured = (): ReformOutcomes => Object.fromEntries(Object.entries(REFORMS).map(([id, reform]) => [id, reform.outcome]));

/** How a tree topic or question marks text that depends on a bill. */
export type ReformSource<T> = { id: string; ifEnacted: T; ifRejected?: Partial<T> };

function reformOf(id: string): ReformConfig {
  const reform = (REFORMS as Record<string, ReformConfig>)[id];
  if (!reform) throw new Error(`未登録の改正 ${id}`);
  return reform;
}

type TopicConcept = { definition: string; purpose: string; applicability: string; counterexample: string; misconception: string; examUse: string };
type ReformTopic = { summary: string; example?: string; concept: TopicConcept; pendingReform?: ReformSource<PendingReformText> };
type ResolvedTopic<T> = Omit<T, 'pendingReform'> & { pendingReform?: PendingReform };

/** Applies a reform to a tree topic: pending → current text plus a switchable "if enacted" version; decided → that text only. */
export function resolveTopicReform<T extends ReformTopic>(topic: T, outcomes: ReformOutcomes = configured()): ResolvedTopic<T> {
  const source = topic.pendingReform;
  if (!source) return topic as ResolvedTopic<T>;
  const { pendingReform: _source, ...rest } = topic;
  const reform = reformOf(source.id);
  const outcome = outcomes[source.id] ?? reform.outcome;
  if (outcome === 'pending') return { ...rest, pendingReform: { title: reform.title, status: reform.status.pending, ifEnacted: source.ifEnacted } } as ResolvedTopic<T>;
  const text: PendingReformText = outcome === 'enacted' ? source.ifEnacted : source.ifRejected ?? {};
  const { summary, example, ...conceptText } = text;
  return { ...rest, ...(summary ? { summary } : {}), ...(example ? { example } : {}), concept: { ...topic.concept, ...conceptText } } as ResolvedTopic<T>;
}

/** Applies a reform to a question. While the bill is pending the question stays on current law. */
export function resolveItemReform<T extends { pendingReform?: ReformSource<Partial<T>> }>(item: T, outcomes: ReformOutcomes = configured()): Omit<T, 'pendingReform'> {
  const source = item.pendingReform;
  if (!source) return item;
  const { pendingReform: _source, ...rest } = item;
  const outcome = outcomes[source.id] ?? reformOf(source.id).outcome;
  if (outcome === 'enacted') return { ...rest, ...source.ifEnacted } as Omit<T, 'pendingReform'>;
  if (outcome === 'rejected') return { ...rest, ...source.ifRejected } as Omit<T, 'pendingReform'>;
  return rest;
}
