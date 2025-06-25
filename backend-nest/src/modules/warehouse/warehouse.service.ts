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

  async handleQuery(question: string, model: string): Promise<any> {
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
            score_threshold: 0.831,
            status: null,
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

      // Build prompt with question and context
      const prompt = this.buildPrompt(question, context);
      console.log('Prompt built:', prompt);

      // Generate answer using Ollama (we know it returns a string)
      const answer: string = await this.ollama.ask(prompt, model);
      console.log('Answer generated:', answer);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log('Total query time:', totalMinutes, 'minutes');

      // Return format yang kompatibel dengan Open WebUI
      return {
        message: {
          role: 'assistant',
          content: answer, // answer is already a string
        },
        done: true,
        // Data tambahan untuk debugging (opsional)
        metadata: {
          searchResults: searchResult.results,
          totalFound: searchResult.total_found,
          queryTime: totalMinutes,
        },
      };
    } catch (error) {
      console.error('Error in handleQuery:', error);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log('Query failed after:', totalMinutes, 'minutes');

      // Return error response yang tetap kompatibel
      return {
        message: {
          role: 'assistant',
          content:
            'Maaf, terjadi kesalahan saat memproses pertanyaan Anda. Silakan coba lagi.',
        },
        done: true,
        error: error.message,
      };
    }
  }

  buildPrompt(question: string, context: string): string {
    return `
    Kamu adalah Asisten Warehouse AI, kamu akan menjawab pertanyaan dibawah dengan Bahasa Indonesia.
    Pertanyaan:
    ${question}
    
${
  context
    ? `Data:
    ${context}
`
    : `Kamu adalah Asisten Warehouse AI, kamu akan menjawab pertanyaan tentang warehouse.`
}
    `;
  }
}
