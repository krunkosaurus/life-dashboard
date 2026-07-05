# Project Notes

- After making code changes, rebuild and restart the local production dashboard on `127.0.0.1:3002` so the user can see the latest version without asking. Use the existing `npm start -- -p 3002` flow unless the user asks for a different port or mode.
- Never commit sensitive information to the public repository. Before committing or pushing, check staged changes for secrets, tokens, private config, local env files, OAuth credentials, and cache files.
