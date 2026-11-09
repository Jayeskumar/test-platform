// Runs the API server (with reload) and the Vite dev server side by side.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: '\x1b[33m', cmd: 'npm', args: ['run', 'dev', '-w', 'server'] },
  { name: 'web', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '-w', 'web'] },
];

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    for (const c of children) if (c !== child) c.kill();
    process.exit(code ?? 0);
  });
  return child;
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill(sig)));
