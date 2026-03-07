# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Hive Stream is a Node.js library for streaming and reacting to blockchain actions on the Hive blockchain. It provides a layer for monitoring blockchain operations, executing contracts, and managing time-based actions. The library includes adapters for data persistence (SQLite, MongoDB) and supports custom smart contracts.

## Development Commands

### Building and Development
- `npm run build` - Compiles TypeScript to JavaScript using tsconfig.build.json
- `npm run watch` - Watches TypeScript files and recompiles on changes
- `npm start` - Runs the test file (src/test.ts) using ts-node

### Testing and Quality
- `npm test` - Runs Jest tests with verbose output from tests/ directory
- `npm run clean-tests` - Clears Jest cache

### Code Quality
- Uses TSLint with custom rules in tslint.json (single quotes, no console restrictions)
- TypeScript configuration targets esnext with CommonJS modules
- Jest configured with ts-jest for TypeScript testing

## Code Style Guidelines
- Always use curly braces for if statements and never shorthand

## Architecture

### Core Components

**Streamer (`src/streamer.ts`)**: The main class that manages blockchain streaming, operation processing, and contract execution. Handles block processing, subscriptions, and maintains connection to Hive API nodes.

**Contracts (`src/contracts/`)**: Smart contract implementations including dice, coinflip, and lotto games. Contracts follow a lifecycle pattern with `create()`, `destroy()`, and `updateBlockInfo()` methods.

**Adapters (`src/adapters/`)**: Data persistence layer with base adapter class and implementations for SQLite and MongoDB. Adapters handle state management, block processing, and data storage.

**Configuration (`src/config.ts`)**: Centralized configuration management supporting environment variables for keys, API endpoints, and blockchain parameters.

### Key Features

**Blockchain Streaming**: Monitors Hive blockchain for specific operations (transfers, custom JSON, posts, comments) with configurable block intervals and fallback API nodes.

**Contract System**: Supports custom smart contracts that execute based on blockchain operations. Contracts can process transfers and custom JSON operations with automatic payload validation.

**Time-based Actions**: Executes contract methods on scheduled intervals (3s, 30s, 1m, 15m, 30m, 1h, 12h, 24h, weekly).

**Multi-adapter Support**: Pluggable adapter system for different storage backends with automatic state persistence and action management.

### Database Schema

When using adapters, the library maintains:
- Block state (last processed block number)
- Time-based actions with scheduling metadata
- Operation logs and contract execution history

### Environment Variables

Required for blockchain operations:
- `ACTIVE_KEY` - For token transfers and active operations
- `POSTING_KEY` - For posting operations and signatures

### Deployment

The library includes PM2 configuration in `ecosystem.config.js` for production deployment. The main entry point expects a compiled JavaScript file at the project root.

### Testing Strategy

Tests are located in `tests/` directory with:
- Contract testing with mock data in `entrants.json`
- Adapter testing for data persistence
- Streamer functionality testing
- Utility function testing

The test setup in `tests/setup.ts` configures the testing environment for blockchain operations.