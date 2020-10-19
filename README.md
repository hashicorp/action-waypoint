# action-waypoint

**Note: This is an experiment and isn't recommended for consistent usage. For anything beyond
experimental, we recommend using [action-setup-waypoint](https://github.com/hashicorp/action-setup-waypoint).**

This action provides an abstraction for working with Waypoint
and the GitHub releases and commit statuses APIs. It is
intended to be the easiest way to automatically deploy
applications with GitHub and Waypoint, only requiring that
you are running a Waypoint server and have configured
actions as below.

If you want to run the waypoint binary in actions
directly, without automatic status and release annotations,
see [action-setup-waypoint](https://github.com/hashicorp/action-setup-waypoint).

## Usage

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: hashicorp/action-waypoint
    name: Setup
    with:
      version: '0.0.1-beta1'
      github_token: ${{ secrets.GITHUB_TOKEN }}
      waypoint_server_address: 'waypoint.example.com:9701'
      waypoint_server_ui: 'https://waypoint.example.com:9702'
      waypoint_server_token: ${{ secrets.WAYPOINT_SERVER_TOKEN }}
      workspace: default
  - uses: hashicorp/action-waypoint
    name: Build
    with:
      operation: build
      version: '0.0.1-beta1'
      github_token: ${{ secrets.GITHUB_TOKEN }}
      workspace: default
  - uses: hashicorp/action-waypoint
    name: Deploy
    with:
      operation: deploy
      version: '0.0.1-beta1'
      github_token: ${{ secrets.GITHUB_TOKEN }}
      workspace: default
  - uses: hashicorp/action-waypoint
    name: Release
    if: ${{ github.ref == 'refs/heads/main' }}
    with:
      operation: release
      version: '0.0.1-beta1'
      github_token: ${{ secrets.GITHUB_TOKEN }}
      workspace: default
```

## Inputs

| Input                     | Description                                                                      | Default        | Required |
| ------------------------- | -------------------------------------------------------------------------------- | -------------- | -------- |
| `version`                 | The version of Waypoint to install                                               |                | ✔        |
| `operation`               | The Waypoint operation to run. Should be one of `build`, `deploy`, or `release`. |                | ✔        |
| `workspace`               | The Waypoint workspace to create resources in                                    |                | ✔        |
| `github_token`            | The GitHub token for interactions with the GitHub API                            | Built in token |          |
| `waypoint_server_address` | The gRPC address of the Waypoint server (persisted for future steps)             |                | ✔        |
| `waypoint_server_ui`      | The HTTP address of the Waypoint server (persisted for future steps)             |                | ✔        |
| `waypoint_server_token`   | The Waypoint server token for authentication (persisted for future steps)        |                | ✔        |

## Development

Install the dependencies

```bash
$ npm install
```

Build the typescript and package it for distribution

```bash
$ npm run build && npm run package
```

Run the tests

```bash
$ npm test
...
```
