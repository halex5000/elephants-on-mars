// Guardrails for the deploy: these fail if a change would expose the game to the
// internet, run two copies of the in-memory state, or drop required controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { GameStack } from '../lib/stack.js';
import { readConfig } from '../lib/config.js';

function synth(context: Record<string, unknown> = {}) {
  const app = new App({ context: { imageUri: 'example.invalid/eom:test', ...context } });
  const stack = new GameStack(app, 'Test', readConfig(app), { env: { account: '111111111111', region: 'us-east-1' } });
  return Template.fromStack(stack);
}

test('load balancer is internal, never internet-facing', () => {
  synth().hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
});

test('no public IPs, no internet gateway, no NAT in the default VPC', () => {
  const t = synth();
  t.hasResourceProperties('AWS::ECS::Service', { NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'DISABLED' } } });
  t.resourceCountIs('AWS::EC2::InternetGateway', 0);
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('exactly one task, and deploys never overlap two copies', () => {
  synth().hasResourceProperties('AWS::ECS::Service', {
    DesiredCount: 1,
    DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 0, MaximumPercent: 100 }),
  });
});

test('desiredCount 0 parks it; anything above 1 is refused', () => {
  synth({ desiredCount: '0' }).hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 });
  assert.throws(() => synth({ desiredCount: '2' }), /0 or 1/);
});

test('ALB only accepts the allowed CIDRs', () => {
  const t = synth({ allowedCidrs: '10.1.0.0/16,10.2.0.0/16' });
  const sgs = t.findResources('AWS::EC2::SecurityGroup', { Properties: { GroupDescription: Match.stringLikeRegexp('ALB') } });
  const ingress = Object.values(sgs).flatMap(
    r => (r as { Properties: { SecurityGroupIngress?: { CidrIp: string }[] } }).Properties.SecurityGroupIngress ?? [],
  );
  assert.deepEqual(ingress.map(i => i.CidrIp).sort(), ['10.1.0.0/16', '10.2.0.0/16']);
});

test('nothing is open to 0.0.0.0/0 inbound', () => {
  const t = synth();
  const sgs = Object.values(t.findResources('AWS::EC2::SecurityGroup')) as {
    Properties: { SecurityGroupIngress?: { CidrIp?: string }[] };
  }[];
  for (const sg of sgs) for (const r of sg.Properties.SecurityGroupIngress ?? []) assert.notEqual(r.CidrIp, '0.0.0.0/0');
});

test('with a certificate: HTTPS on 443 and 80 redirects', () => {
  const t = synth({ certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/abc' });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, Protocol: 'HTTPS' });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 80, DefaultActions: [Match.objectLike({ Type: 'redirect' })] });
});

test('health check and websocket-friendly idle timeout', () => {
  const t = synth();
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { HealthCheckPath: '/healthz' });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '120' }]),
  });
});

test('required tags and permissions boundary are applied', () => {
  const t = synth({ tags: 'cost-center=123,owner=alex', permissionsBoundaryArn: 'arn:aws:iam::111111111111:policy/Boundary' });
  t.hasResourceProperties('AWS::IAM::Role', { PermissionsBoundary: 'arn:aws:iam::111111111111:policy/Boundary' });
  t.hasResourceProperties('AWS::ECS::Cluster', { Tags: Match.arrayWith([{ Key: 'cost-center', Value: '123' }]) });
});

test('logs are retained for a bounded time; container root filesystem is read-only', () => {
  const t = synth({ logRetentionDays: 7 });
  t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  t.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: [Match.objectLike({ ReadonlyRootFilesystem: true })] });
});

test('no account IDs or VPC IDs are baked into the repo config', async () => {
  const { readFileSync } = await import('node:fs');
  const cdkJson = readFileSync(new URL('../cdk.json', import.meta.url), 'utf8');
  assert.doesNotMatch(cdkJson, /\d{12}|vpc-[0-9a-f]+|subnet-[0-9a-f]+/);
});
