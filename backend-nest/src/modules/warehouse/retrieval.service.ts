import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';

@Injectable()
export class RetrievalService {
  private pool: sql.ConnectionPool;

  constructor() {
    // Inisialisasi koneksi SQL Server
    this.pool = new sql.ConnectionPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      server: process.env.DB_HOST,
      database: process.env.DB_NAME,
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    });

    this.pool.connect().catch((err) => {
      console.error('❌ DB connection error:', err);
    });
  }

  /** ✅ Cek stok material tertentu */
  async getStock(materialKeyword: string) {
    if (!materialKeyword) return 'Material tidak disebutkan.';

    const query = `
    SELECT TOP 10 
      m.materialNo,
      m.description,
      i.quantityActualCheck,
      m.uom,
      ar.addressRackName,
      s.storageName,
      w.warehouseName
    FROM Inventory i
    INNER JOIN Material m ON i.materialId = m.id
    LEFT JOIN Address_Rack ar ON i.addressId = ar.id
    LEFT JOIN Storage s ON ar.storageId = s.id
    LEFT JOIN Plant p ON s.plantId = p.id
    LEFT JOIN Warehouse w ON p.warehouseId = w.id
    WHERE m.materialNo LIKE @keyword
       OR m.description LIKE @keyword
  `;

    const result = await this.pool
      .request()
      .input('keyword', sql.VarChar, `%${materialKeyword}%`)
      .query(query);

    console.log('Stock query result:', result.recordset);

    if (result.recordset.length === 0) return 'Data stok tidak ditemukan.';
    return result.recordset;
  }

  /** ✅ Stok menipis (hampir habis) */
  async getCriticalStock() {
    const query = `
      SELECT MaterialCode, MaterialName, StockQty, MinStock, Location
      FROM Inventory
      WHERE StockQty <= MinStock
      ORDER BY StockQty ASC
    `;
    const result = await this.pool.request().query(query);
    if (result.recordset.length === 0) return 'Tidak ada stok kritis.';
    return this.formatStockResult(result.recordset);
  }

  /** ✅ Stok berlebih */
  async getOverStock() {
    const query = `
      SELECT MaterialCode, MaterialName, StockQty, MaxStock, Location
      FROM Inventory
      WHERE StockQty >= MaxStock
      ORDER BY StockQty DESC
    `;
    const result = await this.pool.request().query(query);
    if (result.recordset.length === 0) return 'Tidak ada stok berlebih.';
    return this.formatStockResult(result.recordset);
  }

  /** ✅ Lokasi penyimpanan material */
  async getMaterialLocation(materialName: string) {
    const query = `
      SELECT MaterialCode, MaterialName, Location, Bin, Rack
      FROM Inventory
      WHERE MaterialName LIKE @materialName
    `;
    const result = await this.pool
      .request()
      .input('materialName', sql.VarChar, `%${materialName}%`)
      .query(query);

    if (result.recordset.length === 0)
      return 'Lokasi material tidak ditemukan.';
    return result.recordset
      .map(
        (r) =>
          `📦 ${r.MaterialName} disimpan di ${r.Location} (Bin: ${r.Bin || '-'}, Rack: ${r.Rack || '-'})`,
      )
      .join('\n');
  }

  /** ✅ Bandingkan stok antar gudang */
  async compareStock(organizationTarget: string) {
    const query = `
      SELECT Location, SUM(StockQty) AS TotalStock
      FROM Inventory
      WHERE Location IN (${organizationTarget
        ?.split(',')
        .map((x) => `'${x.trim()}'`)
        .join(',')})
      GROUP BY Location
    `;
    const result = await this.pool.request().query(query);
    if (result.recordset.length === 0)
      return 'Data tidak ditemukan untuk lokasi tersebut.';
    return result.recordset
      .map((r) => `🏭 ${r.Location}: ${r.TotalStock} unit`)
      .join('\n');
  }

  /** ✅ Aktivitas gudang (penerimaan/pengeluaran) */
  async getWarehouseActivity(org?: string) {
    const query = `
      SELECT TOP 20 TransDate, TransType, MaterialName, Qty, Location
      FROM WarehouseActivity
      ${org ? 'WHERE Location = @org' : ''}
      ORDER BY TransDate DESC
    `;
    const req = this.pool.request();
    if (org) req.input('org', sql.VarChar, org);
    const result = await req.query(query);
    if (result.recordset.length === 0) return 'Tidak ada aktivitas terbaru.';
    return result.recordset
      .map(
        (r) =>
          `${r.TransDate.toISOString().split('T')[0]} | ${r.TransType} | ${r.MaterialName} (${r.Qty}) di ${r.Location}`,
      )
      .join('\n');
  }

  /** ✅ Laporan stok */
  async generateReport(reportType: string, org?: string) {
    const periodClause =
      reportType === 'daily'
        ? 'WHERE TransDate >= DATEADD(DAY, -1, GETDATE())'
        : reportType === 'weekly'
          ? 'WHERE TransDate >= DATEADD(WEEK, -1, GETDATE())'
          : reportType === 'monthly'
            ? 'WHERE TransDate >= DATEADD(MONTH, -1, GETDATE())'
            : '';

    const query = `
      SELECT TransDate, TransType, MaterialName, SUM(Qty) AS TotalQty, Location
      FROM WarehouseActivity
      ${periodClause}
      ${org ? `AND Location = @org` : ''}
      GROUP BY TransDate, TransType, MaterialName, Location
      ORDER BY TransDate DESC
    `;

    const req = this.pool.request();
    if (org) req.input('org', sql.VarChar, org);
    const result = await req.query(query);
    if (result.recordset.length === 0) return 'Tidak ada data laporan.';
    return this.formatReport(result.recordset);
  }

  /** ✅ Material tidak bergerak */
  async getInactiveMaterials() {
    const query = `
      SELECT MaterialName, StockQty, Location, DATEDIFF(DAY, LastMovementDate, GETDATE()) AS DaysInactive
      FROM Inventory
      WHERE DATEDIFF(DAY, LastMovementDate, GETDATE()) > 30
      ORDER BY DaysInactive DESC
    `;
    const result = await this.pool.request().query(query);
    if (result.recordset.length === 0)
      return 'Tidak ada material tidak bergerak.';
    return result.recordset
      .map(
        (r) =>
          `${r.MaterialName} di ${r.Location}, tidak bergerak selama ${r.DaysInactive} hari (stok ${r.StockQty})`,
      )
      .join('\n');
  }

  /** ✅ Forecasting stok (dummy contoh) */
  async getForecast(materialName: string) {
    if (!materialName) return 'Material tidak disebutkan untuk forecasting.';
    const query = `
      SELECT TOP 1 MaterialName, StockQty, AVG(QtyOut) AS AvgOutPerDay
      FROM MaterialUsage
      WHERE MaterialName LIKE @material
      GROUP BY MaterialName, StockQty
    `;
    const result = await this.pool
      .request()
      .input('material', sql.VarChar, `%${materialName}%`)
      .query(query);

    if (result.recordset.length === 0) return 'Tidak ada data untuk prediksi.';

    const { MaterialName, StockQty, AvgOutPerDay } = result.recordset[0];
    const daysRemaining = Math.round(StockQty / AvgOutPerDay);
    return `📊 Prediksi stok untuk ${MaterialName}: masih cukup untuk ${daysRemaining} hari ke depan (rata-rata penggunaan ${AvgOutPerDay}/hari).`;
  }

  /** 🧩 Helper: format hasil stok */
  private formatStockResult(records: any[]) {
    return records
      .map(
        (r) =>
          `${r.MaterialName} | ${r.StockQty} ${r.UOM || ''} | Lokasi: ${r.Location}`,
      )
      .join('\n');
  }

  /** 🧩 Helper: format laporan */
  private formatReport(records: any[]) {
    const grouped = records.reduce(
      (acc, r) => {
        const dateObj = new Date(r.TransDate);
        const date = isNaN(dateObj.getTime())
          ? r.TransDate
          : dateObj.toISOString().split('T')[0];
        if (!acc[date]) acc[date] = [];
        acc[date].push(r);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    return Object.entries(grouped)
      .map(
        ([date, items]: [string, any[]]) =>
          `📅 ${date}\n` +
          items
            .map(
              (i) =>
                `- ${i.TransType}: ${i.MaterialName} (${i.TotalQty}) di ${i.Location}`,
            )
            .join('\n'),
      )
      .join('\n\n');
  }
}
