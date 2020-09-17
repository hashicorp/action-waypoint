import { EventPayloads } from '@octokit/webhooks';
import { Ctx } from './setup';
import { exec, ExecOptions } from '@actions/exec';
import * as core from '@actions/core';

const LABEL_PREFIX = 'common';
const URL_REGEX = /(?<=Deployment URL: )[^\n]+/;
const WAIT_FOR_BUILD = 8000;

// The GitHub state, unfortunately have to do this as we cannot just pass a string value to
// the commit status API
enum githubState {
  Error = 'error',
  Pending = 'pending',
  Success = 'success',
  Failure = 'failure',
}

enum githubDeploymentState {
  Error = 'error',
  Pending = 'pending',
  Success = 'success',
  Failure = 'failure',
}

async function updateCommitStatus(ctx: Ctx, status: githubState, url?: string): Promise<void> {
  let description = '';
  let state = githubState.Pending;
  const context = `waypoint/${ctx.operation}`;

  core.info(`updating commit status to: ${status}`);

  switch (status) {
    case githubState.Error: {
      state = githubState.Error;
      description = `The ${ctx.operation} encountered an error`;
      break;
    }
    case githubState.Pending: {
      state = githubState.Pending;
      description = `The ${ctx.operation} has started running`;
      break;
    }
    case githubState.Success: {
      state = githubState.Success;
      description = `The ${ctx.operation} has completed successfully`;
      break;
    }
  }

  try {
    await ctx.octokit.request('POST /repos/:owner/:repo/statuses/:sha', {
      owner: ctx.context.repo.owner,
      repo: ctx.context.repo.repo,
      sha: ctx.context.sha,
      state,
      description,
      context,
      target_url: ctx.uiAppUrl || undefined,
    });
  } catch (e) {
    throw new Error(`failed to create commit status ${e}`);
  }
}

/* eslint-expect-error-next-line @typescript-eslint/no-explicit-any */
async function createDeployment(ctx: Ctx): Promise<any> {
  core.info(`creating github deployment`);

  try {
    const deployment = await ctx.octokit.request('POST /repos/:owner/:repo/deployments', {
      owner: ctx.context.repo.owner,
      repo: ctx.context.repo.repo,
      ref: ctx.context.sha,
      environment: ctx.workspace,
      auto_merge: false,
      required_contexts: [],
    });

    /* eslint-expect-error-next-line @typescript-eslint/no-explicit-any */
    const responseData: any = deployment.data;
    return responseData;
  } catch (e) {
    throw new Error(`failed to create deployment ${e}`);
  }
}

async function createDeploymentStatus(
  ctx: Ctx,
  deploymentId: number,
  status: githubDeploymentState,
  url?: string
): Promise<void> {
  let state = githubDeploymentState.Pending;

  switch (status) {
    case githubDeploymentState.Pending: {
      state = githubDeploymentState.Pending;
      break;
    }
    case githubDeploymentState.Failure: {
      state = githubDeploymentState.Failure;
      break;
    }
    case githubDeploymentState.Success: {
      state = githubDeploymentState.Success;
      break;
    }
  }

  core.info(`update github deployment status to ${status}`);

  try {
    await ctx.octokit.request('POST /repos/:owner/:repo/deployments/:deployment_id/statuses', {
      owner: ctx.context.repo.owner,
      repo: ctx.context.repo.repo,
      ref: ctx.context.sha,
      deployment_id: deploymentId,
      state,
      target_url: ctx.uiAppUrl || undefined,
    });
  } catch (e) {
    throw new Error(`failed to create deployment status ${e}`);
  }
}

