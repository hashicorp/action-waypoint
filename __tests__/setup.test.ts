import io = require('@actions/io');
import fs = require('fs');
import os = require('os');
import path = require('path');
import nock from 'nock';
import { Ctx } from '../src/setup';
import * as core from '@actions/core';

describe('setup tests', () => {
  let inputs = {} as any;

  beforeAll(function () {
    // We don't want any real http requests in the tests
    // nock.disableNetConnect();
  });

  beforeEach(async function () {
    const inSpy = jest.spyOn(core, 'getInput');
    inSpy.mockImplementation((name) => inputs[name]);
  });

  afterEach(function () {
    jest.resetAllMocks();
    jest.clearAllMocks();
  });

  afterAll(async function () {});

  it('constructs a context', async () => {
    inputs['github_token'] = 'foobar';

    new Ctx();
  });
});
