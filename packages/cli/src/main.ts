#!/usr/bin/env node
/** Thin shell around `run`, which returns an exit code rather than calling exit. */

import { run } from './index.ts';

process.exitCode = await run(process.argv.slice(2));