// CLI options for all commands, for labeling and determing the workspace
export async function getCliOptions(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<string[]> {
  const commit = await ctx.octokit.request('GET /repos/:owner/:repo/commits/:ref', {
    owner: ctx.context.repo.owner,
    repo: ctx.context.repo.repo,
    ref: payload.after,
  });

  return [
    '-workspace',
    ctx.workspace,
    '-label',
    `${LABEL_PREFIX}/vcs-ref=${ctx.context.ref}`,
    '-label',
    `${LABEL_PREFIX}/vcs-sha=${payload.after}`,
    '-label',
    `${LABEL_PREFIX}/vcs-url=${commit.data.html_url}`,
    '-label',
    `${LABEL_PREFIX}/vcs-run-id=${ctx.context.runId}`,
  ];
}

export async function initWaypoint(ctx: Ctx): Promise<void> {
  // Run init quietly
  const options: ExecOptions = {};
  core.info(`running Waypoint init`);

  try {
    const buildCode = await exec('waypoint', ['init', '-workspace', ctx.workspace], options);
    if (buildCode !== 0) {
      throw new Error(`init failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`init failed: ${e}`);
  }
}

export async function handleBuild(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Set status to pending
  await updateCommitStatus(ctx, githubState.Pending);

  // Run init
  await initWaypoint(ctx);

  // Run the build
  try {
    const buildCode = await exec('waypoint', ['build', ...waypointOptions]);
    if (buildCode !== 0) {
      throw new Error(`build failed with exit code ${buildCode}`);
    }
  } catch (e) {
    // Set status to error
    await updateCommitStatus(ctx, githubState.Error);
    throw new Error(`build failed: ${e}`);
  }

  // Set status to success
  await updateCommitStatus(ctx, githubState.Success);
}

export async function handleDeploy(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Set status to pending
  await updateCommitStatus(ctx, githubState.Pending);

  // Create a github deployment, which also updates the status
  const deploy = await createDeployment(ctx);

  // Update the status of the deployment
  await createDeploymentStatus(ctx, deploy.id, githubDeploymentState.Pending);

  // This is pretty unfortunate, but if you run `waypoint deploy` too soon
  // after `waypoint build` you might not get the recently built artifact. So
  // we just naively wait.
  await new Promise((resolve) => {
    setTimeout(resolve, WAIT_FOR_BUILD);
  });

  // Run init
  await initWaypoint(ctx);

  let output = '';
  const options: ExecOptions = {};
  options.listeners = {
    stdout: (data: Buffer) => {
      // Store a copy out of the output so we can
      // search for a deployment URL after
      output += data.toString();
      core.info(output);
    },
  };

  await createDeploymentStatus(ctx, deploy.id, githubDeploymentState.Pending);

  // Run the deploy
  try {
    const buildCode = await exec('waypoint', ['deploy', ...waypointOptions], options);
    if (buildCode !== 0) {
      throw new Error(`deploy failed with exit code ${buildCode}`);
    }
  } catch (e) {
    await updateCommitStatus(ctx, githubState.Error);
    await createDeploymentStatus(ctx, deploy.id, githubDeploymentState.Failure);
    throw new Error(`deploy failed: ${e}`);
  }

  let deployUrl = undefined;
  const matches = URL_REGEX.exec(output);
  if (matches?.length === 1) {
    deployUrl = matches[0];
    core.info(`got deployment url from output: ${deployUrl}`);
  }

  // Update the commit status
  await updateCommitStatus(ctx, githubState.Success, deployUrl);
  await createDeploymentStatus(ctx, deploy.id, githubDeploymentState.Success);
}

export async function handleRelease(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Set status to pending
  await updateCommitStatus(ctx, githubState.Pending);

  // Run init
  await initWaypoint(ctx);

  try {
    const releaseCode = await exec('waypoint', ['release', ...waypointOptions]);
    if (releaseCode !== 0) {
      await updateCommitStatus(ctx, githubState.Error);
      throw new Error(`release failed with exit code ${releaseCode}`);
    }
  } catch (e) {
    throw new Error(`release failed: ${e}`);
  }

  // Update the commit status to success
  await updateCommitStatus(ctx, githubState.Success);
}
