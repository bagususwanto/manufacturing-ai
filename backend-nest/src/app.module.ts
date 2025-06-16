import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from './shared/http/http.module';

@Module({
  imports: [
    WarehouseModule,
    HttpModule,
    ConfigModule.forRoot({
      isGlobal: true, // supaya bisa diakses di seluruh app tanpa import ulang
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
