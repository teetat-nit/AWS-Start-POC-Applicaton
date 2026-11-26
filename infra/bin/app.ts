#!/usr/bin/env node
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { PocStack } from '../lib/poc-stack';

const app = new App();
const ctx = (key: string): string | undefined => {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

const envName = ctx('env') ?? 'dev';
if (!['dev', 'uat', 'prod'].includes(envName)) {
  throw new Error(`Unknown env "${envName}". Use -c env=dev|uat|prod`);
}

new PocStack(app, `aws-start-poc-${envName}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-1',
  },
  envName,
  googleSecretName: ctx('googleSecretName'),
  albCertificateArn: ctx('albCertificateArn'),
  apiOriginDomain: ctx('apiOriginDomain'),
});

const tags = (app.node.tryGetContext('tags') ?? {}) as Record<string, string>;
for (const [key, value] of Object.entries(tags)) Tags.of(app).add(key, value);
Tags.of(app).add('Environment', envName);

// cdk-nag v3 (CDK policy validation): synth fails on unacknowledged AwsSolutions errors.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
