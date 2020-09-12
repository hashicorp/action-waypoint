import { EventPayloads } from '@octokit/webhooks';
import { Ctx } from './setup';

import { exec } from '@actions/exec';

const LABEL_PREFIX = 'common';

// with 6000 ms timeout, 10m
// const POLL_INTERVAL = 6000;
// const POLL_MAX_CHECKS = 100;

// async function updateCommitStatus(ctx: Ctx, sha: string, status: Status): Promise<void> {
//   // The GitHub state
//   let state: githubState;
//   enum githubState {
//     Error = 'error',
//     Pending = 'pending',
//     Success = 'success',
//     Failure = 'failure',
//   }

//   // Unfortunately have to do this as we cannot just pass a string value to
//   // the commit status API
//   let description = '';
//   switch (status.getState()) {
//     case Status.State.ERROR: {
//       state = githubState.Error;
//       description = 'An error occurred';
//       break;
//     }
//     case Status.State.UNKNOWN: {
//       state = githubState.Pending;
//       description = 'The current state of the operation is not known';
//       break;
//     }
//     case Status.State.RUNNING: {
//       state = githubState.Pending;
//       description = 'The operation is currently running';
//       break;
//     }
//     case Status.State.SUCCESS: {
//       state = githubState.Success;
//       description = 'The operation was successful';
//       break;
//     }
//   }

//   await ctx.octokit.request('POST /repos/:owner/:repo/statuses/:sha', {
//     owner: ctx.context.repo.owner,
//     repo: ctx.context.repo.repo,
//     sha,
//     state,
//     description,
//   });
// }

// async function updateDeployStatusForRun(ctx: Ctx, workspace: string): Promise<boolean> {
//   // Get the deployment from Waypoint using the git sha label to identify it
//   const req = new ListDeploymentsRequest();
//   const ws = new Ref.Workspace();
//   ws.setWorkspace(workspace);
//   req.setWorkspace(ws);

//   const deployments = await new Promise<Deployment[]>((resolve, reject) => {
//     ctx.waypoint.listDeployments(req, (err, resp) => {
//       if (err || !resp) {
//         reject(new Error(`failed to retrieve deployments for url ${err}`));
//       } else {
//         resolve(resp.getDeploymentsList());
//       }
//     });
//   });

//   // Get a deployment that has a matching vsc ref label, which is the one we just created
//   const deploy = deployments.find((d) =>
//     d.getLabelsMap().get(`${LABEL_PREFIX}/vcs-run-id/${ctx.context.runId}`)
//   );

//   // The deploy should exist. Use the status API to update the status of the commit
//   // based on the deployment
//   if (deploy) {
//     const status = deploy.getStatus();
//     if (status) {
//       // Update the status on the commit
//       updateCommitStatus(ctx, ctx.context.sha, status);

//       // If it is in a finished state, return true, otherwise false
//       if (status.getState() === (Status.State.ERROR || Status.State.SUCCESS)) {
//         return true;
//       } else {
//         return false;
//       }
//     }
//   }

//   // If there is no deploy, assume that we are not finished
//   return false;
// }

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

export async function handleRelease(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Run init
  await initWaypoint(ctx);

  try {
    const releaseCode = await exec('waypoint', ['release', ...waypointOptions]);
    if (releaseCode !== 0) {
      throw new Error(`build failed with exit code ${releaseCode}`);
    }
  } catch (e) {
    throw new Error(`build failed: ${e}`);
  }
}

export async function initWaypoint(ctx: Ctx): Promise<void> {
  // Run init
  try {
    const buildCode = await exec('waypoint', ['init', '-workspace', ctx.workspace]);
    if (buildCode !== 0) {
      throw new Error(`build failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`build failed: ${e}`);
  }
}

export async function handleBuild(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Run init
  await initWaypoint(ctx);

  // Run the build
  try {
    const buildCode = await exec('waypoint', ['build', ...waypointOptions]);
    if (buildCode !== 0) {
      throw new Error(`build failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`build failed: ${e}`);
  }
}

export async function handleDeploy(ctx: Ctx, payload: EventPayloads.WebhookPayloadPush): Promise<void> {
  const waypointOptions = await getCliOptions(ctx, payload);

  // Run init
  await initWaypoint(ctx);

  // Run the deploy
  try {
    const buildCode = await exec('waypoint', ['deploy', ...waypointOptions]);
    if (buildCode !== 0) {
      throw new Error(`deploy failed with exit code ${buildCode}`);
    }
  } catch (e) {
    throw new Error(`deploy failed: ${e}`);
  }

  // Run the deploy, we want to do this async and wait for the remote status
  // exec('waypoint', ['deploy', ...waypointOptions]).then((code) => {
  //   if (code !== 0) {
  //     throw new Error(`deploy failed with exit code ${code}`);
  //   }
  // });
  // let checks = 0;
  // // Block and poll until we have resolved our status
  // while (checks < POLL_MAX_CHECKS) {
  //   await updateDeployStatusForRun(ctx, workspace);

  //   await new Promise(function (resolve) {
  //     setTimeout(resolve, POLL_INTERVAL);
  //   });

  //   checks++;
  // }
}
