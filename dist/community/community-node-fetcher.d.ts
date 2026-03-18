export interface StrapiCommunityNodeAttributes {
    name: string;
    displayName: string;
    description: string;
    packageName: string;
    authorName: string;
    authorGithubUrl?: string;
    npmVersion: string;
    numberOfDownloads: number;
    numberOfStars: number;
    isOfficialNode: boolean;
    isPublished: boolean;
    nodeDescription: any;
    nodeVersions?: any[];
    checksum?: string;
    createdAt: string;
    updatedAt: string;
}
export interface StrapiCommunityNode {
    id: number;
    attributes: StrapiCommunityNodeAttributes;
}
export interface StrapiPaginatedResponse<T> {
    data: Array<{
        id: number;
        attributes: T;
    }>;
    meta: {
        pagination: {
            page: number;
            pageSize: number;
            pageCount: number;
            total: number;
        };
    };
}
export interface NpmPackageInfo {
    name: string;
    version: string;
    description: string;
    keywords: string[];
    date: string;
    links: {
        npm: string;
        homepage?: string;
        repository?: string;
    };
    author?: {
        name?: string;
        email?: string;
        username?: string;
    };
    publisher?: {
        username: string;
        email: string;
    };
    maintainers: Array<{
        username: string;
        email: string;
    }>;
}
export interface NpmSearchResult {
    package: NpmPackageInfo;
    score: {
        final: number;
        detail: {
            quality: number;
            popularity: number;
            maintenance: number;
        };
    };
    searchScore: number;
}
export interface NpmSearchResponse {
    objects: NpmSearchResult[];
    total: number;
    time: string;
}
export interface NpmPackageWithReadme {
    name: string;
    version: string;
    description?: string;
    readme?: string;
    readmeFilename?: string;
    homepage?: string;
    repository?: {
        type?: string;
        url?: string;
    };
    keywords?: string[];
    license?: string;
    'dist-tags'?: {
        latest?: string;
    };
}
export declare class CommunityNodeFetcher {
    private readonly strapiBaseUrl;
    private readonly npmSearchUrl;
    private readonly npmRegistryUrl;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly strapiPageSize;
    private readonly npmPageSize;
    private readonly npmPackageNameRegex;
    constructor(environment?: 'production' | 'staging');
    private validatePackageName;
    private isRateLimitError;
    private retryWithBackoff;
    fetchVerifiedNodes(progressCallback?: (message: string, current: number, total: number) => void): Promise<StrapiCommunityNode[]>;
    fetchNpmPackages(limit?: number, progressCallback?: (message: string, current: number, total: number) => void): Promise<NpmSearchResult[]>;
    fetchPackageJson(packageName: string, version?: string): Promise<any | null>;
    getPackageTarballUrl(packageName: string, version?: string): Promise<string | null>;
    fetchPackageWithReadme(packageName: string): Promise<NpmPackageWithReadme | null>;
    fetchReadmesBatch(packageNames: string[], progressCallback?: (message: string, current: number, total: number) => void, concurrency?: number): Promise<Map<string, string | null>>;
    getPackageDownloads(packageName: string, period?: 'last-week' | 'last-month'): Promise<number | null>;
    private sleep;
}
//# sourceMappingURL=community-node-fetcher.d.ts.map