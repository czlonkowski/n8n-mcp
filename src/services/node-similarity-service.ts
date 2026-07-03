import { NodeRepository } from '../database/node-repository';
import { logger } from '../utils/logger';
import { ToolVariantGenerator } from './tool-variant-generator';

export interface NodeSuggestion {
  nodeType: string;
  displayName: string;
  confidence: number;
  reason: string;
  category?: string;
  description?: string;
}

export interface SimilarityScore {
  nameSimilarity: number;
  categoryMatch: number;
  packageMatch: number;
  patternMatch: number;
  totalScore: number;
}

export interface CommonMistakePattern {
  pattern: string;
  suggestion: string;
  confidence: number;
  reason: string;
}

export class NodeSimilarityService {
  // Constants to avoid magic numbers
  private static readonly SCORING_THRESHOLD = 50; // Minimum 50% confidence to suggest
  private static readonly TYPO_EDIT_DISTANCE = 2; // Max 2 character differences for typo detection
  private static readonly MIN_CATEGORY_MATCH_LENGTH = 4; // 2-char categories like "ai" match almost anything
  private static readonly SHORT_SEARCH_LENGTH = 5; // Searches ≤5 chars need special handling
  private static readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly AUTO_FIX_CONFIDENCE = 0.9; // 90% confidence for auto-fix

  private repository: NodeRepository;
  private commonMistakes: Map<string, CommonMistakePattern[]>;
  private nodeCache: any[] | null = null;
  private cacheExpiry: number = 0;
  private cacheVersion: number = 0; // Track cache version for invalidation

  constructor(repository: NodeRepository) {
    this.repository = repository;
    this.commonMistakes = this.initializeCommonMistakes();
  }

  /**
   * Initialize common mistake patterns
   * Using safer string-based patterns instead of complex regex to avoid ReDoS
   */
  private initializeCommonMistakes(): Map<string, CommonMistakePattern[]> {
    const patterns = new Map<string, CommonMistakePattern[]>();

    // Case variations - using exact string matching (case-insensitive)
    patterns.set('case_variations', [
      { pattern: 'httprequest', suggestion: 'nodes-base.httpRequest', confidence: 0.95, reason: 'Incorrect capitalization' },
      { pattern: 'webhook', suggestion: 'nodes-base.webhook', confidence: 0.95, reason: 'Incorrect capitalization' },
      { pattern: 'slack', suggestion: 'nodes-base.slack', confidence: 0.9, reason: 'Missing package prefix' },
      { pattern: 'gmail', suggestion: 'nodes-base.gmail', confidence: 0.9, reason: 'Missing package prefix' },
      { pattern: 'googlesheets', suggestion: 'nodes-base.googleSheets', confidence: 0.9, reason: 'Missing package prefix' },
      { pattern: 'telegram', suggestion: 'nodes-base.telegram', confidence: 0.9, reason: 'Missing package prefix' },
    ]);

    // Specific case variations that are common
    patterns.set('specific_variations', [
      { pattern: 'HttpRequest', suggestion: 'nodes-base.httpRequest', confidence: 0.95, reason: 'Incorrect capitalization' },
      { pattern: 'HTTPRequest', suggestion: 'nodes-base.httpRequest', confidence: 0.95, reason: 'Common capitalization mistake' },
      { pattern: 'Webhook', suggestion: 'nodes-base.webhook', confidence: 0.95, reason: 'Incorrect capitalization' },
      { pattern: 'WebHook', suggestion: 'nodes-base.webhook', confidence: 0.95, reason: 'Common capitalization mistake' },
    ]);

    // Deprecated package prefixes
    patterns.set('deprecated_prefixes', [
      { pattern: 'n8n-nodes-base.', suggestion: 'nodes-base.', confidence: 0.95, reason: 'Full package name used instead of short form' },
      { pattern: '@n8n/n8n-nodes-langchain.', suggestion: 'nodes-langchain.', confidence: 0.95, reason: 'Full package name used instead of short form' },
    ]);

    // Common typos - exact matches
    patterns.set('typos', [
      { pattern: 'htprequest', suggestion: 'nodes-base.httpRequest', confidence: 0.8, reason: 'Likely typo' },
      { pattern: 'httpreqest', suggestion: 'nodes-base.httpRequest', confidence: 0.8, reason: 'Likely typo' },
      { pattern: 'webook', suggestion: 'nodes-base.webhook', confidence: 0.8, reason: 'Likely typo' },
      { pattern: 'slak', suggestion: 'nodes-base.slack', confidence: 0.8, reason: 'Likely typo' },
      { pattern: 'googlesheets', suggestion: 'nodes-base.googleSheets', confidence: 0.8, reason: 'Likely typo' },
    ]);

    // AI/LangChain specific
    patterns.set('ai_nodes', [
      { pattern: 'openai', suggestion: 'nodes-langchain.openAi', confidence: 0.85, reason: 'AI node - incorrect package' },
      { pattern: 'nodes-base.openai', suggestion: 'nodes-langchain.openAi', confidence: 0.9, reason: 'Wrong package - OpenAI is in LangChain package' },
      { pattern: 'chatopenai', suggestion: 'nodes-langchain.lmChatOpenAi', confidence: 0.85, reason: 'LangChain node naming convention' },
      { pattern: 'vectorstore', suggestion: 'nodes-langchain.vectorStoreInMemory', confidence: 0.7, reason: 'Generic vector store reference' },
    ]);

    return patterns;
  }

