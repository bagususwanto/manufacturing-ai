import axios from 'axios';
import { VectorService } from './vector.service';
import { Item } from '../interfaces/item.interface';
import embedText from './embed-text';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processItem(item: Item): Promise<{
  id: number;
  text: string;
  vector: number[];
  payload: Record<string, any>;
}> {
  const text = `
    Material ${item.materialNo} (${item.description}) merupakan barang kategori ${item.category} dengan tipe ${item.type}.
    Barang ini berlokasi di ${item.addressRackName} (${item.storageName}), pada plant ${item.plant} dan warehouse ${item.warehouse}.
    Supplier-nya adalah ${item.supplier}. Packaging: ${item.packaging ? `${item.packagingUnit} ${item.uom} dalam kemasan ${item.packaging}` : 'tidak ada'}, satuan: ${item.uom}.
    Harga per satuan adalah ${item.price}. Minimum order: ${item.minOrder}.
    Material ini menggunakan MRP tipe ${item.mrpType}, dengan minimum stock ${item.minStock} dan maksimum ${item.maxStock}.
    Stok terakhir diketahui: ${item.stock != null ? `${item.stock} ${item.uom}` : 'tidak diketahui'}, diperbarui pada ${item.stockUpdatedAt || 'Unknown'} oleh ${item.stockUpdatedBy || 'Unknown'}.
  `
    .replace(/\s+/g, ' ')
    .trim();

  const vector = await embedText(text);

  return {
    id: Number(item.id),
    text,
    vector,
    payload: {
      materialCode: item.materialNo,
      name: item.description,
      addressRackName: item.addressRackName,
      storageName: item.storageName,
      supplier: item.supplier,
      plant: item.plant,
      warehouse: item.warehouse,
      packaging: item.packaging,
      packagingUnit: item.packagingUnit,
      uom: item.uom,
      price: item.price,
      type: item.type,
      category: item.category,
      minOrder: item.minOrder,
      mrpType: item.mrpType,
      minStock: item.minStock,
      maxStock: item.maxStock,
      stock: item.stock,
      stockUpdatedAt: item.stockUpdatedAt,
      stockUpdatedBy: item.stockUpdatedBy,
    },
  };
}

async function processBatch(
  items: Item[],
  vectorService: VectorService,
  startIndex: number,
  batchSize: number,
) {
  const batch = items.slice(startIndex, startIndex + batchSize);

  console.log(`Processing batch ${startIndex / batchSize + 1}...`);
  const vectorData = await Promise.all(batch.map((item) => processItem(item)));

  console.log(`Upserting vectors for batch ${startIndex / batchSize + 1}...`);
  await vectorService.upsertVectors(vectorData);

  const progress = (((startIndex + batchSize) / items.length) * 100).toFixed(1);
  console.log(
    `Progress: ${progress}% (${startIndex + batchSize}/${items.length} items)`,
  );
}

async function processBatchParallel(
  items: Item[],
  vectorService: VectorService,
  startIndex: number,
  batchSize: number,
  concurrencyLimit = 5, // max parallel embedding at once
) {
  const batch = items.slice(startIndex, startIndex + batchSize);
  console.log(`Processing batch ${startIndex / batchSize + 1}...`);

  const results: any[] = [];
  let index = 0;

  async function worker() {
    while (index < batch.length) {
      const i = index++;
      const item = batch[i];
      try {
        const processed = await processItem(item);
        results[i] = processed;
      } catch (error) {
        console.error(
          `Error processing item ${item.materialNo}:`,
          error.message,
        );
      }
    }
  }

  // Jalankan worker secara paralel
  const workers = Array.from({ length: concurrencyLimit }, () => worker());
  await Promise.all(workers);

  console.log(`Upserting vectors for batch ${startIndex / batchSize + 1}...`);
  await vectorService.upsertVectors(results.filter(Boolean));

  const progress = Math.min(
    ((startIndex + batchSize) / items.length) * 100,
    100,
  ).toFixed(1);

  console.log(
    `Progress: ${progress}% (${Math.min(startIndex + batchSize, items.length)}/${items.length})`,
  );
}

export async function loadMaterials() {
  console.log('Starting to load materials...');
  const res = await axios.get('http://localhost:5010/api/material-all');
  const data = res.data;
  console.log(`Found ${data.length} materials to process`);

  const vectorService = new VectorService();
  await vectorService.initCollection();
  console.log('Vector collection initialized');

  const BATCH_SIZE = 10; // Process 20 items at a time
  const DELAY_BETWEEN_BATCHES = 100; // 0.5 second delay between batches

  const startTime = Date.now();
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    await processBatchParallel(data, vectorService, i, BATCH_SIZE, 5); // 5 concurrent workers
    if (i + BATCH_SIZE < data.length) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000 / 60).toFixed(1);
  console.log(
    `Completed processing ${data.length} materials in ${duration} minutes`,
  );
}
