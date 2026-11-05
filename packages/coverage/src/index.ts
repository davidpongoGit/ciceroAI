import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {
  AssertionMappingSchema,
  RunEvidenceSchema,
  TestAssetSchema,
  type Assertion,
  type AssertionMapping,
  type ChangeAssessment,
  type RunEvidence,
  type Scope,
  type TestAsset,
} from '@cai/contracts';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function assertionHash(assertion: Assertion): string {
  return hash(
    JSON.stringify({
      target: assertion.target,
      matcher: assertion.matcher,
      expected: assertion.expected,
      negated: assertion.negated,
    }),
  );
}
export function criterionHash(
  criterion: ChangeAssessment['requirements'][number],
): string {
  return hash(JSON.stringify(criterion));
}
export function safeRepositoryPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.startsWith('/') &&
    !value.split('/').some((part) => part === '..' || part === '.' || !part)
  );
}
function literal(node: ts.Expression | undefined): {
  supported: boolean;
  value: Assertion['expected'];
} {
  if (!node) return { supported: false, value: null };
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return { supported: true, value: node.text };
  if (ts.isNumericLiteral(node))
    return { supported: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword)
    return { supported: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword)
    return { supported: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return { supported: true, value: null };
  return { supported: false, value: null };
}
export function inventoryFile(
  scope: Scope,
  filePath: string,
  code: string,
  testRevisionSha: string,
): TestAsset[] {
  if (!safeRepositoryPath(filePath) || Buffer.byteLength(code) > 1_048_576)
    throw new Error('Unsupported test path or size.');
  const file = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Map<string, string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@playwright/test'
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        names.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text,
        );
  }
  const testNames = [...names]
    .filter(([, original]) => original === 'test')
    .map(([alias]) => alias);
  const expectNames = [...names]
    .filter(([, original]) => original === 'expect')
    .map(([alias]) => alias);
  const assets: TestAsset[] = [];
  function visit(node: ts.Node, group: string, skipped: boolean): void {
    if (ts.isCallExpression(node)) {
      const fn = node.expression;
      let rootExpression = fn;
      const modifiers: string[] = [];
      while (ts.isPropertyAccessExpression(rootExpression)) {
        modifiers.unshift(rootExpression.name.text);
        rootExpression = rootExpression.expression;
      }
      const root = ts.isIdentifier(rootExpression) ? rootExpression.text : '';
      const modifier = modifiers.join('.');
      const title = node.arguments[0];
      const callback = node.arguments[node.arguments.length - 1];
      if (
        testNames.includes(root) &&
        title &&
        ts.isStringLiteral(title) &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        if (modifiers[0] === 'describe') {
          ts.forEachChild(callback, (child) => {
            visit(
              child,
              `${group}${title.text} › `,
              skipped ||
                modifiers.includes('skip') ||
                modifiers.includes('fixme'),
            );
          });
          return;
        }
        if (!['', 'only', 'skip', 'fixme'].includes(modifier)) return;
        const assertions: Assertion[] = [];
        const limitations: string[] = [];
        function inspect(child: ts.Node): void {
          if (
            ts.isCallExpression(child) &&
            ts.isPropertyAccessExpression(child.expression)
          ) {
            const matcher = child.expression.name.text;
            let target = child.expression.expression;
            let negated = false;
            if (
              ts.isPropertyAccessExpression(target) &&
              target.name.text === 'not'
            ) {
              negated = true;
              target = target.expression;
            }
            if (
              ts.isCallExpression(target) &&
              ts.isIdentifier(target.expression) &&
              expectNames.includes(target.expression.text)
            ) {
              const expected = literal(child.arguments[0]);
              const actual = target.arguments[0];
              const awaited =
                ['toBe', 'toEqual'].includes(matcher) ||
                ts.isAwaitExpression(child.parent) ||
                ts.isReturnStatement(child.parent);
              const supported =
                awaited &&
                expected.supported &&
                !!actual &&
                !literal(actual).supported &&
                [
                  'toBe',
                  'toEqual',
                  'toHaveText',
                  'toContainText',
                  'toHaveValue',
                  'toHaveCount',
                ].includes(matcher);
              assertions.push({
                line:
                  file.getLineAndCharacterOfPosition(child.getStart(file))
                    .line + 1,
                target: actual?.getText(file) ?? '',
                matcher,
                expected: expected.value,
                negated,
                supported,
              });
              if (!supported)
                limitations.push(
                  'Unsupported matcher/expression or constant-only assertion; cannot establish coverage.',
                );
            }
          }
          ts.forEachChild(child, inspect);
        }
        inspect(callback.body);
        const line =
          file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        assets.push(
          TestAssetSchema.parse({
            id: `${filePath}:${String(line)}`,
            scope,
            path: filePath,
            title: group + title.text,
            fileHash: hash(code),
            testRevisionSha,
            line,
            skipped: skipped || modifier === 'skip' || modifier === 'fixme',
            assertions,
            limitations,
          }),
        );
        return;
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, group, skipped);
    });
  }
  visit(file, '', false);
  return assets;
}

