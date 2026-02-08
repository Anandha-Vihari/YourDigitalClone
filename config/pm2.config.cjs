module.exports = {
  apps: [
    {
      name: "yourdigitalclone",
      script: "src/core/bot.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      },
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "./debug/pm2-err.log",
      out_file: "./debug/pm2-out.log"
    }
  ]
};
