# GitHub Issues Extractor

## Overview
A TypeScript tool that fetches issues and comments from GitHub repositories and stores them in a SQLite database with support for incremental updates.

## Usage
```
npm start -- owner repo token [dbname]
```

## Setup
```bash
npm install
npm run build
```

## Features
- Extracts all issues (open/closed) from a GitHub repository
- Retrieves and stores all comments for each issue
- Supports incremental updates (only fetches new issues)
- Detects and updates modified comments
- Handles database schema upgrades automatically

## Database Schema
- `issues`: id, number, title, body, updated_at
- `comments`: id, issue_id, body, updated_at

## Process Flow
1. Check/create SQLite database tables
2. Find highest issue number in database
3. Fetch new issues via GitHub API with pagination
4. Store new issues and their comments
5. Update changed comments on existing issues
6. Report statistics on processed items

## Dependencies
- Node.js
- TypeScript
- sqlite3

## Example Output
```
Using database: facebook-react.db
Created new database
Starting from issue #0
Processing issues page 1
Done! Processed 350 issues.
Added 350 new issues.
Added 1423 new comments.
```

## Limitations
- No support for issue attachments or reactions
- Limited to core issue metadata
- Not optimized for very large repositories