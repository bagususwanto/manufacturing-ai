export interface Item {
  id: number;
  materialNo: string;
  description: string;
  addressRackName: string;
  storageName: string;
  supplier: string;
  plant: string;
  warehouse: string;
  packaging: string;
  packagingUnit: string;
  uom: string;
  price: string; // formatted currency string
  type: string;
  mrpType: string;
  minStock: number;
  maxStock: number;
  minOrder: number;
  category: string;
  stock: number;
  stockStatus: string;
  stockUpdatedAt: string | null; // ISO date string or null
  stockUpdatedBy: string | null;
}
