import { Test, TestingModule } from '@nestjs/testing';
import { OpenWebuiController } from './open-webui.controller';

describe('OpenWebuiController', () => {
  let controller: OpenWebuiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OpenWebuiController],
    }).compile();

    controller = module.get<OpenWebuiController>(OpenWebuiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
