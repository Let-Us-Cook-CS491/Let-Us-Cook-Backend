module.exports = {
    apps: [
      {
        name: "LetUsCook-Backend",
        script: "./src/index.js",
        cron_restart: "0 */6 * * *",
        env: {
          NODE_ENV: "production"
        }
      }
    ]
  };
  
