import { App, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { GithubOidcStack } from '../lib/github-oidc-stack';

const props = {
  env: { account: '111111111111', region: 'ap-southeast-1' },
  projectName: 'happy-path',
  githubRepo: 'owner/repo',
  githubEnvironments: ['dev'],
};

describe('GithubOidcStack', () => {
  it('passes cdk-nag AwsSolutions checks', () => {
    const app = new App();
    Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
    new GithubOidcStack(app, 'nag', props);
    expect(() => app.synth()).not.toThrow();
  });

  it('trusts only the given repo environment, and only lets the role assume CDK bootstrap roles', () => {
    const template = Template.fromStack(new GithubOidcStack(new App(), 'test', props));
    template.resourceCountIs('AWS::IAM::OIDCProvider', 1);
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'happy-path-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': ['repo:owner/repo:environment:dev'],
              },
            },
          },
        ],
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({ Action: ['sts:AssumeRole', 'sts:TagSession'], Effect: 'Allow' }),
        ],
      },
    });
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain(':iam::111111111111:role/cdk-hnb659fds-*-111111111111-*');
  });

  it('reuses an existing OIDC provider when given', () => {
    const template = Template.fromStack(
      new GithubOidcStack(new App(), 'reuse', {
        ...props,
        existingProviderArn: 'arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com',
      }),
    );
    template.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });
});
