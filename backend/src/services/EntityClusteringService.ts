/**
 * Entity Clustering Service (Article Generation 2.0)
 * Clusters enriched entities semantically using Supabase embeddings + type-aware grouping.
 * @module services/EntityClusteringService
 */

import { EnrichedEntity, EntityCluster } from '../types/index.js';
import { SupabaseService } from './SupabaseService.js';
import { logger } from '../utils/logger.js';

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Get max cluster count by target word count.
 */
function maxClusters(targetWordCount: number): number {
  if (targetWordCount < 1200) return 4;
  if (targetWordCount <= 2200) return 6;
  return 8;
}

export class EntityClusteringService {
  private readonly SEMANTIC_THRESHOLD = 0.70;  // Greedy clustering threshold
  private readonly MERGE_THRESHOLD = 0.60;      // Small cluster merge threshold
  private readonly MAX_ENTITIES_PER_CLUSTER = 8;

  constructor(private supabase: SupabaseService) {}

  /**
   * Cluster entities using hybrid approach:
   * 1. Rough grouping by dominant schema.org type
   * 2. Semantic clustering (embeddings) within each type group
   * 3. Merge small clusters
   * 4. Assign entity priorities (critical/supporting/optional)
   * 5. Limit by dynamic word-count-based caps
   *
   * serp_derived entities without KG confirmation cannot become 'critical'.
   */
  async clusterEntities(
    entities: EnrichedEntity[],
    targetWordCount: number
  ): Promise<EntityCluster[]> {
    if (!entities.length) return [];

    // 1. Rough grouping by dominant type
    const typeGroups = new Map<string, EnrichedEntity[]>();
    for (const entity of entities) {
      const dominantType = entity.types[0] ?? 'General';
      if (!typeGroups.has(dominantType)) typeGroups.set(dominantType, []);
      typeGroups.get(dominantType)!.push(entity);
    }

    // 2. Generate embeddings for all entities
    logger.info(`EntityClustering: generating embeddings for ${entities.length} entities`);
    const embeddingMap = new Map<string, number[]>();
    for (const entity of entities) {
      const text = `${entity.name}${entity.description ? ' ' + entity.description : ''}`;
      try {
        const embedding = await this.supabase.getEmbedding(text);
        embeddingMap.set(entity.name, embedding);
      } catch (err) {
        logger.warn(`EntityClustering: embedding failed for "${entity.name}"`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Semantic clustering within each type group (greedy, sorted by salience desc)
    const rawClusters: Array<{ entities: EnrichedEntity[]; centroidEmbedding: number[] }> = [];

    for (const [, groupEntities] of typeGroups) {
      const sorted = [...groupEntities].sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));

      for (const entity of sorted) {
        const emb = embeddingMap.get(entity.name);
        if (!emb) continue;

        // Find existing cluster with highest similarity to this entity
        let bestCluster: { entities: EnrichedEntity[]; centroidEmbedding: number[] } | null = null;
        let bestSim = this.SEMANTIC_THRESHOLD;

        for (const cluster of rawClusters) {
          if (cluster.entities.length >= this.MAX_ENTITIES_PER_CLUSTER) continue;
          // Only merge within same rough type group
          const clusterType = cluster.entities[0]?.types[0] ?? 'General';
          const entityType = entity.types[0] ?? 'General';
          if (clusterType !== entityType) continue;

          const sim = cosineSimilarity(emb, cluster.centroidEmbedding);
          if (sim > bestSim) {
            bestSim = sim;
            bestCluster = cluster;
          }
        }

        if (bestCluster) {
          bestCluster.entities.push(entity);
          // Update centroid to average of all entity embeddings in cluster
          bestCluster.centroidEmbedding = this.averageEmbeddings(
            bestCluster.entities.map(e => embeddingMap.get(e.name)).filter(Boolean) as number[][]
          );
        } else {
          rawClusters.push({ entities: [entity], centroidEmbedding: emb });
        }
      }
    }

    // 4. Merge small clusters (< 2 entities) if possible
    const singletons = rawClusters.filter(c => c.entities.length < 2);
    const multiClusters = rawClusters.filter(c => c.entities.length >= 2);

    for (const singleton of singletons) {
      const entity = singleton.entities[0];
      const emb = embeddingMap.get(entity.name);
      if (!emb) continue;

      // Try to merge with nearest multi-cluster
      let bestCluster: typeof multiClusters[0] | null = null;
      let bestSim = this.MERGE_THRESHOLD;

      for (const cluster of multiClusters) {
        if (cluster.entities.length >= this.MAX_ENTITIES_PER_CLUSTER) continue;
        const sim = cosineSimilarity(emb, cluster.centroidEmbedding);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = cluster;
        }
      }

      if (bestCluster) {
        bestCluster.entities.push(entity);
        bestCluster.centroidEmbedding = this.averageEmbeddings(
          bestCluster.entities.map(e => embeddingMap.get(e.name)).filter(Boolean) as number[][]
        );
      } else if ((entity.salience ?? 0) >= 0.7) {
        // High-salience singleton survives on its own
        multiClusters.push(singleton);
      }
      // Low-salience singletons are dropped
    }

    // 5. Limit cluster count by word count
    const maxC = maxClusters(targetWordCount);
    // Sort by total score desc
    multiClusters.sort((a, b) => {
      const scoreA = a.entities.reduce((s, e) => s + e.score, 0);
      const scoreB = b.entities.reduce((s, e) => s + e.score, 0);
      return scoreB - scoreA;
    });
    const finalClusters = multiClusters.slice(0, maxC);

    // 6. Build EntityCluster objects with metadata
    const result: EntityCluster[] = finalClusters.map((raw, idx) => {
      const sorted = [...raw.entities].sort((a, b) => b.score - a.score);

      // Assign priorities — critical max 2, supporting max 3, rest optional
      // serp_derived without KG confirmation cannot be critical
      const withPriority = sorted.map((entity, i) => {
        const canBeCritical = entity.confirmedBy.includes('google_kg');
        let priority: 'critical' | 'supporting' | 'optional';
        if (i < 2 && canBeCritical) priority = 'critical';
        else if (i < 5) priority = 'supporting';
        else priority = 'optional';
        return { ...entity, priority } as EnrichedEntity;
      });

      // Coherence score — avg pairwise similarity
      const embeddings = withPriority
        .map(e => embeddingMap.get(e.name))
        .filter(Boolean) as number[][];
      const coherenceScore = this.computeCoherence(embeddings);

      const dominantTypes = this.computeDominantTypes(withPriority);

      return {
        id: idx,
        label: withPriority[0]?.name ?? `Cluster ${idx}`,
        entities: withPriority,
        coherenceScore,
        centroidEntityName: withPriority[0]?.name ?? '',
        dominantTypes,
      };
    });

    logger.info(`EntityClustering: ${entities.length} entities → ${result.length} clusters`, {
      clusters: result.map(c => ({ id: c.id, label: c.label, count: c.entities.length, coherence: c.coherenceScore.toFixed(2) })),
    });

    return result;
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (!embeddings.length) return [];
    const len = embeddings[0].length;
    const avg = new Array(len).fill(0) as number[];
    for (const emb of embeddings) {
      for (let i = 0; i < len; i++) avg[i] += emb[i];
    }
    return avg.map(v => v / embeddings.length);
  }

  private computeCoherence(embeddings: number[][]): number {
    if (embeddings.length < 2) return 1.0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        sum += cosineSimilarity(embeddings[i], embeddings[j]);
        count++;
      }
    }
    return count === 0 ? 0 : sum / count;
  }

  private computeDominantTypes(entities: EnrichedEntity[]): string[] {
    const typeCount = new Map<string, number>();
    for (const entity of entities) {
      for (const t of entity.types) {
        typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
      }
    }
    return [...typeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
  }
}
