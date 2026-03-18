import { DatabaseAdapter } from './database-adapter';
import { NodeRepository } from './node-repository';
import { TemplateService } from '../templates/template-service';
export interface SharedDatabaseState {
    db: DatabaseAdapter;
    repository: NodeRepository;
    templateService: TemplateService;
    dbPath: string;
    refCount: number;
    initialized: boolean;
}
export declare function getSharedDatabase(dbPath: string): Promise<SharedDatabaseState>;
export declare function releaseSharedDatabase(state: SharedDatabaseState): void;
export declare function closeSharedDatabase(): Promise<void>;
export declare function isSharedDatabaseInitialized(): boolean;
export declare function getSharedDatabaseRefCount(): number;
//# sourceMappingURL=shared-database.d.ts.map