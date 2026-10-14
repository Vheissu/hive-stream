// PM2 configuration. Build first (`npm run build`), then `pm2 start ecosystem.config.js --env production`.
// Keys and the account name come from the environment (HIVE_ACCOUNT, HIVE_ACTIVE_KEY, HIVE_POSTING_KEY)
// or a .env file read by `env: true`; don't put them in this file.

module.exports = {
  apps: [
    {
      name: 'hive-stream',
      script: 'dist/index.js',
      instances: 1,                 // one streamer per app account: two would both pay out
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 15000,          // enableGracefulShutdown() finishes the current block first
      ignore_watch: ['node_modules'],
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
