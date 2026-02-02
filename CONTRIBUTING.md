# Contributing to Flux Operations Center

Thank you for your interest in contributing to Flux Operations Center!

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a feature branch (`git checkout -b feature/amazing-feature`)

## Development Setup

```bash
# Clone and setup
git clone https://github.com/YOUR_USERNAME/flux_ops_center_spcs.git
cd flux_ops_center_spcs

# Copy environment template and configure
cp .env.template .env
# Edit .env with your Snowflake credentials

# Install backend dependencies
pip install -r backend/requirements.txt

# Install frontend dependencies
npm install

# Run locally
# Terminal 1 - Backend
SNOWFLAKE_CONNECTION_NAME=<your_connection> uvicorn backend.server_fastapi:app --host 0.0.0.0 --port 3001 --reload

# Terminal 2 - Frontend
npm run dev
```

## Code Standards

- **Python**: Follow PEP 8 style guidelines
- **TypeScript**: Use TypeScript for all frontend code
- **Commits**: Use conventional commit messages (`feat:`, `fix:`, `docs:`)

## Pull Request Process

1. Ensure both backend and frontend run locally
2. Test with your Snowflake connection
3. Update documentation if needed
4. Submit PR with clear description of changes
5. Link related issues

## Testing

```bash
# Backend linting
pylint backend/*.py

# Frontend build check
npm run build
```

## Architecture

- **Frontend**: React 18, TypeScript, DeckGL, MapLibre GL
- **Backend**: FastAPI, Uvicorn
- **Data**: Snowflake (analytics) + Snowflake Postgres (transactional)

See [docs/INDEX.md](./docs/INDEX.md) for full documentation.

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- Include reproduction steps and environment details
- For security issues, see [SECURITY.md](./SECURITY.md)

## Related Repositories

Flux Operations Center is part of the Flux Utility Platform:

| Repository | Purpose |
|------------|---------|
| [Flux Utility Solutions](https://github.com/sfc-gh-abannerjee/flux-utility-solutions) | Core platform with Cortex AI |
| [Flux Data Forge](https://github.com/sfc-gh-abannerjee/flux-data-forge) | Synthetic data generation |
| **Flux Ops Center** (this repo) | Grid visualization |

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
