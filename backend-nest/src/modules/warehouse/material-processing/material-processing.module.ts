import { Module } from '@nestjs/common';
import { MaterialProcessingController } from './material-processing.controller';
import { MaterialProcessingService } from './material-processing.service';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { MaterialVectorService } from './material-processing.service';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({
      name: 'material-processing',
    }),
  ],
  controllers: [MaterialProcessingController],
  providers: [MaterialVectorService, MaterialProcessingService],
})
export class MaterialProcessingModule {}
