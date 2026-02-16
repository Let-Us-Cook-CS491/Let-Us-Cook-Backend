module.exports = {
    apps: [
      {
        name: "LetUsCook-Backend",
        script: "./src/server.js",
        cron_restart: "0 */6 * * *",
        env: {
          NODE_ENV: "production"
        }
      }
    ]
  };
  
