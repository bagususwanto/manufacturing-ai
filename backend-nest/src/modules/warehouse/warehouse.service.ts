import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { OllamaService } from 'src/shared/llm/ollama.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly ollama: OllamaService,
    private readonly httpService: HttpService,
  ) {}

  async handleQuery(question: string): Promise<any> {
    console.log('Received question:', question);
    const startTime = Date.now();

    try {
      // Call Python API using HttpService
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FASTAPI_URL}/warehouse/search`,
          {
            query: question,
            limit: 5,
            score_threshold: 0.4,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const searchResult = response.data;
      console.log('Search results from Python API:', searchResult);

      // Extract context from search results
      const context = searchResult.results
        .map((r: any) => r.payload?.text)
        .filter((text: string) => text)
        .join('\n');

      console.log('Context retrieved:', context);

      // Build prompt with question and context
      const prompt = this.buildPrompt(question, context);
      console.log('Prompt built:', prompt);

      // Generate answer using Ollama
      const answer = await this.ollama.ask(prompt);
      console.log('Answer generated:', answer);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log('Total query time:', totalMinutes, 'minutes');

      return {
        answer,
        searchResults: searchResult.results,
        totalFound: searchResult.total_found,
        queryTime: totalMinutes,
      };
    } catch (error) {
      console.error('Error in handleQuery:', error);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log('Query failed after:', totalMinutes, 'minutes');

      throw error;
    }
  }

  buildPrompt(question: string, context: string): string {
    return `
Anda adalah Asisten AI Warehouse yang membantu menjawab pertanyaan pengguna berdasarkan data yang tersedia.
Jawab dengan bahasa sehari-hari dan jelas menggunakan bahasa Indonesia.

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
