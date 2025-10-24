import { GoogleGenAI } from '@google/genai';
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { answerResponse } from 'src/shared/interfaces/response.interface';
import suggestions from './data/suggestions.json';
import { RetrievalService } from './retrieval.service';

@Injectable()
export class WarehouseService {
  private ai: GoogleGenAI;

  constructor(
    private readonly httpService: HttpService,
    private readonly retrievalService: RetrievalService,
  ) {
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
      const { context, response } = await this.retrieveContext(
        question,
        intent,
      );

      console.log('Context:', context);
      console.log('Response:', response);

      const prompt = this.buildPrompt(question, context);
      const answer = await this.askGemini(prompt);

      const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

      return {
        message: { role: 'assistant', content: answer },
        done: true,
        metadata: {
          intent,
          searchResults: response?.results || [],
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
Kamu adalah sistem klasifikasi intent untuk asisten warehouse material dan inventory.
Tugasmu adalah mengembalikan JSON **valid saja** yang menjelaskan maksud utama dari pertanyaan user.

### Format Output (JSON Only)
{
  "intent": string,
  "materialTarget": string | null,
  "reportType": "daily" | "weekly" | "monthly" | "range" | null,
  "type": "DIRECT" | "INDIRECT" | null,
  "organizationTarget": string | null
}

### Daftar intent yang valid:
- "cek_stok" → untuk melihat stok material tertentu
- "stok_hampir_habis" → untuk mencari material dengan stok menipis
- "stok_over" → untuk mencari material yang stoknya berlebih
- "lokasi_material" → untuk mengetahui lokasi penyimpanan suatu material
- "penerimaan" → untuk menanyakan penerimaan material (barang masuk)
- "pengeluaran" → untuk menanyakan pengeluaran material (barang keluar)
- "laporan" → untuk menampilkan laporan aktivitas atau stok (harian, mingguan, bulanan, atau range)
- "bandingkan_stok" → untuk membandingkan stok antar lokasi / gudang
- "aktivitas_gudang" → untuk melihat aktivitas gudang (penerimaan, pengeluaran, dsb)
- "material_tidak_bergerak" → untuk mencari material yang tidak ada pergerakan stok
- "forecasting" → untuk meminta prediksi kebutuhan atau stok di masa depan
- "umum" → untuk pertanyaan umum di luar konteks warehouse

### Aturan tambahan:
- Jika user menanyakan jumlah, kondisi, atau keberadaan stok → intent = "cek_stok"
- Jika menyinggung stok menipis atau “hampir habis” → intent = "stok_hampir_habis"
- Jika menyinggung stok berlebih → intent = "stok_over"
- Jika menanyakan lokasi material → intent = "lokasi_material"
- Jika menyebut penerimaan, barang masuk, GR → intent = "penerimaan"
- Jika menyebut pengeluaran, barang keluar, issue → intent = "pengeluaran"
- Jika user membandingkan stok antar lokasi/gudang → intent = "bandingkan_stok" dan "comparison": true
- Jika pertanyaan terkait laporan → intent = "laporan" dan isi "reportType" (daily, weekly, monthly, atau range)
- Jika menyinggung aktivitas gudang secara umum → intent = "aktivitas_gudang"
- Jika menyebut material tidak bergerak / stagnant → intent = "material_tidak_bergerak"
- Jika menyinggung prediksi, estimasi, atau forecast → intent = "forecasting"
- Jika tidak cocok dengan kategori di atas → intent = "umum"

### Aturan untuk material:
- "materialTarget" dapat berupa **nama material** (contoh: "wire galvanis") atau **kode material** (contoh: "B851-308084")
- Jika ada kata atau kode yang tampak seperti ID material (huruf + angka, seperti "B851-308084" atau "B851-45"), masukkan ke dalam "materialTarget"
- Jika tidak ada material spesifik disebutkan, isi dengan null
- Selalu isi "null" untuk field yang tidak relevan
- Jangan menambahkan teks lain di luar JSON (tidak boleh ada penjelasan tambahan)

### Contoh:
Input: "cek stok wire galvanis"
Output: {"intent":"cek_stok","materialTarget":"wire galvanis","reportType":null,"type":null,"organizationTarget":null}

Input: "cek stok B851-308084"
Output: {"intent":"cek_stok","materialTarget":"B851-308084","reportType":null,"type":null,"organizationTarget":null}

Input: "tampilkan laporan bulanan gudang consumable"
Output: {"intent":"laporan","materialTarget":null,"reportType":"monthly","type":null,"organizationTarget":"consumable"}

Input: "bandingkan stok antara gudang karawang dan packing store"
Output: {"intent":"bandingkan_stok","materialTarget":null,"reportType":null,"type":null,"organizationTarget":null}

Sekarang klasifikasikan input berikut:
"${question}"

Output:
`.trim();

    const result = await this.askGemini(prompt);
    return this.extractJson(result);
  }

  // ✅ STEP 2: Context Retrieval (baru)
  private async retrieveContext(question: string, intent: any): Promise<any> {
    const {
      intent: intentName,
      materialTarget,
      reportType,
      organizationTarget,
    } = intent;

    let response: any;

    switch (intentName) {
      case 'cek_stok':
        response = await this.retrievalService.getStock(materialTarget);
        break;
      case 'stok_hampir_habis':
        response = await this.retrievalService.getCriticalStock();
        break;
      case 'stok_over':
        response = await this.retrievalService.getOverStock();
        break;
      case 'lokasi_material':
        response =
          await this.retrievalService.getMaterialLocation(materialTarget);
        break;
      case 'bandingkan_stok':
        response = await this.retrievalService.compareStock(organizationTarget);
        break;
      case 'aktivitas_gudang':
        response =
          await this.retrievalService.getWarehouseActivity(organizationTarget);
        break;
      case 'laporan':
        response = await this.retrievalService.generateReport(
          reportType,
          organizationTarget,
        );
        break;
      case 'material_tidak_bergerak':
        response = await this.retrievalService.getInactiveMaterials();
        break;
      case 'forecasting':
        response = await this.retrievalService.getForecast(materialTarget);
        break;
      case 'umum':
      default:
        response = {};
        break;
    }

    const context = Array.isArray(response)
      ? response.map((r) => JSON.stringify(r)).join('\n')
      : typeof response === 'object'
        ? JSON.stringify(response, null, 2)
        : String(response || '');

    return { context, response };
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
Kamu adalah Asisten Warehouse berbahasa Indonesia.
Jawabanmu harus singkat tapi jelas, berdasarkan konteks internal jika ada.

Pertanyaan pengguna:
${question}

${
  context
    ? `Data warehouse relevan:\n${context}`
    : `Tidak ada data internal ditemukan.`
}

Instruksi tambahan:
- Jika pertanyaan tentang stok, tampilkan angka dan kondisi stok jika ada.
- Jika tentang laporan, berikan ringkasan (harian/mingguan/bulanan).
- Jika perbandingan, buat tabel teks sederhana antar gudang.
- Jika tidak ada data yang cocok, beri jawaban umum dengan saran tindakan selanjutnya.
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
