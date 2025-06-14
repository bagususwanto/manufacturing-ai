import { Body, Controller, Post } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  @Post('ask')
  async ask(@Body('question') question: string) {
    return this.service.handleQuery(question);
  }
}
