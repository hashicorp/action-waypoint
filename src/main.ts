import * as core from '@actions/core';
import * as github from '@actions/github';
import { Ctx } from './setup';
import * as setup from './setup';
import * as handler from './handler';
import { getBinary } from './install';
import { EventPayloads } from '@octokit/webhooks';
import * as tc from '@actions/tool-cache';
import os from 'os';

export const PRODUCT_NAME = 'waypoint';

export async function run(): Promise<void> {
  try {
    // The version is the version of Waypoint we want to
    // download and install
    const version = core.getInput('version');

    // Download or return the cached path for the specified version
    const path = await getBinary(PRODUCT_NAME, version);

    // Make command available for future commands or actions
    core.addPath(path);

    // Populates user inputs and configuration
    const ctx = new Ctx();

    // Validate the installation of Waypoint, will error if
    // not valid
    await setup.validateWaypoint();

    // Handle based on event type
    if (github.context.eventName === 'push') {
      await handler.handlePush(ctx, github.context.payload as EventPayloads.WebhookPayloadPush);
    } else if (github.context.eventName === 'pull_request') {
      // await handler.handlePr(ctx, github.context.payload as EventPayloads.WebhookPayloadPullRequest);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
