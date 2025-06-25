import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { MaterialProcessingModule } from './material-processing/material-processing.module';
import { OllamaModule } from 'src/shared/llm/ollama.module';

@Module({
  imports: [MaterialProcessingModule, OllamaModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService], // Exporting WarehouseService for use in other modules
})
export class WarehouseModule {}
