import { Injectable } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';

@Injectable()
export class VectorService {
  private client: QdrantClient;

  constructor() {
    this.client = new QdrantClient({ url: 'http://localhost:6333' });
  }

  async initCollection() {
    const exists = await this.client
      .getCollection('materials')
      .catch(() => null);
    if (!exists) {
      await this.client.createCollection('materials', {
        vectors: { size: 768, distance: 'Cosine' }, // ukuran embedding dari Ollama
      });
    }
  }

  async upsertVectors(
    points: {
      id: number;
      text: string;
      vector: number[];
      payload: Record<string, any>;
    }[],
  ) {
    await this.client.upsert('materials', {
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: {
          ...p.payload,
          text: p.text,
        },
      })),
    });
  }

  async searchVector(vector: number[]) {
    return this.client.search('materials', {
      vector,
      limit: 5,
      score_threshold: 0.68, // Filter hasil yang tidak relevan
      with_payload: true,
      with_vector: false, // Tidak perlu return vector
    });
  }
}
