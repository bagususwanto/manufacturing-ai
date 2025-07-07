import { GoogleGenAI } from '@google/genai';
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { answerResponse } from 'src/shared/interfaces/response.interface';

@Injectable()
export class WarehouseService {
  private ai: GoogleGenAI;

  constructor(private readonly httpService: HttpService) {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  async handleQuery(question: string): Promise<answerResponse> {
    const startTime = Date.now();

    try {
      // 1. Klasifikasi pertanyaan
      const classifiedPrompt = this.classifyQueryPrompt(question);
      const classified = await this.askGemini(classifiedPrompt);
      console.log('Raw classification result:', classified);

      const parsed = this.extractJson(classified);
      const filters: any = {};
      if (parsed.stockStatus) filters.stockStatus = parsed.stockStatus;
      if (parsed.type) filters.type = parsed.type;

      // 2. Query ke API FastAPI
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FASTAPI_URL}/warehouse/search`,
          {
            query: question,
            limit: 10,
            score_threshold: 0.8,
            filters: filters,
          },
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
      console.log('Search response:', response.data);

      const searchResult = response.data;
      const context = searchResult.results
        .map((r: any) => r.payload?.text)
        .filter(Boolean)
        .join('\n\n');

      // 3. Bangun prompt dan generate jawaban
      const prompt = this.buildPrompt(question, context);
      const answer = await this.askGemini(prompt);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

      // Return response in the expected format
      return {
        message: {
          role: 'assistant',
          content: answer,
        },
        done: true,
        metadata: {
          searchResults: searchResult.results,
          totalFound: searchResult.total_found,
          queryTime: totalMinutes,
        },
      };
    } catch (error) {
      console.error('Error in handleQuery:', error);
      return {
        message: {
          role: 'assistant',
          content: 'Maaf, terjadi kesalahan saat memproses pertanyaan Anda.',
        },
        done: true,
        error: error.message,
      };
    }
  }

  private async askGemini(prompt: string): Promise<string> {
    console.log('Asking Gemini with prompt:', prompt);

    const modelFallbacks = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite-preview-06-17',
      'gemma-3-27b-it',
    ];

    for (const model of modelFallbacks) {
      try {
        console.log(`Trying model: ${model}`);
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
        });

        const answer = response.text?.trim();
        if (answer) return answer;

        console.warn(`Model ${model} returned empty response.`);
      } catch (err: any) {
        const message = err?.message?.toLowerCase() || '';
        const isQuotaError =
          err?.response?.status === 429 ||
          message.includes('quota') ||
          message.includes('rate') ||
          message.includes('exceeded') ||
          message.includes('limit');

        console.warn(`Model ${model} error: ${err.message}`);

        // Kalau bukan error quota/limit, langsung throw
        if (!isQuotaError) {
          throw new Error(`Model ${model} gagal: ${err.message}`);
        }

        // Kalau quota error, lanjut ke model berikutnya
        console.info(
          `Model ${model} kena limit, lanjut ke fallback berikutnya...`,
        );
      }
    }

    throw new Error('Semua model gagal merespon.');
  }

  private buildPrompt(question: string, context: string): string {
    return `
Kamu adalah Asisten Warehouse berbahasa Indonesia. Jawablah pertanyaan berikut dengan jelas, lengkap, dan detail.

Pertanyaan:
${question}

${
  context
    ? `Informasi internal gudang:
${context}`
    : `Jawab berdasarkan pengetahuan umum tentang warehouse.`
}
    `.trim();
  }

  private classifyQueryPrompt(question: string): string {
    return `
Tugas kamu adalah mengklasifikasi pertanyaan user ke dalam JSON seperti:

{
  "stockStatus": "critical" | "over" | null,
  "type": "DIRECT" | "INDIRECT" | null
}

Jika pertanyaan tidak relevan dengan status stok dan tipe material, kembalikan null untuk kedua field.

Contoh:
Input: status stok hampir habis material direct
Output:
{
  "stockStatus": "critical",
  "type": "DIRECT"
}

Input: ${question}
Output:
    `.trim();
  }

  private extractJson(text: string): any {
    try {
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('JSON parse error:', err);
      return { stockStatus: null, type: null };
    }
  }
}
