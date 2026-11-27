#!/usr/bin/env node
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { PocStack } from '../lib/poc-stack';

const app = new App();
const ctx = (key: string): string | undefined => {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

const projectName = ctx('projectName') ?? 'happy-path';
const envName = ctx('env') ?? 'dev';
if (!['dev', 'uat', 'prod'].includes(envName)) {
  throw new Error(`Unknown env "${envName}". Use -c env=dev|uat|prod`);
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  // ap-southeast-1 is blocked by an organization SCP for this account.
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// The application: `cdk deploy happy-path-dev` (CI does this on every push to main).
new PocStack(app, `${projectName}-${envName}`, {
  env,
  projectName,
  envName,
  googleSecretName: ctx('googleSecretName'),
  albCertificateArn: ctx('albCertificateArn'),
  apiOriginDomain: ctx('apiOriginDomain'),
});

// One-time, per AWS account: `cdk deploy happy-path-github-oidc` from a laptop after `aws login`.
const githubRepo = ctx('githubRepo');
if (githubRepo) {
  new GithubOidcStack(app, `${projectName}-github-oidc`, {
    env,
    projectName,
    githubRepo,
    githubEnvironments: (ctx('githubEnvironments') ?? 'dev').split(',').map((e) => e.trim()),
    existingProviderArn: ctx('githubOidcProviderArn'),
  });
}

const tags = (app.node.tryGetContext('tags') ?? {}) as Record<string, string>;
for (const [key, value] of Object.entries(tags)) Tags.of(app).add(key, value);
Tags.of(app).add('Project', projectName);
Tags.of(app).add('Environment', envName);

// cdk-nag v3 (CDK policy validation): synth fails on unacknowledged AwsSolutions errors.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
