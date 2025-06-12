import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { HttpModule } from './shared/http/http.module';

@Module({
  imports: [WarehouseModule, HttpModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
