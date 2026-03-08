import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { Client, type ClientConfig } from 'pg';
import type { PostgreSQLConfig } from '../../src/adapters/postgresql.adapter';

function parseBooleanEnv(value?: string): boolean | undefined {
    if (typeof value === 'undefined') {
        return undefined;
    }

    if (value === '1' || value.toLowerCase() === 'true') {
        return true;
    }

    if (value === '0' || value.toLowerCase() === 'false') {
        return false;
    }

    return undefined;
}

function getPostgresBaseConfig(): PostgreSQLConfig {
    const connectionString = process.env.HIVE_STREAM_TEST_POSTGRES_URL;
    const ssl = parseBooleanEnv(process.env.HIVE_STREAM_TEST_POSTGRES_SSL);

    if (connectionString) {
        return {
            connectionString,
            ssl
        };
    }

    return {
        host: process.env.HIVE_STREAM_TEST_POSTGRES_HOST || process.env.PGHOST,
        port: Number(process.env.HIVE_STREAM_TEST_POSTGRES_PORT || process.env.PGPORT || 5432),
        user: process.env.HIVE_STREAM_TEST_POSTGRES_USER || process.env.PGUSER || process.env.USER || 'postgres',
        password: process.env.HIVE_STREAM_TEST_POSTGRES_PASSWORD || process.env.PGPASSWORD,
        database: process.env.HIVE_STREAM_TEST_POSTGRES_DB || process.env.PGDATABASE || 'postgres',
        ssl
    };
}

function withPostgresDatabase(config: PostgreSQLConfig, database: string): PostgreSQLConfig {
    if (config.connectionString) {
        const url = new URL(config.connectionString);
        url.pathname = `/${database}`;

        return {
            connectionString: url.toString(),
            ssl: config.ssl
        };
    }

    return {
        ...config,
        database
    };
}

function toPgClientConfig(config: PostgreSQLConfig): ClientConfig {
    if (config.connectionString) {
        return {
            connectionString: config.connectionString,
            ssl: config.ssl
        };
    }

    return {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl
    };
}

function buildPostgresDetectScript(): string {
    return `
        const { Client } = require('pg');
        const connectionString = process.env.HIVE_STREAM_TEST_POSTGRES_URL;
        const sslValue = process.env.HIVE_STREAM_TEST_POSTGRES_SSL;
        const ssl = sslValue === undefined ? undefined : sslValue === '1' || sslValue === 'true';
        const config = connectionString
            ? { connectionString, ssl }
            : {
                host: process.env.HIVE_STREAM_TEST_POSTGRES_HOST || process.env.PGHOST,
                port: Number(process.env.HIVE_STREAM_TEST_POSTGRES_PORT || process.env.PGPORT || 5432),
                user: process.env.HIVE_STREAM_TEST_POSTGRES_USER || process.env.PGUSER || process.env.USER || 'postgres',
                password: process.env.HIVE_STREAM_TEST_POSTGRES_PASSWORD || process.env.PGPASSWORD,
                database: process.env.HIVE_STREAM_TEST_POSTGRES_DB || process.env.PGDATABASE || 'postgres',
                ssl
            };
        const client = new Client(config);
        client.connect()
            .then(() => client.query('select 1'))
            .then(() => client.end())
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    `;
}

function buildMongoDetectScript(): string {
    return `
        const { MongoClient } = require('mongodb');
        const uri = process.env.HIVE_STREAM_TEST_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
        const dbName = process.env.HIVE_STREAM_TEST_MONGODB_DB || process.env.MONGODB_DB || process.env.MONGO_DB || 'admin';
        const client = new MongoClient(uri);
        client.connect()
            .then(() => client.db(dbName).command({ ping: 1 }))
            .then(() => client.close())
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    `;
}

export function isPostgresTestAvailable(): boolean {
    return spawnSync(process.execPath, ['-e', buildPostgresDetectScript()], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'ignore'
    }).status === 0;
}

export function isMongoTestAvailable(): boolean {
    return spawnSync(process.execPath, ['-e', buildMongoDetectScript()], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'ignore'
    }).status === 0;
}

export async function createIsolatedPostgresDatabase(prefix: string = 'hive_stream_test') {
    const baseConfig = getPostgresBaseConfig();
    const adminDb = process.env.HIVE_STREAM_TEST_POSTGRES_ADMIN_DB || 'postgres';
    const dbName = `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`.toLowerCase();
    const adminConfig = withPostgresDatabase(baseConfig, adminDb);
    const admin = new Client(toPgClientConfig(adminConfig));

    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();

    const adapterConfig = withPostgresDatabase(baseConfig, dbName);

    return {
        dbName,
        adapterConfig,
        cleanup: async () => {
            const cleanupClient = new Client(toPgClientConfig(adminConfig));
            await cleanupClient.connect();
            await cleanupClient.query(
                'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
                [dbName]
            );
            await cleanupClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
            await cleanupClient.end();
        }
    };
}

export function getMongoTestUri(): string {
    return process.env.HIVE_STREAM_TEST_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
}

export async function createIsolatedMongoDatabase(prefix: string = 'hive_stream_test') {
    const uri = getMongoTestUri();
    const dbName = `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`.toLowerCase();

    return {
        uri,
        dbName,
        cleanup: async () => {
            const client = new MongoClient(uri);
            await client.connect();
            await client.db(dbName).dropDatabase();
            await client.close();
        }
    };
}
