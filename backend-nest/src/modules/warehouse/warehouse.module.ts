import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { OllamaModule } from 'src/shared/llm/ollama.module';
import { HttpModule } from 'src/shared/http/http.module';
import { OllamaService } from 'src/shared/llm/ollama.service';
import { MaterialProcessingModule } from './material-processing/material-processing.module';

@Module({
  imports: [OllamaModule, HttpModule, MaterialProcessingModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, OllamaService],
})
export class WarehouseModule {}
