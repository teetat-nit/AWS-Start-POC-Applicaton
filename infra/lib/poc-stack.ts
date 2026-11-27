import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  CfnOutput,
  Annotations,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_kms as kms,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_secretsmanager as secretsmanager,
  IgnoreMode,
  Validations,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface PocStackProps extends StackProps {
  /** Used in resource names and descriptions, e.g. "happy-path". */
  projectName: string;
  envName: string;
  /** Secrets Manager secret name holding {"clientId": "...", "clientSecret": "..."}. Omit to disable Google login. */
  googleSecretName?: string;
  /** ACM certificate (same region) for an HTTPS ALB listener. With apiOriginDomain, CloudFront talks to the ALB over TLS. */
  albCertificateArn?: string;
  /** DNS name pointing at the ALB that matches albCertificateArn, e.g. api-origin.dev.example.com. */
  apiOriginDomain?: string;
}

const REPO_ROOT = path.join(__dirname, '..', '..');
const WEB_DIST = path.join(REPO_ROOT, 'apps', 'web', 'dist');
const API_PORT = 3000;
const ORIGIN_HEADER = 'X-Origin-Verify';

/**
 * One stack per environment:
 *   Browser -> CloudFront ─┬─ /*      -> S3 (React SPA, private, OAC)
 *                          └─ /api/*  -> ALB -> ECS Fargate (NestJS) -> DynamoDB
 * Same origin for SPA and API, so the session cookie is first-party and no CORS is needed.
 */
