#!/usr/bin/env node
/**
 * Starts the whole stack for local development:
 *   backend  → http://localhost:4000
 *   user app → http://localhost:5173
 *   admin    → http://localhost:5174
 *
 * Each child inherits stdio so logs stay readable. Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const children = [];
function run(name, cwd, command, args, color) {
  const child = spawn(command, args, {
    cwd: path.join(root, cwd),
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => console.log(`${prefix} exited with code ${code}`));
  children.push(child);
  return child;
}

run('api', 'backend', 'node', ['src/server.js'], '36');
run('user', 'user-app', 'npm', ['run', 'dev'], '35');
run('admin', 'admin-app', 'npm', ['run', 'dev'], '34');

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
