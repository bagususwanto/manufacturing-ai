import { Test, TestingModule } from '@nestjs/testing';
import { MaterialProcessingService } from './material-processing.service';

describe('MaterialProcessingService', () => {
  let service: MaterialProcessingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MaterialProcessingService],
    }).compile();

    service = module.get<MaterialProcessingService>(MaterialProcessingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
