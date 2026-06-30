#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');
const envArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex);
const commandArgs = separatorIndex === -1 ? args : args.slice(separatorIndex + 1);

if (commandArgs.length === 0) {
  throw new Error('Usage: node src/run/with-env.mjs KEY=value ... -- command [args...]');
}

const env = { ...process.env };
for (const entry of envArgs) {
  const equalsIndex = entry.indexOf('=');
  if (equalsIndex <= 0) {
    throw new Error(`Invalid environment assignment '${entry}'. Expected KEY=value.`);
  }

  const key = entry.slice(0, equalsIndex);
  const value = entry.slice(equalsIndex + 1);
  env[key] = value;
}

const [command, ...commandLine] = commandArgs;
const child = spawn(command, commandLine, {
  stdio: 'inherit',
  shell: false,
  env,
});

child.once('error', error => {
  console.error(error);
  process.exit(1);
});

child.once('exit', code => {
  process.exit(code ?? 1);
});
