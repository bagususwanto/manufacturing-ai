import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from './shared/http/http.module';
import { OpenWebuiModule } from './shared/open-webui/open-webui.module';
import { OllamaModule } from './shared/llm/ollama.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // supaya bisa diakses di seluruh app tanpa import ulang
    }),
    WarehouseModule,
    OllamaModule,
    HttpModule,
    OpenWebuiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
