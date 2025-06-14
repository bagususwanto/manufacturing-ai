import { Test, TestingModule } from '@nestjs/testing';
import { MaterialProcessingController } from './material-processing.controller';

describe('MaterialProcessingController', () => {
  let controller: MaterialProcessingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaterialProcessingController],
    }).compile();

    controller = module.get<MaterialProcessingController>(MaterialProcessingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
