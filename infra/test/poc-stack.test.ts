import { App, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { PocStack } from '../lib/poc-stack';

const props = {
  env: { account: '111111111111', region: 'ap-southeast-1' },
  projectName: 'happy-path',
  envName: 'dev',
};

describe('PocStack', () => {
  const template = Template.fromStack(new PocStack(new App(), 'test', props));

  it('passes cdk-nag AwsSolutions checks (synth fails on unacknowledged errors)', () => {
    const app = new App();
    Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
    new PocStack(app, 'nag', props);
    expect(() => app.synth()).not.toThrow();
  });

  it('creates an on-demand users table with point-in-time recovery', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
      Replicas: Match.arrayWith([
        Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }),
      ]),
    });
  });

  it('keeps the web bucket private and encrypted', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }) }),
        ],
      }),
    });
  });

  it('only forwards ALB traffic that carries the CloudFront origin-verify header', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      DefaultActions: [Match.objectLike({ Type: 'fixed-response', FixedResponseConfig: Match.objectLike({ StatusCode: '403' }) })],
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: [Match.objectLike({ Field: 'http-header', HttpHeaderConfig: Match.objectLike({ HttpHeaderName: 'X-Origin-Verify' }) })],
    });
  });

  it('injects secrets from Secrets Manager, not plain environment variables', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          Secrets: Match.arrayWith([Match.objectLike({ Name: 'JWT_SECRET' })]),
          Environment: Match.not(Match.arrayWith([Match.objectLike({ Name: 'JWT_SECRET' })])),
        }),
      ],
    });
  });
});
