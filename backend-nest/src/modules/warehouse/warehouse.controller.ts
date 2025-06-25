import { Body, Controller, Post } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  // Endpoint lama untuk kompatibilitas
  @Post('ask')
  async ask(@Body('question') question: string) {
    return this.service.handleQuery(question, 'gemma3:1b');
  }

  @Post('chat-webui')
  async handleChatFromWebUI(@Body() body: any) {
    const messages = body.messages || [];
    const model = body.model || 'gemma3:1b';

    return this.service.handleQuery(messages, model);
  }
}