export async function discoverPlaywright(
  rootInput: string,
  scope: Scope,
  testRevisionSha: string,
) {
  const root = await realpath(rootInput);
  const files: { path: string; code: string }[] = [];
  let scanned = 0;
  let bytes = 0;
  const configs: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++scanned > 5000)
        throw new Error('Repository discovery file budget exceeded.');
      if (entry.isSymbolicLink())
        throw new Error('Symlinks are not supported during test discovery.');
      if (
        [
          'node_modules',
          '.git',
          'dist',
          'runtime-data',
          'artifacts',
          'coverage',
        ].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (/^playwright\.config\.[cm]?[jt]s$/.test(entry.name))
        configs.push(relative);
      if (!/\.(spec|test)\.[cm]?tsx?$/.test(entry.name)) continue;
      const resolved = await realpath(absolute);
      if (
        !resolved.startsWith(root + path.sep) ||
        (await lstat(absolute)).isSymbolicLink()
      )
        throw new Error('Test path escaped the selected repository.');
      const info = await lstat(resolved);
      if (info.size > 1_048_576)
        throw new Error('Test file byte budget exceeded.');
      const code = await readFile(resolved, 'utf8');
      bytes += Buffer.byteLength(code);
      if (bytes > 20_971_520)
        throw new Error('Repository discovery byte budget exceeded.');
      files.push({ path: relative, code });
    }
  }
  await walk(root);
  return {
    configs,
    tests: files.flatMap((file) =>
      inventoryFile(scope, file.path, file.code, testRevisionSha),
    ),
    limitations: [
      'Configuration is discovered as text, never evaluated. Only direct @playwright/test imports and literal test titles/assertion values are supported. Custom fixtures, dynamic tests and hooks require human review.',
    ],
  };
}

export interface CoverageDecision {
  state:
    | 'unknown'
    | 'candidate'
    | 'gap'
    | 'implemented_unverified'
    | 'verified'
    | 'failed'
    | 'stale'
    | 'blocked';
  action: 'reuse' | 'update' | 'create';
  reason: string;
  testId: string | null;
}
export function assessCoverage(
  criterion: ChangeAssessment['requirements'][number],
  tests: TestAsset[],
  mappingInput: AssertionMapping | null,
  evidenceInput: RunEvidence | null,
  target: {
    scope: Scope;
    appSha: string;
    environment: string;
    testRevisionSha: string;
    allowTrustedSynthetic: boolean;
  },
): CoverageDecision {
  const decision = (
    state: CoverageDecision['state'],
    action: CoverageDecision['action'],
    reason: string,
    testId: string | null = null,
  ): CoverageDecision => ({ state, action, reason, testId });
  if (criterion.status !== 'explicit')
    return decision(
      'unknown',
      'create',
      'Requirement is ambiguous or conflicted.',
    );
  if (!mappingInput)
    return tests.some((test) => test.title.includes(criterion.id))
      ? decision(
          'candidate',
          'update',
          'A related title is a candidate only; no reviewed assertion mapping exists.',
        )
      : decision('gap', 'create', 'No reviewed assertion mapping exists.');
  const mapping = AssertionMappingSchema.parse(mappingInput);
  if (
    mapping.criterionId !== criterion.id ||
    mapping.criterionHash !== criterionHash(criterion)
  )
    return decision(
      'stale',
      'update',
      'Mapping belongs to an obsolete requirement version.',
    );
  const test = tests.find((item) => item.id === mapping.testId);
  if (!test) return decision('gap', 'create', 'Mapped test is missing.');
  TestAssetSchema.parse(test);
  if (
    test.scope.organisationId !== target.scope.organisationId ||
    test.scope.repositoryId !== target.scope.repositoryId
  )
    return decision('unknown', 'create', 'Test outside authorised scope.');
  if (
    test.skipped ||
    !test.assertions.some(
      (assertion) =>
        assertion.supported &&
        assertionHash(assertion) === mapping.assertionHash,
    )
  )
    return decision(
      'candidate',
      'update',
      'No supported meaningful mapped assertion is active.',
      test.id,
    );
  if (!evidenceInput)
    return decision(
      'implemented_unverified',
      'reuse',
      'Reviewed assertion exists but no applicable execution evidence exists.',
      test.id,
    );
  const evidence = RunEvidenceSchema.parse(evidenceInput);
  if (
    evidence.scope.organisationId !== target.scope.organisationId ||
    evidence.scope.repositoryId !== target.scope.repositoryId ||
    evidence.appSha !== target.appSha ||
    evidence.environment !== target.environment ||
    evidence.fileHash !== test.fileHash ||
    evidence.testRevisionSha !== target.testRevisionSha ||
    test.testRevisionSha !== target.testRevisionSha ||
    evidence.testId !== test.id ||
    evidence.criterionHash !== mapping.criterionHash ||
    !evidence.assertionHashes.includes(mapping.assertionHash)
  )
    return decision(
      'stale',
      'reuse',
      'Execution does not match exact requirement/test/build/environment scope.',
      test.id,
    );
  if (evidence.origin === 'trusted-synthetic' && !target.allowTrustedSynthetic)
    return decision(
      'unknown',
      'reuse',
      'Synthetic-only execution cannot verify customer code.',
      test.id,
    );
  if (evidence.outcome === 'environment_failure')
    return decision(
      'blocked',
      'reuse',
      'Environment failure does not establish a product regression.',
      test.id,
    );
  return evidence.outcome === 'passed'
    ? decision(
        'verified',
        'reuse',
        'Reviewed mapped assertion passed on the exact target versions.',
        test.id,
      )
    : decision(
        'failed',
        'reuse',
        'Mapped assertion failed on the exact target versions.',
        test.id,
      );
}
