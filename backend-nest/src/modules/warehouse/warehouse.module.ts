import { Module } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { MaterialProcessingModule } from './material-processing/material-processing.module';
import { RetrievalService } from './retrieval.service';
// import { OllamaModule } from 'src/shared/llm/ollama.module';

@Module({
  imports: [
    MaterialProcessingModule,
    // , OllamaModule
  ],
  providers: [WarehouseService, RetrievalService],
  exports: [WarehouseService], // Exporting WarehouseService for use in other modules
})
export class WarehouseModule {}
