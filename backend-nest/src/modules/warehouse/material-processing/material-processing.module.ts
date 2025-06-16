import { Module } from '@nestjs/common';
import { MaterialProcessingController } from './material-processing.controller';
import { MaterialProcessingService } from './material-processing.service';

@Module({
  controllers: [MaterialProcessingController],
  providers: [MaterialProcessingService],
})
export class MaterialProcessingModule {}
