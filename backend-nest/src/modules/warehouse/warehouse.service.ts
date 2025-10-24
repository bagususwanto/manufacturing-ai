import { GoogleGenAI } from '@google/genai';
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { answerResponse } from 'src/shared/interfaces/response.interface';
import suggestions from './data/suggestions.json';

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
      const intent = await this.classifyIntent(question);
      console.log('Intent result:', intent);

      // ✅ Jika intent umum → kirim suggestion
      if (intent.intent === 'umum') {
        return {
          message: {
            role: 'assistant',
            content: `
Saya kurang mengerti pertanyaan Anda. Mungkin maksudnya seperti ini?

Saran pertanyaan yang bisa Anda coba:
${this.getSuggestions()
  .map((s, i) => `${i + 1}. ${s.title.join(' ')}`)
  .join('\n')}
      `.trim(),
          },
          done: true,
        };
      }

      // ✅ Lanjut kalau intent jelas
      const { context, searchResult } = await this.retrieveContext(
        question,
        intent,
      );

      const prompt = this.buildPrompt(question, context);
      const answer = await this.askGemini(prompt);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

      return {
        message: { role: 'assistant', content: answer },
        done: true,
        metadata: {
          intent,
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

  // ✅ STEP 1: Intent Classification
  private async classifyIntent(question: string): Promise<any> {
    const prompt = `
  Kamu adalah sistem klasifikasi intent untuk asisten warehouse. 
  Tugasmu menentukan maksud utama pertanyaan user.

  Klasifikasikan input berikut menjadi JSON valid.

  Format JSON:
  {
    "intent": string,
    "stockStatus": "critical" | "over" | "normal" | null,
    "materialTarget": string | null,
    "comparison": boolean,
    "reportType": "daily" | "weekly" | "monthly" | null,
    "type": "DIRECT" | "INDIRECT" | null
  }

  Pilihan intent yang valid:
  - "cek_stok"
  - "stok_hampir_habis"
  - "stok_over"
  - "lokasi_material"
  - "penerimaan"
  - "pengeluaran"
  - "laporan"
  - "bandingkan_stok"
  - "aktivitas_gudang"
  - "material_tidak_bergerak"
  - "forecasting"
  - "umum"

  Aturan:
  - Jika user tanya informasi stok → intent: "cek_stok"
  - Jika tanya material hampir habis → "stok_hampir_habis"
  - Jika tanya perbandingan stok antar gudang → bandingkan_stok + "comparison": true
  - Jika tanya laporan → intent "laporan" + jenis reportType jika ada
  - Jika tidak bisa dikenali → intent "umum"
  - Isi null untuk field yang tidak relevan

  Contoh:
  Input: "cek stok besi ulir"
  Output: {"intent":"cek_stok","stockStatus":null,"materialTarget":"besi ulir","comparison":false,"reportType":null,"type":null}

  Input: "tampilkan laporan harian gudang"
  Output: {"intent":"laporan","stockStatus":null,"materialTarget":null,"comparison":false,"reportType":"daily","type":null}

  Input: "${question}"
  Output:
  `.trim();

    const result = await this.askGemini(prompt);
    return this.extractJson(result);
  }

  // ✅ STEP 2: Context Retrieval (baru)
  private async retrieveContext(
    question: string,
    intent: any,
  ): Promise<{ context: string; searchResult: any }> {
    const filters: any = {};

    if (intent.stockStatus) filters.stockStatus = intent.stockStatus;
    if (intent.type) filters.type = intent.type;

    // Tentukan endpoint FastAPI berdasarkan intent
    let endpoint = '/warehouse/search';
    // switch (intent.intent) {
    //   case 'penerimaan':
    //     endpoint = '/warehouse/receiving/search';
    //     break;
    //   case 'pengeluaran':
    //     endpoint = '/warehouse/issue/search';
    //     break;
    //   default:
    //     endpoint = '/warehouse/search';
    // }

    const url = `${process.env.FASTAPI_URL}${endpoint}`;
    console.log(`Fetching context from: ${url}`);

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          query: question,
          limit: 10,
          score_threshold: 0.8,
          filters,
        },
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const searchResult = response.data;

    const context =
      searchResult.results
        ?.map((r: any) => r.payload?.text)
        ?.filter(Boolean)
        ?.join('\n\n') || '';

    return { context, searchResult };
  }

  // ✅ STEP 3: Response Generator
  private async askGemini(prompt: string): Promise<string> {
    const modelFallbacks = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite-preview-06-17',
      'gemma-3-27b-it',
    ];

    for (const model of modelFallbacks) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
        });
        const answer = response.text?.trim();
        if (answer) return answer;
      } catch (err: any) {
        const isQuotaError =
          err?.response?.status === 429 ||
          /quota|limit|exceeded|rate/i.test(err?.message);
        if (!isQuotaError) throw err;
      }
    }
    throw new Error('Semua model gagal merespon.');
  }

  // ✅ STEP 4: Prompt Builder
  private buildPrompt(question: string, context: string): string {
    return `
Kamu adalah Asisten Warehouse berbahasa Indonesia. Jawablah pertanyaan berikut dengan jelas, lengkap, dan berbasis data internal jika tersedia.

Pertanyaan:
${question}

${
  context
    ? `Informasi internal gudang:\n${context}`
    : `Tidak ada data internal yang relevan. Jawab secara umum berdasarkan logika warehouse.`
}
    `.trim();
  }

  // ✅ JSON Extractor
  private extractJson(text: string): any {
    try {
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('JSON parse error:', err);
      return { intent: 'umum', stockStatus: null, type: null };
    }
  }

  private getSuggestions() {
    return suggestions;
  }
}
