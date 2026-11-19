// Every environment-specific value comes from CDK context (-c key=value) or cdk.context.json,
// never from this repo. That keeps account IDs, VPC IDs and company names out of git.
import type { App } from 'aws-cdk-lib';

export interface GameConfig {
  /** Existing VPC to deploy into (internal network). Omit to create a new private VPC (sandbox accounts). */
  vpcId?: string;
  /** Specific private subnet IDs for the ALB and task. Defaults to the VPC's private subnets. */
  subnetIds?: string[];
  /** CIDRs allowed to reach the load balancer, e.g. your corporate/VPN ranges. Defaults to the VPC CIDR. */
  allowedCidrs?: string[];
  /** ACM certificate ARN; if set, the ALB listens on 443 with TLS and 80 redirects. */
  certificateArn?: string;
  /** Use a pre-built image (e.g. from your internal ECR) instead of building from the Dockerfile. */
  imageUri?: string;
  /** 1 to run, 0 to park it between game nights. Never more than 1: game state lives in memory. */
  desiredCount: 0 | 1;
  /** IAM permissions boundary required by many enterprise accounts. */
  permissionsBoundaryArn?: string;
  /** Tags your org requires on every resource. */
  tags: Record<string, string>;
  logRetentionDays: number;
  stackName: string;
}

const list = (v: unknown) => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : undefined);

export function readConfig(app: App): GameConfig {
  const ctx = (k: string) => app.node.tryGetContext(k) as unknown;
  const desired = Number(ctx('desiredCount') ?? 1);
  if (desired !== 0 && desired !== 1) throw new Error('desiredCount must be 0 or 1: game state is in memory, so two tasks would split games between them.');
  const tags: Record<string, string> = {};
  for (const pair of list(ctx('tags')) ?? []) { const [k, ...v] = pair.split('='); if (k && v.length) tags[k] = v.join('='); }
  return {
    vpcId: (ctx('vpcId') as string) || undefined,
    subnetIds: list(ctx('subnetIds')),
    allowedCidrs: list(ctx('allowedCidrs')),
    certificateArn: (ctx('certificateArn') as string) || undefined,
    imageUri: (ctx('imageUri') as string) || undefined,
    desiredCount: desired as 0 | 1,
    permissionsBoundaryArn: (ctx('permissionsBoundaryArn') as string) || undefined,
    tags: { app: 'elephants-on-mars', ...tags },
    logRetentionDays: Number(ctx('logRetentionDays') ?? 14),
    stackName: (ctx('stackName') as string) || 'ElephantsOnMars',
  };
}
