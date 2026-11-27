// PM2 process file for the EC2 server (optional: see docs/PERFORMANCE.md → Deployment).
//   pm2 delete hr && pm2 start ecosystem.config.cjs && pm2 save
// Next.js reads .env.local itself; PORT defaults to 3000 (set PORT in the environment if nginx proxies elsewhere).
module.exports = {
  apps: [{
    name: 'hr',
    cwd: __dirname,
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    exec_mode: 'fork',
    instances: 1,               // one process: the in-memory rate limiter assumes it (lib/rate-limit.ts)
    max_memory_restart: '700M', // restart instead of swapping if memory ever runs away; lower it on a 1 GB instance
    kill_timeout: 10000,        // let in-flight requests finish on restart
    time: true,                 // timestamps in the pm2 logs
    env: { NODE_ENV: 'production', SLOW_QUERY_MS: '1500' },
  }],
};
