import { Body, Controller, Post } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { loadMaterials } from './utils/data.loader';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  @Post('ask')
  async ask(@Body('question') question: string) {
    return this.service.handleQuery(question);
  }

  @Post('reload')
  async reloadVectorDB() {
    await loadMaterials();
    return { message: 'Data dimuat ke vector DB' };
  }
}
