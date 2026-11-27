import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps, Validations, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

export interface GithubOidcStackProps extends StackProps {
  projectName: string;
  /** "owner/repo" allowed to assume the deploy role. */
  githubRepo: string;
  /**
   * Start of the token's `sub` claim, as GitHub reports it for the repo:
   * `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` → sub_claim_prefix.
   * Repos using immutable subjects look like "repo:owner@123/repo@456". Default: "repo:<githubRepo>".
   */
  githubSubjectPrefix?: string;
  /** GitHub Actions environments (jobs with `environment: <name>`) allowed to deploy. */
  githubEnvironments: string[];
  /** ARN of an existing GitHub OIDC provider (only one is allowed per account). Omit to create it. */
  existingProviderArn?: string;
}

/**
 * One-time setup, deployed from a laptop with `aws login`: lets GitHub Actions deploy without stored AWS keys.
 * The role can only assume the CDK bootstrap roles, so what it may change is bounded by the bootstrap.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const providerArn = props.existingProviderArn
      ? props.existingProviderArn
      : new iam.OidcProviderNative(this, 'GithubOidcProvider', {
          url: GITHUB_OIDC_URL,
          clientIds: ['sts.amazonaws.com'],
          // Shared by every repo in the account: keep it if this stack is deleted.
          removalPolicy: RemovalPolicy.RETAIN,
        }).oidcProviderArn;

    const subjectPrefix = props.githubSubjectPrefix ?? `repo:${props.githubRepo}`;
    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: `${props.projectName}-github-deploy`,
      description: `GitHub Actions (${props.githubRepo}) deploys ${props.projectName} via CDK`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': props.githubEnvironments.map(
            (envName) => `${subjectPrefix}:environment:${envName}`,
          ),
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-*`],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { 
      value: role.roleArn,
      description: 'Set as GitHub repository variable AWS_DEPLOY_ROLE_ARN',
    });

    Validations.of(this).acknowledge({
      id: 'AwsSolutions-IAM5',
      reason: 'Wildcard limited to the CDK bootstrap roles (deploy, file/image publishing, lookup) in any region of this account.',
    });
  }
}
