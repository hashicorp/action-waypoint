import * as core from '@actions/core';
import { exec, ExecOptions } from '@actions/exec';
import { Context } from '@actions/github/lib/context';
import { getOctokit, context } from '@actions/github';
import { Octokit } from '@octokit/core';
import { CallCredentials, ChannelCredentials, Metadata } from '@grpc/grpc-js';
import { readFileSync } from 'fs';

const DEFAULT_WORKSPACE = 'default';
const PROECT_REGEX = /(?<=project = ")[^"]+/;
const APP_REGEX = /(?<=app ")[^"]+/;

export class Ctx {
  // The GitHub token to use, should be passed from the SECRETS value
  github_token: string;

  // An instance of ocotkit that is configured
  octokit: Octokit;

  // The workspace for waypoint operations
  workspace: string;

  // The project for waypoint operations
  project?: string;
  // The app for waypoint operations
  app?: string;

  // The operation we're running
  operation: string;

  waypointToken: string;
  waypointAddress: string;
  waypointAddressUi: string;

  // The associated context
  context: Context;

  constructor() {
    const githubToken = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });

    this.workspace = core.getInput('workspace') || DEFAULT_WORKSPACE;
    this.github_token = githubToken;
    this.octokit = getOctokit(githubToken);
    this.context = context;
    this.operation = core.getInput('operation');

    this.waypointToken =
      process.env.WAYPOINT_SERVER_TOKEN || core.getInput('waypoint_server_token', { required: true });
    this.waypointAddress =
      process.env.WAYPOINT_SERVER_ADDR || core.getInput('waypoint_server_address', { required: true });

    this.waypointAddressUi = process.env.WAYPOINT_SERVER_UI || core.getInput('waypoint_server_ui');

    // Make this available for waypoint exec
    core.exportVariable('WAYPOINT_SERVER_TOKEN', this.waypointToken);
    core.exportVariable('WAYPOINT_SERVER_ADDR', this.waypointAddress);
    core.exportVariable('WAYPOINT_SERVER_UI', this.waypointAddressUi);
    core.exportVariable('WAYPOINT_SERVER_TLS', '1');
    core.exportVariable('WAYPOINT_SERVER_TLS_SKIP_VERIFY', '1');

    // Ensure the Waypoint token is masked from logs
    core.setSecret(this.waypointToken);

    // Currently a well-known waypoint configuration location. This is
    // a hack until we can talk to Waypoint via API.
    const data = readFileSync('waypoint.hcl', 'utf8');
    const project = PROECT_REGEX.exec(data);
    const app = APP_REGEX.exec(data);

    if (project && project.length) {
      this.project = project[0];
    }

    if (app && app.length) {
      this.app = app[0];
    }

    // const creds = createPerRpcChannelCredentials(waypointToken);
    // this.waypoint = new WaypointClient(waypointAddress, creds);
  }

  get uiAppUrl(): string {
    if (this.project && this.app && this.waypointAddressUi) {
      return `${this.waypointAddressUi}/${this.workspace}/${this.project}/app/${this.app}`;
    }
    return '';
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
  const options: ExecOptions = { silent: true };

  core.info('validating Waypoint installation');

  // Output the version
  const versionCode = await exec('waypoint', ['version'], options);

  if (versionCode !== 0) {
    throw new Error(
      `Attempt to output Waypoint version failed (exit code ${versionCode}). Waypoint may not be installed. Please
see instructions in the REAMDE for utilizing the setup-waypoint action.`
    );
  }

  let statusError = '';
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

export async function createContextConfig(ctx: Ctx): Promise<void> {
  core.info('creating Waypoint context configuration');

  const contextCode = await exec('waypoint', [
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

  if (contextCode !== 0) {
    throw new Error(`Failed to setup context for Waypoint to communicate with the server.`);
  }
}