  /**
   * Check if a type is a common node name without prefix
   */
  private isCommonNodeWithoutPrefix(type: string): string | null {
    const commonNodes: Record<string, string> = {
      'httprequest': 'nodes-base.httpRequest',
      'webhook': 'nodes-base.webhook',
      'slack': 'nodes-base.slack',
      'gmail': 'nodes-base.gmail',
      'googlesheets': 'nodes-base.googleSheets',
      'telegram': 'nodes-base.telegram',
      'discord': 'nodes-base.discord',
      'notion': 'nodes-base.notion',
      'airtable': 'nodes-base.airtable',
      'postgres': 'nodes-base.postgres',
      'mysql': 'nodes-base.mySql',
      'mongodb': 'nodes-base.mongoDb',
    };

    const normalized = type.toLowerCase();
    return commonNodes[normalized] || null;
  }

  /**
   * Find similar nodes for an invalid type
   */
  async findSimilarNodes(invalidType: string, limit: number = 5): Promise<NodeSuggestion[]> {
    if (!invalidType || invalidType.trim() === '') {
      return [];
    }

    // Check if this is a Tool variant and base node exists (Issue #522)
    // Dynamic AI Tool variants like googleDriveTool are created at runtime by n8n
    if (ToolVariantGenerator.isToolVariantNodeType(invalidType)) {
      const baseNodeType = ToolVariantGenerator.getBaseNodeType(invalidType);
      if (baseNodeType) {
        const baseNode = this.repository.getNode(baseNodeType);
        if (baseNode) {
          return [{
            nodeType: invalidType,
            displayName: `${baseNode.displayName} Tool`,
            confidence: 0.98,
            reason: `Dynamic AI Tool variant of ${baseNode.displayName}`,
            category: baseNode.category,
            description: 'Runtime-generated Tool variant for AI Agent integration'
          }];
        }
      }
    }

    const suggestions: NodeSuggestion[] = [];

    // First, check for exact common mistakes
    const mistakeSuggestion = this.checkCommonMistakes(invalidType);
    if (mistakeSuggestion) {
      suggestions.push(mistakeSuggestion);
    }

    // Get all nodes (with caching)
    const allNodes = await this.getCachedNodes();

    // Calculate similarity scores for all nodes
    const scores = allNodes.map(node => ({
      node,
      score: this.calculateSimilarityScore(invalidType, node)
    }));

    // Sort by total score and filter high scores
    scores.sort((a, b) => b.score.totalScore - a.score.totalScore);

    // Add top suggestions (excluding already added exact matches)
    for (const { node, score } of scores) {
      if (suggestions.some(s => s.nodeType === node.nodeType)) {
        continue;
      }

      if (score.totalScore >= NodeSimilarityService.SCORING_THRESHOLD) {
        suggestions.push(this.createSuggestion(node, score));
      }

      if (suggestions.length >= limit) {
        break;
      }
    }

    return suggestions;
  }

