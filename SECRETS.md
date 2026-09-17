# GitHub Secrets Required

This project uses DigitalOcean deployment via GitHub Actions. Configure these secrets in your repository settings:

**Settings → Secrets and variables → Actions**

## Backend Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `DO_HOST` | Production DigitalOcean droplet IP/hostname | `162.243.1.1` |
| `DO_HOST_STAGING` | Staging DigitalOcean droplet IP/hostname | `162.243.1.2` |
| `DO_PORT` | SSH port | `22` |
| `DO_USER` | SSH user | `root` |
| `DO_SSH_KEY` | SSH private key for the droplet | (private key content) |
| `BACKEND_URL` | Public production backend URL | `https://server.shohojhisab.com` |
| `BACKEND_URL_STAGING` | Public staging backend URL | `https://staging.shohojhisab.com` |
| `FRONTEND_URL` | Public production frontend URL | `https://shohojhisab.com` |
| `FRONTEND_URL_STAGING` | Public staging frontend URL | `https://staging.shohojhisab.com` |
| `WEB_ORIGIN` | Comma-separated CORS allowlist | `http://localhost:3020,https://shohojhisab.com,https://mobile.shohojhisab.com` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://pos:pass@host:5432/pos?schema=public` |
| `JWT_SECRET` | JWT access token secret | (32+ bytes hex) |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | (32+ bytes hex) |
| `PLATFORM_BOOTSTRAP_TOKEN` | One-time platform bootstrap token | (32+ bytes hex) |
| `ALLOW_PLATFORM_BOOTSTRAP` | Enable/disable bootstrap | `1` or `0` |
| `PORT` | Server port | `4000` |

## Frontend Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `DO_HOST` | Same as backend | |
| `DO_HOST_STAGING` | Same as backend | |
| `DO_PORT` | Same as backend | |
| `DO_USER` | Same as backend | |
| `DO_SSH_KEY` | Same as backend | |
| `BACKEND_URL` | Same as backend | |
| `BACKEND_URL_STAGING` | Same as backend | |
| `FRONTEND_URL` | Same as backend | |
| `FRONTEND_URL_STAGING` | Same as backend | |

## Adding Secrets via CLI

```bash
# Install GitHub CLI
gh auth login

# Set a secret
gh secret set DO_HOST --body="162.243.1.1" --repo="owner/repo"
gh secret set DO_SSH_KEY --body="$(cat ~/.ssh/id_ed25519)" --repo="owner/repo"
gh secret set BACKEND_URL --body="https://server.shohojhisab.com" --repo="owner/repo"
```

## Environment Variables in CI

The CI workflows use a **resolve-config** job that reads secrets based on the target environment:

- **Production** (`main` branch, releases, or `environment=production`): Uses `DO_HOST`, `BACKEND_URL`, `FRONTEND_URL`
- **Staging** (`develop` branch, or `environment=staging`): Uses `DO_HOST_STAGING`, `BACKEND_URL_STAGING`, `FRONTEND_URL_STAGING`

## Workflow Triggers

| Trigger | Environment |
|---------|-------------|
| Push to `main` | Production (auto-deploy via SSH) |
| Push to `develop` | Staging (auto-deploy via SSH) |
| `workflow_dispatch` | User-selected environment |
| Release published | Production |

All deployments use SSH + `corepack`/`pnpm` on the DigitalOcean droplet. No Docker involved.
