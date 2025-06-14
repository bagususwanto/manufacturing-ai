import { Controller, Post } from '@nestjs/common';
import { MaterialProcessingService } from './material-processing.service';

@Controller('warehouse/material-processing')
export class MaterialProcessingController {
  constructor(
    private readonly materialProcessingService: MaterialProcessingService,
  ) {}

  //  Processing (Python + fallback) via FastAPI
  @Post('process')
  async process() {
    await this.materialProcessingService.loadMaterials();
    return { message: 'Processing on Background' };
  }
}
