import { Test, TestingModule } from '@nestjs/testing';
import { OpenWebuiService } from './open-webui.service';

describe('OpenWebuiService', () => {
  let service: OpenWebuiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenWebuiService],
    }).compile();

    service = module.get<OpenWebuiService>(OpenWebuiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
