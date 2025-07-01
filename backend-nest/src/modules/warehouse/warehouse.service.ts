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
      const classifiedQuestion = this.classifyQueryPrompt(question);
      const classified = await this.ollama.ask(classifiedQuestion, 'phi3:mini');
      console.log('Raw response from Ollama:', classified);

      const parsed = this.extractJson(classified);
      console.log('Parsed JSON:', parsed);

      // Validasi struktur JSON dulu
      const stockStatus = parsed.stockStatus ?? null;
      const materialType = parsed.type ?? null;
      const filters: any = {};
      if (stockStatus) filters.stockStatus = stockStatus;
      if (materialType) filters.type = materialType;

      // Call Python API using HttpService
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FASTAPI_URL}/warehouse/search`,
          {
            query: question,
            limit: 5,
            score_threshold: 0.2,
            filters: filters,
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
        .join('\n\n'); // ← 2 enter antar hasil

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
  Kamu adalah Asisten Warehouse berbahasa Indonesia. Jawablah pertanyaan berikut dengan jelas, lengkap, dan profesional.
  Gunakan informasi berikut secara implisit, **tanpa menyebutkan atau merujuk pada sumber data atau konteks**, dan jawab seolah kamu tahu kondisi gudang secara langsung. Berikan detail jika tersedia.

  Pertanyaan:
  ${question}

  ${
    context
      ? `Informasi internal gudang:
  ${context}`
      : `Jika tidak ada informasi tambahan, jawab berdasarkan pengetahuan umum tentang warehouse.`
  }
    `.trim();
  }

  classifyQueryPrompt(question: string) {
    return `
Tugas kamu adalah mengambil informasi *filter* dari permintaan user tentang kondisi stok gudang.

Jawaban dalam format JSON, hanya dengan key:
- stockStatus: salah satu dari ["critical", "normal", "over"] atau null jika tidak disebut
- type: salah satu dari ["DIRECT", "INDIRECT"] atau null jika tidak disebut

Keterangan:
- "critical" berarti stok hampir habis / butuh pengadaan / dibawah minimum
- "normal" berarti stok cukup / aman
- "over" berarti stok berlebih / di atas maksimum
- "DIRECT" dan "INDIRECT" adalah tipe material

Contoh:

Input: status stok hampir habis material direct  
Output:
{
  "stockStatus": "critical",
  "type": "DIRECT"
}

Sekarang proses input berikut:

Input: ${question}
Output:
  `.trim();
  }

  extractJson(text: string): any {
    try {
      // Cari blok JSON pertama di dalam string
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const jsonStr = jsonMatch[0];
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error('Failed to extract JSON:', err);
      return { stockStatus: null, type: null };
    }
  }
}
