import { HttpModule as AxiosModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
  imports: [AxiosModule],
  exports: [AxiosModule],
})
export class HttpModule {}
