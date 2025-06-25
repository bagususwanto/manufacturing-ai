import { Module } from '@nestjs/common';
import { OpenWebuiController } from './open-webui.controller';
import { OpenWebuiService } from './open-webui.service';
import { WarehouseModule } from 'src/modules/warehouse/warehouse.module';

@Module({
  imports: [WarehouseModule],
  controllers: [OpenWebuiController],
  providers: [OpenWebuiService],
})
export class OpenWebuiModule {}
