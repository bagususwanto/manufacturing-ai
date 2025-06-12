import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { OllamaService } from 'src/shared/llm/ollama.service';
import { VectorService } from './utils/vector.service';
import embedText from './utils/embed-text';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly ollama: OllamaService,
    private readonly vectorService: VectorService,
  ) {}

  async handleQuery(question: string): Promise<any> {
    const startTime = Date.now();
    const vector = await embedText(question);
    const result = await this.vectorService.searchVector(vector);
    console.log('Search results:', result);
    const context = result.map((r) => r.payload?.text).join('\n');
    console.log('Context retrieved:', context);
    const prompt = this.buildPrompt(question, context);
    console.log('Prompt built:', prompt);
    const answer = await this.ollama.ask(prompt);
    console.log('Answer generated:', answer);

    // Hitung waktu total query dalam menit
    const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('Total query time:', totalMinutes, 'minutes');
    return { answer };
  }

  buildPrompt(question: string, context: string): string {
    return `
Anda adalah Asisten AI Warehouse yang membantu menjawab pertanyaan pengguna berdasarkan data yang tersedia.
Jawab dengan bahasa sehari-hari dan jelas menggunakan bahsa Indonesia.

Pertanyaan pengguna:
${question}

${
  context
    ? `Data:
${context}
`
    : ``
}
    `;
  }
}
