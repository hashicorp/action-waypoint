import * as core from '@actions/core';
import * as github from '@actions/github';
import { EventPayloads } from '@octokit/webhooks';
import { Ctx } from './setup';
import * as setup from './setup';
import * as handler from './handler';

export async function run(): Promise<void> {
  try {
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
