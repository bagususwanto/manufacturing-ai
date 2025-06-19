import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { OllamaService } from 'src/shared/llm/ollama.service';
import { firstValueFrom } from 'rxjs';
import { Item } from './interfaces/item.interface';
import * as natural from 'natural';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly ollama: OllamaService,
    private readonly httpService: HttpService,
  ) {}

  async handleQuery(question: string): Promise<any> {
    console.log('Received question:', question);
    const startTime = Date.now();

    const adjusted = preprocessStockQuestion(question);
    console.log('Adjusted question:', adjusted);

    //     const questionAdjusted =
    //       adjusted?.result ??
    //       (await this.ollama.ask(`
    // Perbaiki pertanyaan berikut menjadi satu kalimat pertanyaan lengkap dan formal, tanpa mengubah maksud aslinya untuk menanyakan kondisi stok material di warehouse.

    // Pertanyaan:
    // "${question}"

    // 🔹 Jangan ubah maksud utama.
    // 🔹 Jangan tambahkan teori, jenis, atau penjelasan lain.
    // 🔹 Jawaban HARUS berupa kalimat pertanyaan formal.

    // Jawaban hanya berupa kalimat pertanyaan. Tidak boleh ada penjelasan tambahan.
    // `));

    console.log('Question adjusted:', question);

    let status: string | null = null;
    const intent = adjusted?.intent;
    console.log('Intent:', intent);

    if (intent === 'overstock') {
      status = 'Overstock (Terlalu Banyak)';
    } else if (intent === 'understock') {
      status = 'Critical (Kritis)';
    } else {
      status = null;
    }

    // 🔍 Cek apakah ini pertanyaan tentang stok kritis
    // if (this.isCriticalStockQuestion(question)) {
    //   console.log('Detected critical stock query. Handling separately...');
    //   return this.handleCriticalStock(question);
    // }

    try {
      // Call Python API using HttpService
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FASTAPI_URL}/warehouse/search`,
          {
            query: question,
            limit: 5,
            score_threshold: 0.2,
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

  // Fungsi sederhana untuk deteksi pertanyaan stok kritis
  isCriticalStockQuestion(question: string): boolean {
    const keywords = [
      'stok kritis',
      'stock kritis',
      'kritis',
      'hampir habis',
      'stok hampir habis',
      'stock minimum',
      'persediaan minimum',
      'stok rendah',
    ];
    const lowerQuestion = question.toLowerCase();
    return keywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  // 🔁 Handler khusus untuk stok kritis
  async handleCriticalStock(question: string): Promise<any> {
    const startTime = Date.now();

    const response = await firstValueFrom(
      this.httpService.get(
        `${process.env.TWIIS_URL}/inventory-status?status=critical&limit=10`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const texts = response.data
      .map((item: Item) => {
        return `Material ${item.materialNo} (${item.description}) merupakan barang kategori ${item.category} dengan tipe ${item.type}.
Material ini disimpan di lokasi rak ${item.addressRackName}, dalam gudang ${item.storageName}, bagian dari ${item.warehouse}, plant ${item.plant}.
Dipasok oleh ${item.supplier}, dengan satuan ${item.uom} dan harga ${item.price}.
Status stok saat ini adalah *${item.stockStatus}*, dengan jumlah stok ${item.stock} (Min: ${item.minStock}, Max: ${item.maxStock}).
Terakhir diperbarui pada ${item.stockUpdatedAt} oleh ${item.stockUpdatedBy}.
Tipe MRP: ${item.mrpType}, Minimum Order: ${item.minOrder}.
${item.packaging ? `Pengemasan: ${item.packaging} (${item.packagingUnit})` : `Tidak ada informasi pengemasan.`}
`;
      })
      .join('\n\n');

    const prompt = this.buildPrompt(question, texts);

    console.log('Prompt built:', prompt);
    const answer = await this.ollama.ask(prompt);
    console.log('Answer generated:', answer);

    const totalMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('Total query time:', totalMinutes, 'minutes');

    return {
      answer,
      queryTime: totalMinutes,
    };
  }

  buildPrompt(question: string, context: string): string {
    return `
    Pertanyaan:
${question}

${
  context
    ? `Context:
${context}
`
    : `Kamu adalah Asisten Warehouse AI, kamu akan menjawab pertanyaan tentang warehouse.`
}
    `;
  }
}

const keywordGroups = [
  {
    intent: 'overstock',
    result:
      'Material apa saja yang stoknya terlalu banyak di warehouse saat ini? Jelaskan secara detail.',
    keywords: ['stok over', 'stok berlebih', 'kelebihan stok', 'overstock'],
  },
  {
    intent: 'understock',
    result:
      'Material apa saja yang saat ini berada dalam kondisi stok kritis di warehouse?',
    keywords: ['stok kritis', 'stok rendah', 'kekurangan stok', 'understock'],
  },
  {
    intent: 'outofstock',
    result: 'Apakah ada material yang stoknya kosong di warehouse saat ini?',
    keywords: ['stok kosong', 'habis', 'tidak tersedia'],
  },
];

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface bestMatch {
  intent: string;
  result: string;
  score: number;
}

export function preprocessStockQuestion(rawQuestion: string): bestMatch | null {
  const question = clean(rawQuestion);
  const threshold = 0.6;

  let bestMatch: bestMatch | null = null;

  for (const group of keywordGroups) {
    for (const keyword of group.keywords) {
      const distance = natural.JaroWinklerDistance(question, keyword);
      if (distance > threshold && (!bestMatch || distance > bestMatch.score)) {
        bestMatch = {
          intent: group.intent,
          result: group.result,
          score: distance,
        };
      }
    }
  }

  return bestMatch;
}
