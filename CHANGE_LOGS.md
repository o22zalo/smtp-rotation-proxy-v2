# Changelog

## [2.0.0] - 2026-05-19
### Added
- Express API integration (`/api/accounts`, `/api/rules`, `/api/stats`, etc.)
- Firebase Realtime Database integration for storage
- SPA UI under `ui/` (Vanilla JS, HTML, CSS)
- Support per-request account override based on SMTP AUTH credentials
- Support `fromName` and `fromAddress` override in SMTP emails
- Docker, Docker Compose, and Caddyfile templates
- Import and Export tools for JSON and CSV

### Changed
- Refactored `rotator.js` to dynamically load accounts and rules from Firebase
- Config fallback using `config.js` when Firebase is not available
- TCP Shim updated for explicit timeouts and logging
