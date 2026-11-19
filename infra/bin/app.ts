#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { GameStack } from '../lib/stack.js';
import { readConfig } from '../lib/config.js';

const app = new App();
const cfg = readConfig(app);
new GameStack(app, cfg.stackName, cfg, {
  // Account/region come from your AWS profile, never from the repo.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: 'Elephants on Mars: internal-only team game (Fargate + internal ALB)',
});
