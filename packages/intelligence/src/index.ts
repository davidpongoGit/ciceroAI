import { createHash } from 'node:crypto';
import {
  ChangeAssessmentSchema,
  SourceSnapshotSchema,
  type ChangeAssessment,
  type Scope,
  type SourceSnapshot,
} from '@cai/contracts';
import {
  PullRequestSourceSchema,
  IssueSourceSchema,
  type IssueSource,
  type PullRequestSource,
  type SourceProvider,
} from '@cai/integrations';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function minimiseSource(text: string): {
  text: string;
  redactions: number;
} {
  let redactions = 0;
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
    /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"',;]{8,}["']?/gi,
  ];
  for (const pattern of patterns)
    text = text.replace(pattern, () => {
      redactions++;
      return '[REDACTED]';
    });
  return { text, redactions };
}
export function issueKeys(text: string): string[] {
  return [
    ...new Set(text.match(/\b[A-Z][A-Z0-9]{1,19}-[1-9][0-9]{0,9}\b/g) ?? []),
  ].slice(0, 50);
}
export function sourceSnapshots(
  prInput: PullRequestSource,
  issueInputs: IssueSource[],
  observedAt = new Date().toISOString(),
): SourceSnapshot[] {
  const pr = PullRequestSourceSchema.parse(prInput);
  const issues = issueInputs.map((input) => IssueSourceSchema.parse(input));
  const prText = minimiseSource(pr.body);
  const prTitle = minimiseSource(pr.title);
  if (
    issues.some(
      (issue) =>
        issue.scope.organisationId !== pr.scope.organisationId ||
        issue.scope.repositoryId !== pr.scope.repositoryId,
    )
  )
    throw new Error('Source scope mismatch.');
  return [
    SourceSnapshotSchema.parse({
      scope: pr.scope,
      kind: 'github',
      reference: {
        sourceKey: `github:pr:${String(pr.number)}`,
        version: pr.headSha,
        contentHash: sha256(JSON.stringify(pr)),
      },
      canonicalUrl: pr.url,
      title: prTitle.text,
      text: prText.text,
      redactions: prText.redactions + prTitle.redactions,
      observedAt,
    }),
    ...issues.map((issue) => {
      const content = minimiseSource(issue.text);
      const title = minimiseSource(issue.title);
      return SourceSnapshotSchema.parse({
        scope: pr.scope,
        kind: 'jira',
        reference: {
          sourceKey: `jira:${issue.key}`,
          version: issue.version,
          contentHash: sha256(JSON.stringify(issue)),
        },
        canonicalUrl: issue.url,
        title: title.text,
        text: content.text,
        redactions: content.redactions + title.redactions,
        observedAt,
      });
    }),
  ];
}
export function analyseChange(
  pr: PullRequestSource,
  sources: SourceSnapshot[],
  missingKeys: string[] = [],
): ChangeAssessment {
  PullRequestSourceSchema.parse(pr);
  const requirements = new Map<
    string,
    ChangeAssessment['requirements'][number]
  >();
  const questions = missingKeys.map(
    (key) => `Requirement source ${key} is missing or inaccessible.`,
  );
  for (const input of sources) {
    const source = SourceSnapshotSchema.parse(input);
    if (
      source.scope.organisationId !== pr.scope.organisationId ||
      source.scope.repositoryId !== pr.scope.repositoryId
    )
      throw new Error('Source scope mismatch.');
    if (source.kind !== 'jira') continue;
    if (source.redactions)
      questions.push(
        `Sensitive-looking source content was removed from ${source.reference.sourceKey}; review the original under authorised access.`,
      );
    for (const line of source.text.split(/\r?\n/)) {
      const match =
        /^\s*(?:[-*]\s*)?(AC-[1-9][0-9]*|AC\[([A-Z][A-Z0-9_-]{0,99})\])\s*:\s*(.{1,5000})$/.exec(
          line,
        );
      if (!match?.[1] || !match[3]) continue;
      const id = match[2]
        ? `shared:${match[2]}`
        : `${source.reference.sourceKey}:${match[1]}`;
      const text = match[3].trim();
      const prior = requirements.get(id);
      if (prior) {
        prior.sources.push(source.reference);
        if (prior.text !== text) {
          prior.status = 'conflicted';
          questions.push(
            `Conflicting source statements for ${id}; a human must resolve the intended behaviour.`,
          );
        }
      } else {
        const ambiguous =
          text.includes('[REDACTED]') ||
          /\b(TBD|maybe|possibly|appropriate|as needed)\b/i.test(text) ||
          text.endsWith('?');
        requirements.set(id, {
          id,
          text,
          status: ambiguous ? 'ambiguous' : 'explicit',
          sources: [source.reference],
        });
        if (ambiguous)
          questions.push(`Clarify the observable expected outcome for ${id}.`);
      }
    }
  }
  if (requirements.size === 0)
    questions.push(
      'No supported explicitly labelled acceptance criteria were found.',
    );
  return ChangeAssessmentSchema.parse({
    scope: pr.scope,
    headSha: pr.headSha,
    sourceReferences: sources.map((s) => s.reference),
    requirements: [...requirements.values()],
    changedPaths: pr.files.map((file) => file.path),
    state: questions.length ? 'awaiting_clarification' : 'assessment_ready',
    questions: [...new Set(questions)],
    limitations: [
      'Only explicit AC-N: and AC[GLOBAL_ID]: lines are extracted; unlabelled prose remains unknown.',
      'Changed paths indicate impact candidates, not proof of implementation or verified coverage.',
      'No model inference or test execution was performed.',
    ],
    analysisVersion: 'deterministic-v1',
    policyVersion: 'supervised-v1',
  });
}
export async function collectAndAnalyse(
  provider: SourceProvider,
  scope: Scope,
  number: number,
  headSha: string,
) {
  const pr = await provider.getPullRequest(scope, number, headSha);
  const issues: IssueSource[] = [];
  const missing: string[] = [];
  for (const key of issueKeys(`${pr.title}\n${pr.body}`)) {
    try {
      issues.push(await provider.getIssue(scope, key));
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'missing' || error.code === 'denied')
      )
        missing.push(key);
      else throw error;
    }
  }
  const snapshots = sourceSnapshots(pr, issues);
  return { snapshots, report: analyseChange(pr, snapshots, missing) };
}