  /**
   * Check for common mistake patterns (ReDoS-safe implementation)
   */
  private checkCommonMistakes(invalidType: string): NodeSuggestion | null {
    const cleanType = invalidType.trim();
    const lowerType = cleanType.toLowerCase();

    // First check for common nodes without prefix
    const commonNodeSuggestion = this.isCommonNodeWithoutPrefix(cleanType);
    if (commonNodeSuggestion) {
      const node = this.repository.getNode(commonNodeSuggestion);
      if (node) {
        return {
          nodeType: commonNodeSuggestion,
          displayName: node.displayName,
          confidence: 0.9,
          reason: 'Missing package prefix',
          category: node.category,
          description: node.description
        };
      }
    }

    // Check deprecated prefixes (string-based, no regex)
    for (const [category, patterns] of this.commonMistakes) {
      if (category === 'deprecated_prefixes') {
        for (const pattern of patterns) {
          if (cleanType.startsWith(pattern.pattern)) {
            const actualSuggestion = cleanType.replace(pattern.pattern, pattern.suggestion);
            const node = this.repository.getNode(actualSuggestion);
            if (node) {
              return {
                nodeType: actualSuggestion,
                displayName: node.displayName,
                confidence: pattern.confidence,
                reason: pattern.reason,
                category: node.category,
                description: node.description
              };
            }
          }
        }
      }
    }

    // Check exact matches for typos and variations
    for (const [category, patterns] of this.commonMistakes) {
      if (category === 'deprecated_prefixes') continue; // Already handled

      for (const pattern of patterns) {
        // Simple string comparison (case-sensitive for specific_variations)
        const match = category === 'specific_variations'
          ? cleanType === pattern.pattern
          : lowerType === pattern.pattern.toLowerCase();

        if (match && pattern.suggestion) {
          const node = this.repository.getNode(pattern.suggestion);
          if (node) {
            return {
              nodeType: pattern.suggestion,
              displayName: node.displayName,
              confidence: pattern.confidence,
              reason: pattern.reason,
              category: node.category,
              description: node.description
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate multi-factor similarity score
   */
  private calculateSimilarityScore(invalidType: string, node: any): SimilarityScore {
    const cleanInvalid = this.normalizeNodeType(invalidType);
    const cleanValid = this.normalizeNodeType(node.nodeType);
    const displayNameClean = this.normalizeNodeType(node.displayName);

    // Special handling for very short search terms (e.g., "http", "sheet")
    const isShortSearch = invalidType.length <= NodeSimilarityService.SHORT_SEARCH_LENGTH;

    // Name similarity (40% weight)
    let nameSimilarity = Math.max(
      this.getStringSimilarity(cleanInvalid, cleanValid),
      this.getStringSimilarity(cleanInvalid, displayNameClean)
    ) * 40;

    // For short searches that are substrings, give a small name similarity boost
    if (isShortSearch && (cleanValid.includes(cleanInvalid) || displayNameClean.includes(cleanInvalid))) {
      nameSimilarity = Math.max(nameSimilarity, 10);
    }

    // Category match (20% weight) — whole-token match only. Substring matching
    // let short categories like "ai" match inside unrelated long type names
    // (e.g. the "ai" in "langchain"), surfacing nonsense suggestions.
    let categoryMatch = 0;
    if (node.category) {
      const categoryClean = this.normalizeNodeType(node.category);
      if (categoryClean.length >= NodeSimilarityService.MIN_CATEGORY_MATCH_LENGTH) {
        const invalidTokens = invalidType.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        if (invalidTokens.includes(categoryClean)) {
          categoryMatch = 20;
        }
      }
    }

    // Package match (15% weight)
    let packageMatch = 0;
    const invalidParts = cleanInvalid.split(/[.-]/);
    const validParts = cleanValid.split(/[.-]/);

    if (invalidParts[0] === validParts[0]) {
      packageMatch = 15;
    }

    // Pattern match (25% weight)
    let patternMatch = 0;

    // Check if it's a substring match
    if (cleanValid.includes(cleanInvalid) || displayNameClean.includes(cleanInvalid)) {
      // Boost score significantly for short searches that are exact substring matches
      // Short searches need more boost to reach the 50 threshold
      patternMatch = isShortSearch ? 45 : 25;
    } else if (this.getEditDistance(cleanInvalid, cleanValid) <= NodeSimilarityService.TYPO_EDIT_DISTANCE) {
      // Small edit distance indicates likely typo
      patternMatch = 20;
    } else if (this.getEditDistance(cleanInvalid, displayNameClean) <= NodeSimilarityService.TYPO_EDIT_DISTANCE) {
      patternMatch = 18;
    }

    // For very short searches, also check if the search term appears at the start
    if (isShortSearch && (cleanValid.startsWith(cleanInvalid) || displayNameClean.startsWith(cleanInvalid))) {
      patternMatch = Math.max(patternMatch, 40);
    }

    const totalScore = nameSimilarity + categoryMatch + packageMatch + patternMatch;

    return {
      nameSimilarity,
      categoryMatch,
      packageMatch,
      patternMatch,
      totalScore
    };
  }

  /**
   * Create a suggestion object from node and score
   */
  private createSuggestion(node: any, score: SimilarityScore): NodeSuggestion {
    let reason = 'Similar node';

    if (score.patternMatch >= 20) {
      reason = 'Name similarity';
    } else if (score.categoryMatch >= 15) {
      reason = 'Same category';
    } else if (score.packageMatch >= 10) {
      reason = 'Same package';
    }

    // Calculate confidence (0-1 scale)
    const confidence = Math.min(score.totalScore / 100, 1);

    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      confidence,
      reason,
      category: node.category,
      description: node.description
    };
  }

  /**
   * Normalize node type for comparison
   */
  private normalizeNodeType(type: string): string {
    return type
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Calculate string similarity (0-1)
   */
  private getStringSimilarity(s1: string, s2: string, maxDistance: number = 5): number {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    const distance = this.getEditDistance(s1, s2, maxDistance);

    // getEditDistance caps at maxDistance + 1 (a sentinel, not a real
    // distance). Dividing the sentinel by string length would report high
    // similarity for long, completely unrelated strings.
    if (distance > maxDistance) return 0;

    const maxLen = Math.max(s1.length, s2.length);

    return 1 - (distance / maxLen);
  }

  /**
   * Calculate Levenshtein distance with optimizations
   * - Early termination when difference exceeds threshold
   * - Space-optimized to use only two rows instead of full matrix
   * - Fast path for identical or vastly different strings
   */
  private getEditDistance(s1: string, s2: string, maxDistance: number = 5): number {
    // Fast path: identical strings
    if (s1 === s2) return 0;

    const m = s1.length;
    const n = s2.length;

    // Fast path: length difference exceeds threshold
    const lengthDiff = Math.abs(m - n);
    if (lengthDiff > maxDistance) return maxDistance + 1;

    // Fast path: empty strings
    if (m === 0) return n;
    if (n === 0) return m;

    // Space optimization: only need previous and current row
    let prev = Array(n + 1).fill(0).map((_, i) => i);

    for (let i = 1; i <= m; i++) {
      const curr = [i];
      let minInRow = i;

      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        const val = Math.min(
          curr[j - 1] + 1,      // deletion
          prev[j] + 1,          // insertion
          prev[j - 1] + cost    // substitution
        );
        curr.push(val);
        minInRow = Math.min(minInRow, val);
      }

      // Early termination: if minimum in this row exceeds threshold
      if (minInRow > maxDistance) {
        return maxDistance + 1;
      }

      prev = curr;
    }

    return prev[n];
  }

  /**
   * Get cached nodes or fetch from repository
   * Implements proper cache invalidation with version tracking
   */
  private async getCachedNodes(): Promise<any[]> {
    const now = Date.now();

    if (!this.nodeCache || now > this.cacheExpiry) {
      try {
        const newNodes = this.repository.getAllNodes();

        // Only update cache if we got valid data
        if (newNodes && newNodes.length > 0) {
          this.nodeCache = newNodes;
          this.cacheExpiry = now + NodeSimilarityService.CACHE_DURATION_MS;
          this.cacheVersion++;
          logger.debug('Node cache refreshed', {
            count: newNodes.length,
            version: this.cacheVersion
          });
        } else if (this.nodeCache) {
          // Return stale cache if new fetch returned empty
          logger.warn('Node fetch returned empty, using stale cache');
        }
      } catch (error) {
        logger.error('Failed to fetch nodes for similarity service', error);
        // Return stale cache on error if available
        if (this.nodeCache) {
          logger.info('Using stale cache due to fetch error');
          return this.nodeCache;
        }
        return [];
      }
    }

    return this.nodeCache || [];
  }

  /**
   * Invalidate the cache (e.g., after database updates)
   */
  public invalidateCache(): void {
    this.nodeCache = null;
    this.cacheExpiry = 0;
    this.cacheVersion++;
    logger.debug('Node cache invalidated', { version: this.cacheVersion });
  }

  /**
   * Clear and refresh cache immediately
   */
  public async refreshCache(): Promise<void> {
    this.invalidateCache();
    await this.getCachedNodes();
  }

  /**
   * Format suggestions into a user-friendly message
   */
  formatSuggestionMessage(suggestions: NodeSuggestion[], invalidType: string): string {
    if (suggestions.length === 0) {
      return `Unknown node type: "${invalidType}". No similar nodes found.`;
    }

    let message = `Unknown node type: "${invalidType}"\n\nDid you mean one of these?\n`;

    for (const suggestion of suggestions) {
      const confidence = Math.round(suggestion.confidence * 100);
      message += `• ${suggestion.nodeType} (${confidence}% match)`;

      if (suggestion.displayName) {
        message += ` - ${suggestion.displayName}`;
      }

      message += `\n  → ${suggestion.reason}`;

      if (suggestion.confidence >= 0.9) {
        message += ' (can be auto-fixed)';
      }

      message += '\n';
    }

    return message;
  }

  /**
   * Check if a suggestion is high confidence for auto-fixing
   */
  isAutoFixable(suggestion: NodeSuggestion): boolean {
    return suggestion.confidence >= NodeSimilarityService.AUTO_FIX_CONFIDENCE;
  }

  /**
   * Clear the node cache (useful after database updates)
   * @deprecated Use invalidateCache() instead for proper version tracking
   */
  clearCache(): void {
    this.invalidateCache();
  }
}