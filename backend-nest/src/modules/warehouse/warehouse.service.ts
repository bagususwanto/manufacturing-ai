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

      console.log('Retrieved context:', context);

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
Kamu adalah sistem klasifikasi intent untuk asisten warehouse (gudang material & inventory). 
Tugasmu adalah mengembalikan hasil klasifikasi dalam format JSON **valid saja** tanpa teks tambahan di luar JSON.

---

### Format Output (JSON Only)
{
  "intent": "cek_stok" | "stok_hampir_habis" | "stok_over" | "lokasi_material" | "penerimaan" | "pengeluaran" | "laporan" | "bandingkan_stok" | "aktivitas_gudang" | "material_tidak_bergerak" | "forecasting" | "umum",
  "stockStatus": "critical" | "over" | "normal" | null,
  "materialTarget": string | null,
  "comparison": boolean,
  "reportType": "daily" | "weekly" | "monthly" | null,
  "type": "DIRECT" | "INDIRECT" | null
}

---

### Aturan Umum:
1. **Jangan pernah memasukkan kata seperti “produksi”, “direct”, atau “non-produksi” ke dalam materialTarget.**  
   Kata-kata tersebut hanya digunakan untuk menentukan nilai pada field **type**.
2. **materialTarget** hanya diisi jika user menyebut **nama material spesifik**, contoh:
   - "besi", "semen", "oli", "cat", "sparepart", dll.
   Jika tidak ada nama material spesifik → isi **null**.
3. **type** diisi hanya jika disebut secara eksplisit:
   - Jika ada kata seperti **“direct”** atau **“produksi”** → **type: "DIRECT"**
   - Jika ada kata seperti **“indirect”** atau **“non-produksi”** → **type: "INDIRECT"**
   - Jika tidak disebut → **type: null**
4. Pastikan hasil akhir **hanya berisi JSON valid**, tanpa penjelasan tambahan atau teks lain.

---

### Panduan Penentuan Intent:
- Tanya jumlah / ketersediaan → **cek_stok**
- Stok hampir habis → **stok_hampir_habis**, **stockStatus: "critical"**
- Stok berlebih → **stok_over**, **stockStatus: "over"**
- Lokasi material → **lokasi_material**
- Penerimaan → **penerimaan**
- Pengeluaran → **pengeluaran**
- Laporan → **laporan**, tentukan **reportType** jika disebut (daily, weekly, monthly)
- Perbandingan stok → **bandingkan_stok**, **comparison: true**
- Aktivitas keluar masuk → **aktivitas_gudang**
- Material tidak bergerak lama → **material_tidak_bergerak**
- Prediksi stok / tren → **forecasting**
- Tidak jelas → **umum**

---

### Contoh Input & Output:

Input: "cek stok besi ulir"
Output: {"intent":"cek_stok","stockStatus":null,"materialTarget":"besi ulir","comparison":false,"reportType":null,"type":null}

Input: "cek stok material untuk produksi"
Output: {"intent":"cek_stok","stockStatus":null,"materialTarget":null,"comparison":false,"reportType":null,"type":"DIRECT"}

Input: "laporan bulanan pengeluaran material non-produksi"
Output: {"intent":"laporan","stockStatus":null,"materialTarget":null,"comparison":false,"reportType":"monthly","type":"INDIRECT"}

Input: "bandingkan stok oli produksi dan grease antara gudang A dan B"
Output: {"intent":"bandingkan_stok","stockStatus":null,"materialTarget":"oli, grease","comparison":true,"reportType":null,"type":"DIRECT"}

---

Sekarang analisis pertanyaan berikut dan hasilkan **JSON valid saja**:
"${question}"
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
