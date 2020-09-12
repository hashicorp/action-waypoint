import * as core from '@actions/core';
import { exec, ExecOptions } from '@actions/exec';
import { Context } from '@actions/github/lib/context';
import { getOctokit, context } from '@actions/github';
import { Octokit } from '@octokit/core';
import { WaypointClient } from 'waypoint-node/waypoint_grpc_pb';
import { CallCredentials, ChannelCredentials, Metadata } from '@grpc/grpc-js';

export class Ctx {
  // The branch to run `release` on. This defaults to the
  // repository "default_branch"
  release_branch: string;

  // Whether or not the  release stage should be run, defaults to true,
  // must be set to "false" to disable
  releases: boolean;

  // The default branch of the repository, used to determine if
  // the release stage should run
  default_branch?: string;

  // The GitHub token to use, should be passed from the SECRETS value
  github_token: string;

  // An instance of ocotkit that is configured
  octokit: Octokit;

  // An instance of the Waypoint client
  waypoint: WaypointClient;

  waypointToken: string;
  waypointAddress: string;

  // The associated context
  context: Context;

  constructor() {
    const githubToken = core.getInput('github_token', { required: true });

    this.release_branch = core.getInput('release_branch');
    this.releases = core.getInput('releases') === 'false' ? false : true;
    this.github_token = githubToken;
    this.octokit = getOctokit(githubToken);
    this.context = context;

    const waypointToken = core.getInput('waypoint_server_token', { required: true });
    const waypointAddress = core.getInput('waypoint_server_address', { required: true });
    this.waypointToken = waypointToken;
    this.waypointAddress = waypointAddress;

    // Make this available for waypoint exec
    core.exportVariable('WAYPOINT_SERVER_TOKEN', waypointToken);
    core.exportVariable('WAYPOINT_SERVER_ADDR', waypointAddress);
    core.exportVariable('WAYPOINT_SERVER_TLS', '1');
    core.exportVariable('WAYPOINT_SERVER_TLS_SKIP_VERIFY', '1');
    core.exportVariable('WAYPOINT_LOG_LEVEL', 'info');

    // Ensure the Waypoint token is masked from logs
    // core.setSecret(waypointToken);

    const creds = createPerRpcChannelCredentials(waypointToken);
    this.waypoint = new WaypointClient(waypointAddress, creds);
  }

  // Returns the waypoint workspace name based on the environment
  get workspace(): string {
    return `gh-${this.context.ref}`;
  }

  shouldRelease(defaultBranch: string): boolean {
    core.info(`release branch: ${this.release_branch} ref: ${this.context.ref}`);
    // Match this ref against either the confgiured release branch or the
    // default branch for the repository
    if (this.release_branch && `refs/heads/${this.release_branch}` === this.context.ref) {
      return true;
    } else if (`refs/heads/${defaultBranch}` === this.context.ref) {
      return true;
    }

    // We should not release if we can't match the
    return false;
  }

  async getDefaultBranch(): Promise<string> {
    core.debug(`retrieving default branch from repo: ${this.context.repo} `);

    const resp = await this.octokit.request('GET /repos/:owner/:repo', {
      repo: this.context.repo.repo,
      owner: this.context.repo.owner,
    });

    core.info(`determined default branch: ${resp.data.default_branch} `);

    return resp.data.default_branch;
  }
}

export function createPerRpcChannelCredentials(token: string): ChannelCredentials {
  const verifyOptions = {
    checkServerIdentity() {
      // Don't check
      return undefined;
    },
  };
  const creds = ChannelCredentials.createSsl(null, null, null, verifyOptions);
  const metadata = new Metadata();
  metadata.add('authorization', token);

  const perRPCCreds = CallCredentials.createFromMetadataGenerator((args, callback) => {
    callback(null, metadata);
  });

  return creds.compose(perRPCCreds);
}

export async function validateWaypoint(): Promise<void> {
  core.info('Checking Waypoint Version');
  // Output the version
  const versionCode = await exec('waypoint', ['version']);

  if (versionCode !== 0) {
    throw new Error(
      `Attempt to output Waypoint version failed (exit code ${versionCode}). Waypoint may not be installed. Please
see instructions in the REAMDE for utilizing the setup-waypoint action.`
    );
  }

  core.info('Checking Waypoint Status');

  let statusError = '';

  const options: ExecOptions = {};
  options.listeners = {
    stdout: () => {
      // Do nothing. We do not want to show the status output and only
      // the error output if this fails
    },
    stderr: (data: Buffer) => {
      statusError += data.toString();
    },
  };

  // todo: replace with upcoming `status` command so a failure
  // can help debug
  const statusCode = await exec('waypoint', ['version'], options);

  if (statusCode !== 0) {
    throw new Error(
      `The 'waypoint status' command failed. This could mean that Waypoint
is misconfigured. Below is the output returned from Waypoint:

${statusError}`
    );
  }
}
