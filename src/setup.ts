import * as core from '@actions/core';
import { exec, ExecOptions } from '@actions/exec';
import { Context } from '@actions/github/lib/context';
import { getOctokit, context } from '@actions/github';
import { Octokit } from '@octokit/core';
import { WaypointClient } from 'waypoint-node';
import { CallCredentials, ChannelCredentials, Metadata } from '@grpc/grpc-js';
import * as util from 'util';

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

  // The associated context
  context: Context;

  constructor() {
    const githubToken = core.getInput('github_token', { required: true });

    this.release_branch = core.getInput('release_branch');
    this.releases = core.getInput('releases') === 'false' ? false : true;
    this.github_token = githubToken;
    this.octokit = getOctokit(githubToken);
    this.context = context;

    // todo source from WAYPOINT_SERVER_ADDRESS and token
    const waypointToken = 'foo';
    const creds = createPerRpcChannelCredentials(waypointToken);
    this.waypoint = new WaypointClient('localhost:9701', creds);
  }

  // Returns the waypoint workspace name based on the environment
  get workspace(): string {
    return `gh-${this.context.ref}`;
  }

  shouldRelease(defaultBranch: string): boolean {
    // Match this ref against either the confgiured release branch or the
    // default branch for the repository
    if (this.release_branch && this.release_branch === this.context.ref) {
      return true;
    } else if (defaultBranch === this.context.ref) {
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

    core.debug(`determined default branch: ${resp.data.default_branch} `);

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
  // Output the version
  const versionCode = await exec('waypoint', ['version']);

  if (versionCode !== 0) {
    throw new Error(
      `Attempt to output Waypoint version failed (exit code ${versionCode}). Waypoint may not be installed. Please
see instructions in the REAMDE for utilizing the setup-waypoint action.`
    );
  }

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
