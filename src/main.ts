import * as core from '@actions/core';
import * as github from '@actions/github';
import { exec } from '@actions/exec';
import { Ctx } from './setup';
import * as setup from './setup';
import * as handler from './handler';
import { getBinary } from './install';
import { EventPayloads } from '@octokit/webhooks';

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

    // Create context, will error in failure
    await setup.createContextConfig(ctx);

    // We only deal with push events so return on everything else we are sent
    if (github.context.eventName !== 'push') {
      return;
    }

    // Get the event context
    const payload = github.context.payload as EventPayloads.WebhookPayloadPush;

    // Get the second argument to the script. If none is supplied it will return
    const operation = core.getInput('operation');

    if (operation === 'build') {
      await handler.handleBuild(ctx, payload);
    } else if (operation === 'deploy') {
      await handler.handleDeploy(ctx, payload);
    } else if (operation === 'release') {
      //
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
