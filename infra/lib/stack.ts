// Internal-only hosting: one Fargate task in private subnets behind an internal ALB.
// Nothing here is reachable from the internet, and the app makes no outbound calls.
import { Stack, type StackProps, Duration, CfnOutput, RemovalPolicy, Tags } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig } from './config.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 3000;

export class GameStack extends Stack {
  constructor(scope: Construct, id: string, cfg: GameConfig, props?: StackProps) {
    super(scope, id, props);
    for (const [k, v] of Object.entries(cfg.tags)) Tags.of(this).add(k, v);
    if (cfg.permissionsBoundaryArn) iam.PermissionsBoundary.of(this).apply(iam.ManagedPolicy.fromManagedPolicyArn(this, 'Boundary', cfg.permissionsBoundaryArn));

    /* ---------- network ---------- */
    const vpc = cfg.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: cfg.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 2, natGateways: 0,
          subnetConfiguration: [{ name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
        });
    const subnets: ec2.SubnetSelection = cfg.subnetIds
      ? { subnets: cfg.subnetIds.map((s, i) => ec2.Subnet.fromSubnetId(this, `Subnet${i}`, s)) }
      : { subnetType: cfg.vpcId ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PRIVATE_ISOLATED };
    if (!cfg.vpcId) {
      // A brand-new isolated VPC has no route out, so the task needs endpoints to pull its image and write logs.
      vpc.addGatewayEndpoint('S3', { service: ec2.GatewayVpcEndpointAwsService.S3, subnets: [subnets] });
      for (const [n, svc] of [['EcrApi', ec2.InterfaceVpcEndpointAwsService.ECR], ['EcrDkr', ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER], ['Logs', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS]] as const)
        vpc.addInterfaceEndpoint(n, { service: svc, subnets, privateDnsEnabled: true });
    }

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'Elephants on Mars ALB: internal clients only', allowAllOutbound: false });
    const listenPort = cfg.certificateArn ? 443 : 80;
    for (const cidr of cfg.allowedCidrs ?? [vpc.vpcCidrBlock]) {
      albSg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(listenPort), 'game clients');
      if (cfg.certificateArn) albSg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(80), 'redirect to https');
    }
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', { vpc, description: 'Elephants on Mars task: ALB only', allowAllOutbound: true });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(PORT), 'from ALB');
    albSg.addEgressRule(taskSg, ec2.Port.tcp(PORT), 'to task');

    /* ---------- service ---------- */
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });
    const logGroup = new logs.LogGroup(this, 'Logs', { retention: cfg.logRetentionDays as logs.RetentionDays, removalPolicy: RemovalPolicy.DESTROY });
    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 256, memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    task.addContainer('app', {
      image: cfg.imageUri ? ecs.ContainerImage.fromRegistry(cfg.imageUri) : ecs.ContainerImage.fromAsset(APP_DIR, { platform: Platform.LINUX_ARM64 }),
      portMappings: [{ containerPort: PORT }],
      environment: { PORT: String(PORT), HOST: '0.0.0.0', NODE_ENV: 'production' },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
      healthCheck: { command: ['CMD-SHELL', `wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1`], interval: Duration.seconds(15), timeout: Duration.seconds(3), startPeriod: Duration.seconds(10) },
      readonlyRootFilesystem: true,
      stopTimeout: Duration.seconds(15),
    });
    const service = new ecs.FargateService(this, 'Service', {
      cluster, taskDefinition: task, desiredCount: cfg.desiredCount,
      vpcSubnets: subnets, securityGroups: [taskSg], assignPublicIp: false,
      // Exactly one task, ever: stop the old one before starting the new one so two
      // copies never split players between separate in-memory games.
      minHealthyPercent: 0, maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
    });

    /* ---------- internal load balancer ---------- */
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc, internetFacing: false, vpcSubnets: subnets, securityGroup: albSg,
      idleTimeout: Duration.seconds(120), // WebSockets ping every 25-30 s
      dropInvalidHeaderFields: true,
    });
    const listener = cfg.certificateArn
      ? alb.addListener('Https', { port: 443, open: false, certificates: [acm.Certificate.fromCertificateArn(this, 'Cert', cfg.certificateArn)], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS })
      : alb.addListener('Http', { port: 80, open: false });
    if (cfg.certificateArn) alb.addRedirect({ sourcePort: 80, targetPort: 443, open: false });
    listener.addTargets('App', {
      port: PORT, protocol: elbv2.ApplicationProtocol.HTTP, targets: [service],
      healthCheck: { path: '/healthz', healthyHttpCodes: '200', interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(15),
    });

    new CfnOutput(this, 'Url', { value: `${cfg.certificateArn ? 'https' : 'http'}://${alb.loadBalancerDnsName}`, description: 'Internal URL (reachable only from allowed CIDRs)' });
    new CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}