export class PocStack extends Stack {
  constructor(scope: Construct, id: string, props: PocStackProps) {
    super(scope, id, props);
    const isProd = props.envName === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const useTlsToOrigin = Boolean(props.albCertificateArn && props.apiOriginDomain);

    // ---------- Network ----------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: isProd ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
      ],
      gatewayEndpoints: { DynamoDb: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB } },
    });
    vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy }),
      ),
    });

    // ---------- Data ----------
    const usersTable = new dynamodb.TableV2(this, 'UsersTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: isProd,
      removalPolicy,
    });

    // ---------- Secrets ----------
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      description: 'Signing key for API session JWTs',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    // Shared secret CloudFront sends to the ALB so the ALB only serves traffic that came through CloudFront.
    const originVerifySecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      description: 'Header value CloudFront adds to /api/* requests; ALB rejects requests without it',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    // Resolved by CloudFormation at deploy time ({{resolve:secretsmanager:...}}); the value is never in the template.
    const originVerifyValue = originVerifySecret.secretValue.unsafeUnwrap();

    const googleSecret = props.googleSecretName
      ? secretsmanager.Secret.fromSecretNameV2(this, 'GoogleOAuthSecret', props.googleSecretName)
      : undefined;

    // ---------- Load balancer ----------
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      dropInvalidHeaderFields: true,
    });
    const listener = useTlsToOrigin
      ? alb.addListener('Https', {
          port: 443,
          certificates: [acm.Certificate.fromCertificateArn(this, 'AlbCert', props.albCertificateArn!)],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
          defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
        })
      : alb.addListener('Http', {
          port: 80,
          defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
        });

    // ---------- Web hosting ----------
    const webKey = new kms.Key(this, 'WebBucketKey', { enableKeyRotation: true, removalPolicy });
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: webKey,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Serve index.html for client-side routes (paths without a file extension)',
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var req = event.request;
  if (!req.uri.includes('.')) { req.uri = '/index.html'; }
  return req;
}`,
      ),
    });

    const apiOrigin = useTlsToOrigin
      ? new origins.HttpOrigin(props.apiOriginDomain!, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          customHeaders: { [ORIGIN_HEADER]: originVerifyValue },
        })
      : new origins.LoadBalancerV2Origin(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: { [ORIGIN_HEADER]: originVerifyValue },
        });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${props.projectName} ${props.envName}`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards cookies, query strings and headers (except Host) to the API.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    const publicUrl = `https://${distribution.distributionDomainName}`;

    // ---------- API on ECS Fargate ----------
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        // X86_64 so images build natively on Windows/x86 CI. Switch to ARM64 (Graviton) for ~20% lower cost.
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    const secrets: Record<string, ecs.Secret> = { JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret) };
    if (googleSecret) {
      secrets.GOOGLE_CLIENT_ID = ecs.Secret.fromSecretsManager(googleSecret, 'clientId');
      secrets.GOOGLE_CLIENT_SECRET = ecs.Secret.fromSecretsManager(googleSecret, 'clientSecret');
    }

    taskDefinition.addContainer('api', {
      image: ecs.ContainerImage.fromAsset(REPO_ROOT, {
        file: 'apps/api/Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
        ignoreMode: IgnoreMode.DOCKER,
      }),
      portMappings: [{ containerPort: API_PORT }],
      environment: {
        NODE_ENV: 'production',
        PORT: String(API_PORT),
        APP_PUBLIC_URL: publicUrl,
        DB_DRIVER: 'dynamodb',
        USERS_TABLE_NAME: usersTable.tableName,
        AWS_REGION: this.region,
        TRUST_PROXY_HOPS: '2', // CloudFront + ALB
      },
      secrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup: new logs.LogGroup(this, 'ApiLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy }),
      }),
      readonlyRootFilesystem: true,
    });
    usersTable.grantReadWriteData(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition,
      desiredCount: isProd ? 2 : 1,
      minHealthyPercent: 100,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: false,
    });

    listener.addTargets('Api', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.httpHeader(ORIGIN_HEADER, [originVerifyValue])],
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: { path: '/api/health', healthyHttpCodes: '200', interval: Duration.seconds(30) },
    });

    const scaling = service.autoScaleTaskCount({ minCapacity: isProd ? 2 : 1, maxCapacity: isProd ? 6 : 2 });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });

    // ---------- Deploy the SPA ----------
    if (existsSync(WEB_DIST)) {
      new s3deploy.BucketDeployment(this, 'DeployWeb', {
        sources: [s3deploy.Source.asset(WEB_DIST)],
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      });
    } else {
      Annotations.of(this).addWarningV2(
        'poc:web-dist-missing',
        `apps/web/dist not found: run "pnpm --filter web build" before synth/deploy to upload the frontend.`,
      );
    }

    // ---------- Outputs ----------
    new CfnOutput(this, 'AppUrl', { value: publicUrl, description: 'Open this URL in the browser' });
    new CfnOutput(this, 'GoogleRedirectUri', {
      value: `${publicUrl}/api/auth/google/callback`,
      description: 'Add to "Authorized redirect URIs" of the Google OAuth client',
    });
    new CfnOutput(this, 'UsersTableName', { value: usersTable.tableName });
    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: useTlsToOrigin ? `Point ${props.apiOriginDomain} (CNAME/alias) here` : 'Origin for /api/*',
    });

    this.addNagSuppressions(useTlsToOrigin);
  }

  /** Documented exceptions for the POC. Revisit each before production (see README "Production hardening"). */
  private addNagSuppressions(useTlsToOrigin: boolean): void {
    const reasons: Array<{ id: string; reason: string }> = [
      { id: 'AwsSolutions-IAM4', reason: 'CDK-managed Lambda helpers (BucketDeployment, auto-delete) use AWSLambdaBasicExecutionRole.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcards come from CDK grant helpers scoped to this stack\'s bucket, table index ARNs and log streams.' },
      { id: 'AwsSolutions-L1', reason: 'Runtime of CDK-managed custom resource Lambdas is controlled by aws-cdk-lib.' },
      { id: 'AwsSolutions-SMG4', reason: 'POC: JWT and origin-verify secrets are not rotated yet. Rotating JWT secret signs out all users.' },
      { id: 'AwsSolutions-ELB2', reason: 'POC: ALB access logs not enabled yet.' },
      { id: 'AwsSolutions-S1', reason: 'POC: S3 server access logs not enabled yet.' },
      { id: 'AwsSolutions-CFR1', reason: 'No geo restriction required for this POC.' },
      { id: 'AwsSolutions-CFR2', reason: 'POC: AWS WAF web ACL not attached yet.' },
      { id: 'AwsSolutions-CFR3', reason: 'POC: CloudFront access logs not enabled yet.' },
      { id: 'AwsSolutions-CFR4', reason: 'Default *.cloudfront.net certificate; set a custom domain + ACM cert to enforce TLSv1.2_2021.' },
      { id: 'AwsSolutions-EC23', reason: 'ALB is public so CloudFront can reach it; listener only forwards requests carrying the origin-verify secret header.' },
      { id: 'AwsSolutions-ECS2', reason: 'Only non-secret config is passed as environment variables; secrets come from Secrets Manager.' },
    ];
    if (!useTlsToOrigin) {
      reasons.push({
        id: 'AwsSolutions-CFR5',
        reason: 'POC without a custom domain: CloudFront to ALB is HTTP. Set albCertificateArn + apiOriginDomain to use TLS.',
      });
    }
    for (const ack of reasons) Validations.of(this).acknowledge(ack);
  }
}
