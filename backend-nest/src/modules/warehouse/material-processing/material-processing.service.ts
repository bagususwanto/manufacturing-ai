import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MaterialProcessingService {
  private readonly logger = new Logger(MaterialProcessingService.name);

  constructor(private readonly httpService: HttpService) {}

  // Method menggunakan Python API
  async loadMaterialsWithPython(): Promise<void> {
    try {
      this.logger.log('Starting Python-based material processing...');

      // Call Python API endpoint
      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FASTAPI_URL}/warehouse/process-materials`,
          {
            api_url: `${process.env.TWIIS_URL}/material-all`,
            batch_size: 20,
            max_workers: 5,
          },
        ),
      );

      this.logger.log('Python processing completed:', response.data);
    } catch (error) {
      this.logger.error('Error in Python processing:', error);
      throw error;
    }
  }

  // Fallback method menggunakan original TypeScript
  async loadMaterialsWithTypeScript(): Promise<void> {
    // Your original loadMaterials logic here...
    this.logger.log('Using TypeScript fallback method...');
    // ... existing implementation
  }

  // Smart method yang coba Python dulu, fallback ke TypeScript
  async loadMaterials(): Promise<void> {
    try {
      await this.loadMaterialsWithPython();
    } catch (error) {
      this.logger.warn(
        'Python processing failed, falling back to TypeScript:',
        error.message,
      );
      await this.loadMaterialsWithTypeScript();
    }
  }
}
