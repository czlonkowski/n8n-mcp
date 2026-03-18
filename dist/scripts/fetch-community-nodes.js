#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const community_1 = require("../community");
const node_repository_1 = require("../database/node-repository");
const database_adapter_1 = require("../database/database-adapter");
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        verifiedOnly: false,
        update: false,
        npmLimit: 100,
        staging: false,
    };
    for (const arg of args) {
        if (arg === '--verified-only') {
            options.verifiedOnly = true;
        }
        else if (arg === '--update') {
            options.update = true;
        }
        else if (arg === '--staging') {
            options.staging = true;
        }
        else if (arg.startsWith('--npm-limit=')) {
            const value = parseInt(arg.split('=')[1], 10);
            if (!isNaN(value) && value > 0) {
                options.npmLimit = value;
            }
        }
    }
    return options;
}
function printProgress(message, current, total) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = '='.repeat(Math.floor(percent / 2)) + ' '.repeat(50 - Math.floor(percent / 2));
    process.stdout.write(`\r[${bar}] ${percent}% - ${message} (${current}/${total})`);
    if (current === total) {
        console.log();
    }
}
async function main() {
    const cliOptions = parseArgs();
    console.log('='.repeat(60));
    console.log('  n8n-mcp Community Node Fetcher');
    console.log('='.repeat(60));
    console.log();
    console.log('Options:');
    console.log(`  - Mode: ${cliOptions.update ? 'Update (incremental)' : 'Rebuild'}`);
    console.log(`  - Verified only: ${cliOptions.verifiedOnly ? 'Yes' : 'No'}`);
    if (!cliOptions.verifiedOnly) {
        console.log(`  - npm package limit: ${cliOptions.npmLimit}`);
    }
    console.log(`  - API environment: ${cliOptions.staging ? 'staging' : 'production'}`);
    console.log();
    const dbPath = path_1.default.join(__dirname, '../../data/nodes.db');
    console.log(`Database: ${dbPath}`);
    const db = await (0, database_adapter_1.createDatabaseAdapter)(dbPath);
    const repository = new node_repository_1.NodeRepository(db);
    const environment = cliOptions.staging ? 'staging' : 'production';
    const service = new community_1.CommunityNodeService(repository, environment);
    if (!cliOptions.update) {
        console.log('\nClearing existing community nodes...');
        const deleted = service.deleteCommunityNodes();
        console.log(`  Deleted ${deleted} existing community nodes`);
    }
    const syncOptions = {
        verifiedOnly: cliOptions.verifiedOnly,
        npmLimit: cliOptions.npmLimit,
        skipExisting: cliOptions.update,
        environment,
    };
    console.log('\nFetching community nodes...\n');
    const result = await service.syncCommunityNodes(syncOptions, printProgress);
    console.log('\n' + '='.repeat(60));
    console.log('  Results');
    console.log('='.repeat(60));
    console.log();
    console.log('Verified nodes (Strapi API):');
    console.log(`  - Fetched: ${result.verified.fetched}`);
    console.log(`  - Saved: ${result.verified.saved}`);
    console.log(`  - Skipped: ${result.verified.skipped}`);
    if (result.verified.errors.length > 0) {
        console.log(`  - Errors: ${result.verified.errors.length}`);
        result.verified.errors.forEach((e) => console.log(`    ! ${e}`));
    }
    if (!cliOptions.verifiedOnly) {
        console.log('\nnpm packages:');
        console.log(`  - Fetched: ${result.npm.fetched}`);
        console.log(`  - Saved: ${result.npm.saved}`);
        console.log(`  - Skipped: ${result.npm.skipped}`);
        if (result.npm.errors.length > 0) {
            console.log(`  - Errors: ${result.npm.errors.length}`);
            result.npm.errors.forEach((e) => console.log(`    ! ${e}`));
        }
    }
    const stats = service.getCommunityStats();
    console.log('\nDatabase statistics:');
    console.log(`  - Total community nodes: ${stats.total}`);
    console.log(`  - Verified: ${stats.verified}`);
    console.log(`  - Unverified: ${stats.unverified}`);
    console.log(`\nCompleted in ${(result.duration / 1000).toFixed(1)} seconds`);
    console.log('='.repeat(60));
    db.close();
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=fetch-community-nodes.js.map