import * as core from '@actions/core';
import * as github from '@actions/github';
import { Ctx } from './setup';
import * as setup from './setup';
import * as handler from './handler';
import { getBinary } from './install';
import { EventPayloads } from '@octokit/webhooks';
import * as tc from '@actions/tool-cache';
import os from 'os';

export const PRODUCT_NAME = 'otto';

export async function run(): Promise<void> {
  try {
    // The version is the version of Waypoint we want to
    // download and install
    // const version = core.getInput('version');

    // Download or return the cached path for the specified version
    // const path = await getBinary(version);

    // TEMP
    const path = await tc.downloadTool(`https://dl.dropbox.com/s/0ss5cuh4ab51n8y/waypoint.zip`);
    const extractedPath = await tc.extractZip(path);
    const dir = await tc.cacheDir(extractedPath, PRODUCT_NAME, '0.1.0', os.arch());
    // TEMP

    // Make command available for future commands or actions
    core.addPath(dir);

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
