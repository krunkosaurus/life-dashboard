# Project Notes

- After making code changes, rebuild and restart the production dashboard so the user can see the latest version without asking: `npm run build && pm2 restart life-dashboard`. It runs under pm2 with `PORT=3002` and `HOST=tailscale`, so it binds this machine's tailnet address and is reachable from any device on the tailnet. Don't change the port or binding unless asked.
- Never commit sensitive information to the public repository. Before committing or pushing, check staged changes for secrets, tokens, private config, local env files, OAuth credentials, and cache files.
