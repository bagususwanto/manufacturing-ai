import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { OllamaModule } from 'src/shared/llm/ollama.module';
import { HttpModule } from 'src/shared/http/http.module';
import { OllamaService } from 'src/shared/llm/ollama.service';
import { VectorService } from './utils/vector.service';

@Module({
  imports: [OllamaModule, HttpModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, OllamaService, VectorService],
})
export class WarehouseModule {}
