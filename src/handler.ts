import { EventPayloads } from '@octokit/webhooks';
import { Ctx } from './setup';
import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { Deployment, ListDeploymentsRequest, Ref, Status } from 'waypoint-node/waypoint_pb';
import { ListDeploymentsResponse } from 'waypoint-node-pb';
import { UnaryCallback } from '@grpc/grpc-js/build/src/client';

const DEFAULT_WORKSPACE = 'default';
const LABEL_PREFIX = 'common';

// with 6000 ms timeout, 10m
const POLL_INTERVAL = 6000;
const POLL_MAX_CHECKS = 100;

async function updateCommitStatus(ctx: Ctx, sha: string, status: Status): Promise<void> {
  // The GitHub state
  let state: githubState;
  enum githubState {
    Error = 'error',
    Pending = 'pending',
    Success = 'success',
    Failure = 'failure',
  }

  // Unfortunately have to do this as we cannot just pass a string value to
  // the commit status API
  let description = '';
  switch (status.getState()) {
    case Status.State.ERROR: {
      state = githubState.Error;
      description = 'An error occurred';
      break;
    }
    case Status.State.UNKNOWN: {
      state = githubState.Pending;
      description = 'The current state of the operation is not known';
      break;
    }
    case Status.State.RUNNING: {
      state = githubState.Pending;
      description = 'The operation is currently running';
      break;
    }
    case Status.State.SUCCESS: {
      state = githubState.Success;
      description = 'The operation was successful';
      break;
    }
  }

  await ctx.octokit.request('POST /repos/:owner/:repo/statuses/:sha', {
    owner: ctx.context.repo.owner,
    repo: ctx.context.repo.repo,
    sha,
    state,
    description,
  });
}

async function updateDeployStatusForRun(ctx: Ctx, workspace: string): Promise<boolean> {
  // Get the deployment from Waypoint using the git sha label to identify it
  const req = new ListDeploymentsRequest();
  const ws = new Ref.Workspace();
  ws.setWorkspace(workspace);
  req.setWorkspace(ws);

  const deployments = await new Promise<Deployment[]>((resolve, reject) => {
    ctx.waypoint.listDeployments(req, (err, resp) => {
      if (err || !resp) {
        reject(new Error(`failed to retrieve deployments for url ${err}`));
      } else {
        resolve(resp.getDeploymentsList());
      }
    });
  });

  // Get a deployment that has a matching vsc ref label, which is the one we just created
  const deploy = deployments.find((d) =>
    d.getLabelsMap().get(`${LABEL_PREFIX}/vcs-run-id/${ctx.context.runId}`)
  );

  // The deploy should exist. Use the status API to update the status of the commit
  // based on the deployment
  if (deploy) {
    const status = deploy.getStatus();
    if (status) {
      // Update the status on the commit
      updateCommitStatus(ctx, ctx.context.sha, status);

      // If it is in a finished state, return true, otherwise false
      if (status.getState() === (Status.State.ERROR || Status.State.SUCCESS)) {
        return true;
      } else {
        return false;
      }
    }
  }

  // If there is no deploy, assume that we are not finished
  return false;
}

export async function handlePush(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const shouldRelease = ctx.shouldRelease(payload.repository.default_branch);
  const workspace = shouldRelease ? DEFAULT_WORKSPACE : ctx.workspace;

  core.debug('retrieving after push commit metadata from GitHub API');

  const commit = await ctx.octokit.request('GET /repos/:owner/:repo/commits/:ref', {
    owner: ctx.context.repo.owner,
    repo: ctx.context.repo.repo,
    ref: payload.after,
  });

  // CLI options for all commands, for labeling and determing the workspace
  const waypointOptions = [
    '-workspace',
    workspace,
    '-label',
    `${LABEL_PREFIX}/vcs-ref=${ctx.context.ref}`,
    '-label',
    `${LABEL_PREFIX}/vcs-sha=${payload.after}`,
    '-label',
    `${LABEL_PREFIX}/vcs-url=${commit.data.html_url}`,
    '-label',
    `${LABEL_PREFIX}/vcs-run-id=${ctx.context.runId}`,
  ];

  await exec('waypoint', [
    'context',
    'create',
    '-server-addr',
    ctx.waypointAddress,
    '-server-auth-token',
    ctx.waypointToken,
    '-server-tls-skip-verify',
    '-set-default',
    '-server-require-auth',
    'action',
  ]);

  // Run the build
  try {
    const buildCode = await exec('waypoint', ['init', '-workspace', workspace]);
    if (buildCode !== 0) {
      throw new Error(`build failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`build failed: ${e}`);
  }

  // Run the build
  try {
    const buildCode = await exec('waypoint', ['build', ...waypointOptions]);
    if (buildCode !== 0) {
      throw new Error(`build failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`build failed: ${e}`);
  }

  await core.group('waypoint deploy', async () => {
    // Run the deploy, we want to do this async and wait for the remote status
    /* eslint-disable github/no-then */
    exec('waypoint', ['deploy', ...waypointOptions]).then((code) => {
      if (code !== 0) {
        throw new Error(`deploy failed with exit code ${code}`);
      }
    });

    // let checks = 0;
    // // Block and poll until we have resolved our status
    // while (checks < POLL_MAX_CHECKS) {
    //   await updateDeployStatusForRun(ctx, workspace);

    //   await new Promise(function (resolve) {
    //     setTimeout(resolve, POLL_INTERVAL);
    //   });

    //   checks++;
    // }
  });

  if (shouldRelease) {
    // Run the release if the ref matches
    const releaseCode = await exec('waypoint', ['release', '-workspace', workspace]);
    if (releaseCode !== 0) {
      throw new Error(`release failed with exit code ${releaseCode}`);
    }
  }
}

// export async function handlePr(ctx: Ctx, payload: EventPayloads.WebhookPayloadPullRequest): Promise<void> {}
