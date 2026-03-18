"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const database_adapter_1 = require("../database/database-adapter");
const logger_1 = require("../utils/logger");
async function migrate() {
    console.log('============================================================');
    console.log('  n8n-mcp Database Migration: README & AI Documentation');
    console.log('============================================================\n');
    const dbPath = process.env.N8N_MCP_DB_PATH || path_1.default.join(process.cwd(), 'data', 'nodes.db');
    console.log(`Database: ${dbPath}\n`);
    const db = await (0, database_adapter_1.createDatabaseAdapter)(dbPath);
    try {
        const tableInfo = db.prepare('PRAGMA table_info(nodes)').all();
        const existingColumns = new Set(tableInfo.map((col) => col.name));
        const columnsToAdd = [
            { name: 'npm_readme', type: 'TEXT', description: 'Raw README markdown from npm registry' },
            { name: 'ai_documentation_summary', type: 'TEXT', description: 'AI-generated structured summary (JSON)' },
            { name: 'ai_summary_generated_at', type: 'DATETIME', description: 'When the AI summary was generated' },
        ];
        let addedCount = 0;
        let skippedCount = 0;
        for (const column of columnsToAdd) {
            if (existingColumns.has(column.name)) {
                console.log(`  [SKIP] Column '${column.name}' already exists`);
                skippedCount++;
            }
            else {
                console.log(`  [ADD]  Column '${column.name}' (${column.type})`);
                db.exec(`ALTER TABLE nodes ADD COLUMN ${column.name} ${column.type}`);
                addedCount++;
            }
        }
        console.log('\n============================================================');
        console.log('  Migration Complete');
        console.log('============================================================');
        console.log(`  Added: ${addedCount} columns`);
        console.log(`  Skipped: ${skippedCount} columns (already exist)`);
        console.log('============================================================\n');
        const verifyInfo = db.prepare('PRAGMA table_info(nodes)').all();
        const verifyColumns = new Set(verifyInfo.map((col) => col.name));
        const allPresent = columnsToAdd.every((col) => verifyColumns.has(col.name));
        if (allPresent) {
            console.log('Verification: All columns present in database.\n');
        }
        else {
            console.error('Verification FAILED: Some columns are missing!\n');
            process.exit(1);
        }
    }
    finally {
        db.close();
    }
}
migrate().catch((error) => {
    logger_1.logger.error('Migration failed:', error);
    process.exit(1);
});
//# sourceMappingURL=migrate-readme-columns.js.map